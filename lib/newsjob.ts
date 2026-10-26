/**
 * Один срез работы по патчноутам: опросить порцию игр, записать новое,
 * пересказать непересказанное.
 *
 * Логика живёт здесь, а не в роуте крона, по двум причинам: vitest собирает
 * только lib/**\/*.test.ts, и ровно этот же срез гоняет ручной скрипт
 * scripts/sync-news.ts — расписание и разовый прогон обязаны делать одно и то же.
 *
 * Пропускная способность (Hobby, гэп хоста 1700 мс):
 *   ёмкость/сутки = запусков × звеньев в запуске × SLICE_LIMIT (24 × 6 × 20,
 *                   см. LINK_MS в lib/chain)
 *   спрос/сутки   = Σ 86400 / interval(tier, last_pub_at)
 * Держим спрос ниже ёмкости — иначе очередь растёт и хвост не опрашивается.
 */

import {
  claimNewsPollBatch,
  flushPollResults,
  getGameRanks,
  getGamesMeta,
  getUnsummarized,
  getUnsummarizedEn,
  pruneNewsForApp,
  resetFlawedDigests,
  setNewsDigest,
  setNewsDigestEn,
  writeNewsItems,
  type Db,
  type NewsShownWrite,
  type NewsVerdict,
  type PollOutcome,
  type PollStatus,
  type PollTarget,
  type StoredNews,
} from './db'
import { sliceClock } from './cron'
import { takeEnBackfillBudget } from './enbackfill'
import { logSwallowed } from './errlog'
import { claudeNewsDigest, isPersistentOutage, llmAvailable, LLM_MIN_BUDGET_MS, LlmUnavailableError } from './llm'
import { takeLlmBudget } from './llmcap'
import { bodyHash, detectLang, fetchGameNews, isPatchNote, looksTrivial, newsText } from './news'
import type { PostRef } from './newspage'
import { blocksToText } from './steamhtml'
import { FEED_RANK_FLOOR } from './whatsnewfeed'

const HOUR = 3600
const DAY = 86_400

/** Сколько постов держим на игру. Строго больше окна разбора (25 в lib/news),
 *  иначе получится вечный цикл «выкинули — перекачали — снова выкинули». */
export const NEWS_KEEP = 30

/** Три неудачи подряд — и игру больше не трогаем */
const MAX_FAILS = 3

/** Столько отказов подряд на РАЗНЫХ играх — уже блок IP, а не игры */
const MAX_BLOCKED_RUN = 3

/**
 * Когда вернуться к игре, на которой срез наткнулся на блок IP. Полчаса — это
 * первая ступень обычного отката (nextPollAt при failCount = 0): блок снимается
 * часами, и следующий часовой триггер как раз проверит, снят ли.
 */
const BLOCK_RETRY_SEC = 1800

/** Игра активно патчится, если постила за последние две недели */
const HOT_WINDOW = 14 * DAY

/**
 * Что пересказ получает: пост и язык его оригинала. mode — договор с
 * claudeNewsDigest (lib/llm): 'both' (по умолчанию) — русский пересказ и
 * английский тем же вызовом, 'en' — только английский, когда русский уже
 * лежит в базе (догон, см. runDigestSlice).
 */
export type DigestArgs = {
  gameName: string
  title: string
  body: string
  lang: 'ru' | 'en'
  budgetMs?: number
  mode?: 'both' | 'en'
}

/**
 * Что пересказ отдаёт. В режиме 'both' — tldr, а tldrEn рядом: строка —
 * английский вышел, null — модель ответила, а английский не вышел (попытка
 * засчитывается), нет поля — прежний договор, английского не просили. В
 * режиме 'en' — tldrEn без tldr. titleEn — английский заголовок поста, чей
 * оригинал не английский; null — заголовок и так английский.
 *
 * Поля необязательны нарочно: так тип принимает и нынешний claudeNewsDigest,
 * и заглушки тестов в старой форме { tldr, scale }.
 */
export type DigestOutcome = {
  tldr?: string
  tldrEn?: string | null
  titleEn?: string | null
  /** Вердикт модели: масштаб или 'none' — «не патч» (NewsVerdict в lib/db) */
  scale: NewsVerdict
}

export type DigestFn = (args: DigestArgs) => Promise<DigestOutcome | null>

/**
 * Дверь к модели по договору DigestFn — без приведения типов: claudeNewsDigest
 * объявляет ровно формы договора (NewsDigestBoth и NewsDigestEnglish в
 * lib/llm), и tsc проверяет, что каждая из них — DigestOutcome. Формы ответа
 * ниже всё равно проверяются в рантайме: заглушки тестов отдают и прежнюю
 * форму без английских полей.
 */
const defaultDigest: DigestFn = (args) => claudeNewsDigest(args)

/**
 * Имя игры для промпта, когда строки игры в базе нет. Не «Игра 730»:
 * пересказ теперь пишется на двух языках, и русская заглушка доезжала бы в
 * английский текст. App N — так же называет заглушки прогрев (lib/catalog).
 */
const neutralName = (appid: number) => `App ${appid}`

export type SliceResult = {
  polled: number
  /**
   * Записи, новые или переписанные так, что это видно на страницах (тело,
   * заголовок, вид поста — writeNewsItems). Строки, где сдвинулся один вес
   * (rank), сюда не входят: «записей» в отметке крона они не прибавляли
   * ничего, кроме шума.
   */
  inserted: number
  digested: number
  /**
   * Сколько из записанного могло поменять общую ленту крупных патчей —
   * /whatsnew, /api/whatsnew/head и обе RSS-ленты, все из одной записи
   * cachedMajorFeed. Роут сбрасывает её тег (NEWS_MAJOR_TAG) только при
   * major > 0, а не при любой записи: см. feedTouched.
   */
  major: number
  /**
   * Игры, у которых опрос поменял ленту патчей карточки: роут сбрасывает их
   * адреса в ISR (lib/gamecache) — карточку и архив обновлений игры. Новая
   * новость сюда не попадает — карточка и архив показывают только патчи
   * (getGameNews), — разве что ретенция сняла ради неё старый патч.
   * Переписанный один вес — тоже нет: карточка берёт из него лишь бит «в
   * каталоге ли игра» (cardNews в lib/gamepage), см. runNewsSlice.
   *
   * Переопрос, переписавший «патч» в новость после правки классификатора,
   * карточку не меняет и сброса не требует: карточка сама сверяет каждую
   * строку с нынешним правилом (isStoredPatch в lib/gamepage), то есть
   * перестала показывать её с первой перегенерации на новом коде. Архив
   * обновлений сверяет так же (app/game/[appid]/news/load.ts).
   */
  cards: number[]
  /**
   * Посты, чья страница поменялась (shown из writeNewsItems): опрос записал
   * их впервые или переписал тело, заголовок, вид. Роут сбрасывает и эти адреса
   * (resetSliceCards): страница патча живёт в ISR месяц. Переписанный один
   * вес сюда не попадает — страница его не показывает.
   */
  posts: PostRef[]
  hasMore: boolean
  stopped: 'done' | 'budget' | 'blocked'
}

/**
 * Персональный слот игры внутри каденции.
 *
 * Без него каденция — это ровное `now + интервал`, а ровное сложение сохраняет
 * то время суток, в которое игра попала в очередь. Постановка размазывает всего
 * на час (enrollNewsPoll, appid % 3600), поэтому одна массовая заливка склеивает
 * набор в одну часовую полосу, и он остаётся в ней навсегда. Замер на живой базе
 * до этой правки: 184 из 190 горячих игр приходили в срок в 13:00 UTC, пятнадцать
 * часовых триггеров из двадцати четырёх находили пустую очередь, а лента менялась
 * одним залпом раз в сутки — при спросе 309 опросов против ёмкости 480.
 *
 * Возвращается ближайшая точка сетки `k * интервал + слот`, не раньше половины
 * каденции. Отсюда три свойства, за каждое из которых держится тест:
 *   • срок ВСЕГДА лежит на сетке, поэтому опоздание крона не сдвигает слот и
 *     разложенная очередь не слипается обратно;
 *   • средний интервал равен каденции — разложить очередь не значит опрашивать
 *     чаще, ёмкость не тратится;
 *   • интервал не короче половины каденции, то есть слот не превращается в
 *     лишний опрос.
 *
 * Хэш, а не `appid % интервал`: соседние appid — это один издатель, залитый
 * одной пачкой (2427420 и 2427430 разошлись бы на десять секунд). Умножение по
 * Кнуту разносит их по суткам и остаётся детерминированным.
 */
export function pollSlot(appid: number, intervalSec: number): number {
  return (Math.imul(appid, 2_654_435_761) >>> 0) % intervalSec
}

function slotted(nowSec: number, intervalSec: number, appid: number): number {
  const slot = pollSlot(appid, intervalSec)
  const earliest = nowSec + Math.floor(intervalSec / 2)
  return Math.ceil((earliest - slot) / intervalSec) * intervalSec + slot
}

/**
 * Каденция без слота — отдельно, потому что её обязан знать не только крон.
 * scripts/spread-news-poll.ts раскладывает УЖЕ слипшуюся очередь и для этого
 * должен ответить на тот же вопрос «как часто эту игру опрашивать». Своими
 * словами он разошёлся бы с кроном на первом же изменении порога — ровно тот
 * класс ошибки, ради которого написан докблок lib/whatsnewfeed.ts.
 *
 * Отказы сюда не входят: у них не каденция, а экспоненциальный откат.
 */
export function pollInterval(
  args: { status: PollStatus; lastPubAt?: number },
  nowSec: number,
): number {
  if (args.status === 'empty' || args.status === 'mismatch') return 7 * DAY
  const hot = args.lastPubAt != null && nowSec - args.lastPubAt < HOT_WINDOW
  if (hot) return 24 * HOUR
  const stale = args.lastPubAt != null && nowSec - args.lastPubAt > 180 * DAY
  return (stale ? 28 : 7) * DAY
}

/**
 * Когда возвращаться к игре. Каденция от того, как часто она реально патчится,
 * а не от пожизненного числа отзывов и не от tier.
 *
 * Раньше здесь стояла ветка `tier === 0 → 72 часа`, и стояла она ВЫШЕ проверки
 * на протухание — то есть для библиотечных игр ветка `stale` была недостижима.
 * А библиотеки попадают в очередь целиком (saveSnapshot ставит tier 0 на всю
 * библиотеку сразу), поэтому игра, не публиковавшая ничего с 2019 года,
 * опрашивалась раз в трое суток вечно. Замер на живой базе: 409 строк tier 0,
 * это ~136 опросов в сутки — треть всей пропускной способности крона, и
 * потрачена она на игры, которые в общую ленту попасть не могут в принципе
 * (там нужен rank > 0, а он бывает только у каталожных).
 *
 * Tier по-прежнему существует, но решает он теперь другое — приоритет в
 * claimNewsPollBatch, а не частоту. Частота одна для всех и берётся из того,
 * патчится игра или нет.
 */
export function nextPollAt(
  args: { appid: number; tier: number; status: PollStatus; failCount: number; lastPubAt?: number },
  nowSec: number,
): number {
  const { appid, status, failCount, lastPubAt } = args
  // Отказ — не каденция, а повтор: раскладывать его по суткам значит ждать
  // полсуток там, где нужно полчаса.
  if (status === 'error') return nowSec + Math.min(1800 * 2 ** failCount, DAY)
  const interval = pollInterval(
    { status, ...(lastPubAt != null ? { lastPubAt } : {}) },
    nowSec,
  )
  return slotted(nowSec, interval, appid)
}

/**
 * Могла ли записанная опросом строка поменять общую ленту крупных патчей —
 * ту, что выбирает getMajorFeedHead: kind = 'patch', scale = 'major', вес не
 * ниже FEED_RANK_FLOOR.
 *
 * Новая строка — только если она сама крупный патч популярной игры: новость
 * или хотфикс лента не покажет. Переписанная видимо — всегда, если игра
 * проходит по весу: какой строка была до записи, апсерт не говорит, а
 * крупный патч, ставший хотфиксом или новостью, из ленты уходит, и это тоже
 * перемена ленты. Видимых перезаписей немного (издатель поправил пост,
 * поменялся классификатор), так что запас здесь дешёвый.
 *
 * Вес — тот, что опрос записал в строку. Игра, перешедшая порог одним весом,
 * тег не сбрасывает: строку с одним сдвинувшимся весом writeNewsItems в
 * видимые не берёт вовсе. Такая перемена доезжает по сроку записи кэша
 * (MAJOR_TTL_SEC в lib/whatsnewcache, сутки): порог вес пересекает редко, а
 * переписывается он у всех свежих постов игры после каждой сверки отзывов.
 */
function feedTouched(w: NewsShownWrite, rank: number): boolean {
  if (rank < FEED_RANK_FLOOR) return false
  return !w.isNew || (w.kind === 'patch' && w.scale === 'major')
}

/**
 * Опрос + пересказ. Дедлайны у фаз РАЗНЫЕ: при общем бюджете фаза опроса
 * всегда съедала бы его целиком и пересказ не выполнялся бы никогда.
 */
export async function runNewsSlice(
  db: Db,
  opts: {
    deadlineAt: number
    nowSec?: number
    limit?: number
    digestLimit?: number
    /** подменяется в тестах: иначе прогон уходит и в сеть, и в лимитер темпа */
    fetchNews?: typeof fetchGameNews
    digestFn?: DigestFn
    onProgress?: (line: string) => void
  },
): Promise<SliceResult> {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000)
  const limit = opts.limit ?? 20
  const digestLimit = opts.digestLimit ?? 12
  const fetchNews = opts.fetchNews ?? fetchGameNews
  const log = opts.onProgress ?? (() => {})

  // Треть бюджета придерживаем под пересказ, только если он тут же и будет.
  // С отдельным кроном (digestLimit = 0) опрос забирает всё время целиком —
  // это примерно девять лишних игр на срез, взятых из воздуха.
  const total = Math.max(0, opts.deadlineAt - Date.now())
  const pollDeadline = digestLimit > 0 ? Date.now() + Math.floor(total * 0.65) : opts.deadlineAt

  const targets = await claimNewsPollBatch(db, now, limit)
  const ranks = await getGameRanks(
    db,
    targets.map((t) => t.appid),
  )

  const outcomes: PollOutcome[] = []
  let inserted = 0
  let major = 0
  let polled = 0
  const cards: number[] = []
  const posts: PostRef[] = []
  let stopped: SliceResult['stopped'] = 'done'

  /*
   * Отказы подряд ждут приговора, а не получают штраф сразу.
   *
   * Раньше каждая игра из серии отказов получала failCount + 1 на месте, а
   * при третьем — 'gone' на тридцать дней (reviveGoneNewsPoll). Но серия из
   * трёх отказов на разных играх — это Steam, закрывшийся от IP Vercel на
   * несколько часов, а не три мёртвые игры, и об этом писал ещё комментарий
   * у стража. Часовой триггер штрафовал по три игры из головы очереди, а
   * голова — это tier 1, верх каталога: за три часа блока топовые игры
   * уходили из «Что нового» на месяц.
   *
   * Теперь виноватость ясна только по концу серии: оборвал её удачный опрос —
   * это были невезучие игры, и штраф прежний; дошла она до MAX_BLOCKED_RUN —
   * это блок, и игры не виноваты вовсе.
   */
  let серия: PollTarget[] = []
  const штраф = (t: PollTarget): PollOutcome => {
    const failCount = t.failCount + 1
    const status: PollStatus = failCount >= MAX_FAILS ? 'gone' : 'error'
    return {
      appid: t.appid,
      status,
      failCount,
      nextAt: nextPollAt({ ...t, status: 'error', failCount }, now),
      ...(t.lastPubAt ? { lastPubAt: t.lastPubAt } : {}),
    }
  }
  /** Блок IP: счётчик отказов прежний, вернуться — как только блок могли снять */
  const помилование = (t: PollTarget): PollOutcome => ({
    appid: t.appid,
    status: 'error',
    failCount: t.failCount,
    nextAt: now + BLOCK_RETRY_SEC,
    ...(t.lastPubAt ? { lastPubAt: t.lastPubAt } : {}),
  })
  // «Уложится ли ещё одна игра», а не «прошёл ли срок» — см. sliceClock.
  const часы = sliceClock(pollDeadline)

  for (const t of targets) {
    if (!часы.next()) {
      stopped = 'budget'
      break
    }
    polled++
    const items = await fetchNews(t.appid, fetch, now)

    if (items === null) {
      // Подряд идущие отказы на РАЗНЫХ играх означают, что Steam закрылся от
      // нашего IP (он это делает — см. lib/gamepage.ts:43). Штамповать в этот
      // момент весь набор как «мёртвый» нельзя: аренда истечёт сама.
      серия.push(t)
      if (серия.length >= MAX_BLOCKED_RUN) {
        outcomes.push(...серия.map(помилование))
        серия = []
        stopped = 'blocked'
        break
      }
      continue
    }
    // Удачный опрос оборвал серию: отказы перед ним — про сами игры.
    outcomes.push(...серия.map(штраф))
    серия = []

    if (!items.length) {
      outcomes.push({
        appid: t.appid,
        status: 'empty',
        failCount: 0,
        nextAt: nextPollAt({ ...t, status: 'empty', failCount: 0 }, now),
      })
      continue
    }

    const rank = ranks.get(t.appid) ?? 0
    const rows: StoredNews[] = items.map((it) => {
      const text = newsText(it)
      const patch = isPatchNote(it.title, text)
      return {
        appid: it.appid,
        gid: it.gid,
        title: it.title,
        url: it.url,
        publishedAt: it.publishedAt,
        kind: patch ? 'patch' : 'news',
        // Масштаб проставляем СРАЗУ эвристикой, а Claude потом уточняет.
        // Наоборот (оставить null до модели) нельзя: без ANTHROPIC_API_KEY
        // масштаб не проставился бы никогда, и лента крупных обновлений
        // осталась бы навсегда пустой.
        scale: patch ? (looksTrivial(it.title, text) ? 'hotfix' : 'major') : null,
        blocks: it.blocks,
        bodyHash: bodyHash(it.blocks),
        ...(it.imageUrl ? { imageUrl: it.imageUrl } : {}),
        rank,
      }
    })

    const { shown } = await writeNewsItems(db, rows, now)
    const n = shown.length
    inserted += n
    major += shown.filter((w) => feedTouched(w, rank)).length
    // Ретенцию переполняет только новая строка; переписанная её не двигает
    const prunedPatches = shown.some((w) => w.isNew) ? await pruneNewsForApp(db, t.appid, NEWS_KEEP) : 0
    /*
     * Карточку и архив сбрасываем, когда их лента патчей поменялась видимо:
     * новый патч, переписанная запись (тело, заголовок, вид — какой она была
     * до записи, апсерт не говорит, и патчем она могла быть) или патч, снятый
     * ретенцией ради новой строки. Новая новость сама по себе — нет: карточка
     * и архив показывают только патчи (getGameNews).
     *
     * И строки, где сдвинулся один вес (rank), — нет. Вес переписывается у
     * всех свежих постов игры после каждой сверки отзывов, а горячие игры
     * опрашиваются ежедневно, и каждый такой опрос стоил перегенерации
     * карточки и архива в обеих языковых копиях — ради числа, которого на них
     * не видно. Из веса карточка берёт один бит «в каталоге ли игра» (cardNews
     * в lib/gamepage); через ноль вес ходит редко, и такая перемена доедет с
     * плановой перегенерацией карточки (GAME_PAGE_REVALIDATE_SEC в
     * lib/gamecache).
     */
    if (prunedPatches > 0 || shown.some((w) => w.kind === 'patch' || !w.isNew)) cards.push(t.appid)
    /*
     * Ретенция могла снять патч, который показывает общая лента: тогда её
     * запись кэша и RSS со ссылкой на пропавшую страницу ждали бы чужого
     * патча или суток. Порог тот же, что у feedTouched.
     */
    if (prunedPatches > 0 && rank >= FEED_RANK_FLOOR) major++
    /*
     * Страницы самих постов — только тех, у кого поменялась страница: то же
     * shown, без строк одного веса. Новая новость страницы не имеет, а
     * переписанная строка могла быть патчем до записи — патч, ставший
     * новостью после правки классификатора, теперь отдаёт 404, и его сброс
     * нужен так же.
     */
    for (const w of shown) if (w.kind === 'patch' || !w.isNew) posts.push({ appid: t.appid, gid: w.gid })

    const lastPubAt = Math.max(...items.map((i) => i.publishedAt))
    outcomes.push({
      appid: t.appid,
      status: 'ok',
      failCount: 0,
      nextAt: nextPollAt({ ...t, status: 'ok', failCount: 0, lastPubAt }, now),
      lastPubAt,
    })
    if (n > 0) log(`  ${t.appid}: +${n}`)
  }

  // Срез кончился не блоком (срок или конец пачки), а серия не дошла до
  // порога: блоком её не доказать, и отказы штрафуются по-старому.
  outcomes.push(...серия.map(штраф))
  await flushPollResults(db, outcomes, now)

  // Пересказ теперь живёт отдельным кроном (/api/cron/digest) и своим
  // бюджетом. Здесь он остаётся только если его явно попросили — так ходит
  // scripts/sync-news.ts, где дедлайна нет и делить нечего. Английский догон
  // старых пересказов сюда не входит: у него своя доля бюджета, и ходит он из
  // крона пересказов или по --en-backfill, а новые записи и так получают оба
  // языка одним вызовом.
  let digested = 0
  if (digestLimit > 0) {
    const d = await runDigestSlice(db, {
      deadlineAt: opts.deadlineAt,
      nowSec: now,
      limit: digestLimit,
      ...(opts.digestFn ? { digestFn: opts.digestFn } : {}),
      onProgress: log,
      english: false,
    })
    digested = d.digested
    major += d.major
    cards.push(...d.cards)
    posts.push(...d.posts)
  }

  return {
    polled,
    inserted,
    digested,
    major,
    cards: [...new Set(cards)],
    posts: uniquePosts(posts),
    hasMore: targets.length === limit && stopped !== 'blocked',
    stopped,
  }
}

/** Каждый пост один раз — в порядке первого появления */
function uniquePosts(posts: readonly PostRef[]): PostRef[] {
  const seen = new Set<string>()
  return posts.filter((p) => {
    const key = newsKey(p.appid, p.gid)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export type DigestResult = {
  digested: number
  /**
   * Сколько из сделанного могло поменять общую ленту крупных патчей: пересказы
   * записей, которые она показывает или покажет (digestTouchesFeed), и снятые
   * битые пересказы. Роут крона пересказов сбрасывает тег ленты
   * (NEWS_MAJOR_TAG) только при major > 0 — тем же правилом, что крон новостей.
   */
  major: number
  /**
   * Игры, патчам которых срез дописал пересказ или снял битый
   * (resetFlawedDigests): он стоит на карточке строкой под заголовком и делает
   * заголовок ссылкой (indexedNewsPath) — роут сбрасывает их адреса в ISR
   * (lib/gamecache): карточку и архив обновлений. Вердикт «не патч» (scale
   * 'none') — тоже сюда: строка уходит с карточки и из архива, а карточка
   * живёт месяц.
   */
  cards: number[]
  /**
   * Посты, которым срез записал пересказ — русский, английский или вердикт
   * «не патч»: их страницы роут сбрасывает тоже (resetSliceCards). На
   * странице это «Коротко», английский заголовок, индекс и hreflang, а у
   * вердикта — 404 вместо страницы. announceFreshPatches сбрасывает
   * свежепересказанные и сам, но лишь крупные патчи игр каталога за
   * девяносто дней — то, что объявляет поисковикам; хотфикс, давний пост
   * английского догона и вердикт он не видит. Битые пересказы, снятые
   * уборкой (resetFlawedDigests), здесь не названы: уборка отдаёт игры, а не
   * посты, и идёт однажды на базу.
   */
  posts: PostRef[]
  hasMore: boolean
  /**
   * 'unavailable' — модели нет: ключ не задан или сервис отказал (тогда ещё
   * и llm: 'down'). 'capped' — выбран суточный бюджет вызовов (lib/llmcap).
   */
  stopped: 'done' | 'budget' | 'unavailable' | 'capped'
  /**
   * Сервис модели отказал всерьёз — не «ключа нет» и не мигание 429/5xx, а
   * баланс, ключ или модель (isPersistentOutage в lib/llm). Ложится в
   * отметку среза и поднимает /api/cron/health (sliceHealth, lib/cron.ts):
   * пустой баланс или отозванный ключ иначе видно только по тому, что
   * пересказы перестали появляться.
   */
  llm?: 'down'
  /** HTTP-статус отказа; null — до сервиса не дошли (сеть, таймаут) */
  llmStatus?: number | null
  /**
   * Сколько из digested — английский догон (getUnsummarizedEn). Есть, только
   * если срез дошёл до догона: русская очередь была пуста на входе или
   * выбрана в этом же срезе до дна.
   */
  english?: number
  /**
   * Доля догона на сегодня выбрана (lib/enbackfill). Это не 'capped': модель
   * у подбора и пересказов новых патчей есть, а догон просто ждёт завтра —
   * health тут краснеть не за что.
   */
  enCapped?: true
}

/**
 * Виден ли пересказ записи в общей ленте крупных патчей (getMajorFeedHead):
 * запись крупная до пересказа или стала крупной по его вердикту, а игра
 * проходит по весу. Вердикт «хотфикс» или «не патч» у крупной записи — тоже
 * перемена ленты: строка из неё уходит.
 *
 * Пересказ того, чего лента не покажет, — патча игры ниже FEED_RANK_FLOOR
 * (библиотечные игры стоят в той же очереди, что каталожные) или
 * некрупного, — тег не сбрасывает: сброс стоит холодного чтения тридцати тел
 * патчей в запись кэша и перегенерации обеих RSS-лент, а на страницах от него
 * не меняется ничего. Новизну окна (лента — тридцать самых свежих игр) не
 * сверяем: для этого нужна голова ленты, а русский пересказ достаётся патчу
 * в пределах часа после опроса. Старые патчи переводит английский догон, и
 * крупные из них сбрасывают тег впустую — но догон конечен: очередь
 * getUnsummarizedEn пустеет, а новые патчи получают оба языка одним вызовом.
 */
function digestTouchesFeed(item: StoredNews, verdict?: NewsVerdict): boolean {
  return item.rank >= FEED_RANK_FLOOR && (item.scale === 'major' || verdict === 'major')
}

/**
 * Пересказы — отдельно от опроса.
 *
 * Раньше обе фазы делили один пятидесятисекундный бюджет в отношении 65/35, и
 * опрос всегда выигрывал: срез приносил под сотню новых записей и успевал
 * пересказать десяток. Разрыв рос сам по себе — замер показал 1 499 → 1 644 за
 * час. Никакая настройка долей это не чинит: фазы просто не должны стоять в
 * одной очереди за одним таймером. У пересказа своя задача, свой крон, свой
 * бюджет и своя аренда (DIGEST_LEASE), потому что в Steam он не ходит вовсе.
 *
 * Пересказ пишет оба языка одним вызовом (режим 'both'): русский, английский
 * и английский заголовок не английского поста. Английский догон — для того,
 * что пересказано до английской версии или чей английский не вышел, — идёт,
 * только когда русская очередь пуста: на входе в срез или выбрана в нём до
 * дна (тогда догону достаётся остаток пачки). Русский — язык сайта по
 * умолчанию, и новый патч не ждёт за старым переводом. Догон берёт тело из
 * базы (getUnsummarizedEn), в Steam не ходит и платит своей долей суточного
 * бюджета (lib/enbackfill), чтобы не выбрать его за утро.
 *
 * english: false — без догона (так зовёт runNewsSlice); englishOnly — только
 * догон, русскую очередь не трогать (scripts/sync-news.ts --en-backfill).
 */
export async function runDigestSlice(
  db: Db,
  opts: {
    deadlineAt: number
    nowSec?: number
    limit?: number
    digestFn?: DigestFn
    onProgress?: (line: string) => void
    english?: boolean
    englishOnly?: boolean
  },
): Promise<DigestResult> {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000)
  const limit = opts.limit ?? 12
  const digest = opts.digestFn ?? defaultDigest
  const log = opts.onProgress ?? (() => {})

  /*
   * Битые пересказы, записанные до проверки текста модели, — вон из базы и
   * обратно в очередь (resetFlawedDigests, раз на базу). До проверки ключа:
   * мусор снимается со страниц и без модели, а пересказ заново дождётся её.
   * Сбой уборки пересказ не останавливает — она повторится следующим звеном.
   */
  const cards = new Set<number>()
  // Снятый битый пересказ мог стоять в общей ленте: какие из строк в ней,
  // уборка не знает, и считаем все. Уборка разовая (TLDR_FLAW_SWEEP_KEY)
  let major = 0
  try {
    const swept = await resetFlawedDigests(db)
    if (swept?.length) log(`  битых пересказов снято: игр ${swept.length}`)
    for (const appid of swept ?? []) cards.add(appid)
    major += swept?.length ?? 0
  } catch (e) {
    logSwallowed('newsjob:tldr-sweep', e)
  }

  // Нет ключа — не ходим в очередь вовсе. Иначе каждая запись впустую тратит
  // попытку, и после трёх прогонов сотни патчей НАВСЕГДА выпадают из очереди
  // пересказа: причина-то временная (ключ забыли положить), а отметка вечная.
  // Попытка должна засчитываться за отказ модели, а не за её отсутствие.
  if (!opts.digestFn && !llmAvailable()) {
    return { digested: 0, major, cards: [...cards], posts: [], hasMore: false, stopped: 'unavailable' }
  }

  const pending = opts.englishOnly ? [] : await getUnsummarized(db, limit)
  if (!pending.length) {
    // Карточки, с которых уборка выше сняла битые пересказы, едут в сброс и
    // тогда, когда звено целиком уходит догону
    const swept: DigestResult = { digested: 0, major, cards: [...cards], posts: [], hasMore: false, stopped: 'done' }
    if (opts.english === false) return swept
    return mergeDigest(swept, await runEnglishBackfill(db, { deadlineAt: opts.deadlineAt, now, limit, digest, log }))
  }

  const metas = await getGamesMeta(
    db,
    pending.map((p) => p.appid),
  )

  let digested = 0
  const posts: PostRef[] = []
  let stopped: DigestResult['stopped'] = 'done'
  /*
   * Ответила ли модель хоть раз без английского ключа вовсе — прежним
   * договором claudeNewsDigest, до английской версии. Тогда догон в этом
   * срезе не начинаем: режим 'en' она не знает, и первый же его вызов был бы
   * оплачен впустую (runEnglishBackfill на нём и встанет).
   */
  let legacyModel = false

  for (const item of pending) {
    /*
     * Не «есть ли ещё время», а «хватит ли его на вызов». Раньше стояло первое,
     * и запись, начатая за секунду до срока, тянула свои 30с × 2 сверху — мимо
     * maxDuration, то есть со снятием инстанса и потерей finally. Остаток
     * уходит и внутрь вызова: см. cronClientOptions в lib/llm.ts.
     */
    const бюджет = opts.deadlineAt - Date.now()
    if (бюджет < LLM_MIN_BUDGET_MS) {
      stopped = 'budget'
      break
    }
    // Общий суточный бюджет модели — последним, перед самим вызовом. Отказ
    // НЕ засчитывает попытку записи: как и с недоступной моделью, причина не
    // в ней, и запись должна дождаться завтрашнего бюджета в очереди.
    if (!(await takeLlmBudget(db, now))) {
      log('  суточный бюджет модели выбран, попытки не засчитаны')
      return { digested, major, cards: [...cards], posts, hasMore: false, stopped: 'capped' }
    }
    const text = blocksToText(item.blocks)
    let res: DigestOutcome | null
    try {
      // Режим не называем: 'both' — режим договора по умолчанию, и вызов
      // остаётся ровно тем, каким был до английской версии
      res = await digest({
        gameName: metas.get(item.appid)?.name ?? neutralName(item.appid),
        title: item.title,
        body: text,
        lang: detectLang(text),
        budgetMs: бюджет,
      })
    } catch (e) {
      const down = digestDown(e, log)
      if (down) return { digested, major, cards: [...cards], posts, hasMore: false, ...down }
      throw e
    }
    // Ответ без русского — отказ записи, как и null: так решает договор (спам
    // и битый русский — null), а пересказ без tldr сломал бы очередь. Кроме
    // вердикта 'none' («не патч»): его пересказ пустой по договору
    // (validateDigest), и это ответ, а не отказ — setNewsDigest пишет его
    // пустой строкой и снимает английский слот, а запись уходит из очереди.
    // В сброс карточки — и он: строка уходит с карточки и из архива
    const none = res?.scale === 'none'
    const tldr = none ? '' : res?.tldr
    const answered = !!res && (none || !!tldr)
    await setNewsDigest(
      db,
      item.appid,
      item.gid,
      res && answered
        ? {
            tldr: tldr ?? '',
            scale: res.scale,
            ...(res.tldrEn !== undefined ? { tldrEn: res.tldrEn, titleEn: res.titleEn ?? null } : {}),
          }
        : null,
      now,
    )
    if (res && answered) {
      digested++
      if (digestTouchesFeed(item, res.scale)) major++
      cards.add(item.appid)
      posts.push({ appid: item.appid, gid: item.gid })
      if (res.tldrEn === undefined) legacyModel = true
    }
  }

  // Взяли полную пачку — значит в очереди почти наверняка ещё есть. Случай
  // «модель отвалилась» сюда не доходит: он возвращается выше по return.
  const ru: DigestResult = { digested, major, cards: [...cards], posts, hasMore: pending.length === limit, stopped }
  /*
   * Русская очередь выбрана до дна — остаток звена уходит догону, в этом же
   * срезе. Иначе догон не шёл бы почти никогда: крон пересказов приходит раз
   * в час вместе с опросом, и почти каждый час приносит хоть один новый патч
   * или повтор упавшего. Неполная пачка давала hasMore: false, цепочка
   * (digestLinkVerdict) кончалась на 'done', и до догона очередь не доходила
   * — его выбирал только ручной --en-backfill. Порядок прежний: русский
   * первым, догону — только то, что от него осталось, и не больше остатка
   * пачки, чтобы звено не вышло за свои сорок восемь секунд.
   *
   * Записи, пересказанные выше, догон в этом срезе не берёт: если английский
   * у них не вышел, только что спрашивать модель о том же ещё раз — потратить
   * вторую из трёх попыток за ту же минуту. Они дождутся следующего звена.
   */
  if (stopped !== 'done' || ru.hasMore || opts.english === false || legacyModel) return ru
  const en = await runEnglishBackfill(db, {
    deadlineAt: opts.deadlineAt,
    now,
    limit: limit - pending.length,
    digest,
    log,
    skip: new Set(pending.map((p) => newsKey(p.appid, p.gid))),
  })
  return mergeDigest(ru, en)
}

const newsKey = (appid: number, gid: string) => `${appid}:${gid}`

/**
 * Итог среза, в котором за русской очередью шёл догон: числа складываются,
 * а остановка, «есть ли ещё» и отказ модели — от догона, он шёл последним.
 * english — только если догон что-то делал (см. DigestResult.english).
 */
function mergeDigest(ru: DigestResult, en: DigestResult): DigestResult {
  return {
    ...en,
    digested: ru.digested + en.digested,
    major: ru.major + en.major,
    cards: [...new Set([...ru.cards, ...en.cards])],
    posts: uniquePosts([...ru.posts, ...en.posts]),
  }
}

/**
 * Сервис модели отказал (пустой баланс, отозванный ключ, квота) — это не про
 * запись. Фаза останавливается, НЕ засчитывая попытку: иначе неоплаченный
 * счёт за три прогона крона выбросил бы сотни патчей из очереди навсегда.
 * null — это не отказ сервиса, и исключение летит дальше.
 */
function digestDown(
  e: unknown,
  log: (line: string) => void,
): Pick<DigestResult, 'stopped' | 'llm' | 'llmStatus'> | null {
  if (!(e instanceof LlmUnavailableError)) return null
  log(`  пересказы недоступны (${e.status ?? '—'}), попытки не засчитаны`)
  // В кроне onProgress не слушает никто: без этой строки статус отказа
  // терялся целиком
  logSwallowed('newsjob:digest', e, { status: e.status ?? 'net' })
  // В отметку — только отказ, который сам не пройдёт (баланс, ключ, модель):
  // мигание 429/5xx/таймаута срез переживёт через час
  return {
    stopped: 'unavailable',
    ...(isPersistentOutage(e.status) ? { llm: 'down' as const, llmStatus: e.status } : {}),
  }
}

/**
 * Английский догон: пересказ по-английски для патчей, у которых русский уже
 * есть (см. runDigestSlice). Тело — из базы, режим 'en': русский пересказ и
 * масштаб модель не переписывает, их решил основной пересказ.
 *
 * Доля бюджета берётся на каждый вызов (takeEnBackfillBudget): выбрана —
 * догон молча ждёт завтра (enCapped, а не 'capped': модель у остальной
 * работы есть). Выбран общий бюджет — это 'capped', как у русской фазы.
 *
 * Ответ без tldrEn вовсе — модель английского не знает (прежний договор
 * claudeNewsDigest): догон встаёт, ничего не записав и не засчитав. Иначе
 * каждая запись очереди за три прогона ушла бы из неё навсегда — из-за
 * версии кода, а не из-за самой записи.
 */
async function runEnglishBackfill(
  db: Db,
  o: {
    deadlineAt: number
    now: number
    limit: number
    digest: DigestFn
    log: (line: string) => void
    /** Записи, которых догон не берёт: их только что пересказал этот же срез */
    skip?: ReadonlySet<string>
  },
): Promise<DigestResult> {
  const skip = o.skip ?? new Set<string>()
  // Пропуск — свежие записи, а очередь идёт от свежих: читаем с запасом на них
  const pending = (await getUnsummarizedEn(db, o.limit + skip.size))
    .filter((p) => !skip.has(newsKey(p.appid, p.gid)))
    .slice(0, o.limit)
  if (!pending.length) return { digested: 0, major: 0, cards: [], posts: [], hasMore: false, stopped: 'done' }
  const metas = await getGamesMeta(
    db,
    pending.map((p) => p.appid),
  )

  let digested = 0
  let major = 0
  const cards = new Set<number>()
  const posts: PostRef[] = []
  let stopped: DigestResult['stopped'] = 'done'
  const result = (extra: Partial<DigestResult> = {}): DigestResult => ({
    digested,
    major,
    cards: [...cards],
    posts,
    hasMore: false,
    stopped,
    english: digested,
    ...extra,
  })

  for (const item of pending) {
    const бюджет = o.deadlineAt - Date.now()
    if (бюджет < LLM_MIN_BUDGET_MS) {
      stopped = 'budget'
      break
    }
    const take = await takeEnBackfillBudget(db, o.now)
    if (take === 'share') {
      o.log('  доля английского догона на сегодня выбрана, попытки не засчитаны')
      return result({ enCapped: true })
    }
    if (take === 'capped') {
      o.log('  суточный бюджет модели выбран, попытки не засчитаны')
      return result({ stopped: 'capped' })
    }
    const text = blocksToText(item.blocks)
    let res: DigestOutcome | null
    try {
      res = await o.digest({
        gameName: metas.get(item.appid)?.name ?? neutralName(item.appid),
        title: item.title,
        body: text,
        lang: detectLang(text),
        budgetMs: бюджет,
        mode: 'en',
      })
    } catch (e) {
      const down = digestDown(e, o.log)
      if (down) return result(down)
      throw e
    }
    if (res && res.tldrEn === undefined) {
      o.log('  модель не отдаёт английский пересказ — догон остановлен, попытки не засчитаны')
      return result()
    }
    const tldrEn = res?.tldrEn?.trim()
    await setNewsDigestEn(
      db,
      item.appid,
      item.gid,
      tldrEn ? { tldrEn, titleEn: res?.titleEn ?? null } : null,
      o.now,
    )
    if (tldrEn) {
      digested++
      // Масштаб догон не трогает — решает тот, что уже в строке
      if (digestTouchesFeed(item)) major++
      cards.add(item.appid)
      // /en получила «In short» и индекс, русская — hreflang на неё
      posts.push({ appid: item.appid, gid: item.gid })
    }
  }

  // Полная пачка без остановки — в очереди догона почти наверняка есть ещё
  return result({ hasMore: stopped === 'done' && pending.length === o.limit })
}
