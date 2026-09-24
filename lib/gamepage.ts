import { clip, DESCRIPTION_MAX } from './clip'
import { hashString, mulberry32 } from './daily'
import {
  getGamePageRow,
  getGameNews,
  getNeighbors,
  loadTagStats,
  topGamesByTag,
  withoutBody,
  type Db,
  type FeedItem,
  type SimilarGame,
} from './db'
import { logSwallowed } from './errlog'
import { sessionTrait, type GameTrait } from './gametraits'
import { distinctiveTags } from './hook'
import { judgeLiveness, type DeadReason } from './liveness'
import { NEIGHBORS_K } from './neighbors'
import { plural } from './plural'
import type { ProsCons } from './reviews'
import { getDb } from './server'
import { tagRu } from './tagsru'
import { rarityOf, rarityScale, tagWeightFrom } from './tagweight'
import type { GameMeta } from './types'

export type GamePageData = {
  meta: GameMeta
  reviewsSummary: {
    scoreDesc: string
    totalPositive: number
    totalNegative: number
  } | null
  prosCons: ProsCons | null
  /** без тел патчей — их отдаёт app/api/news по раскрытию, см. withoutBody */
  news: FeedItem[]
  /**
   * «Похожие»: готовые соседи по всему вектору тегов (nearGames), а пока их
   * не залили — соседи по тегу полки (topTagOf, pickSimilar); пусто, если
   * тегов нет
   */
  similar: SimilarGame[]
  /**
   * По какому тегу подобрана полка — он же стоит в заголовке блока. null у
   * готовых соседей: они похожи всем вектором, и один тег в заголовке был бы
   * неправдой; общее у каждой пары стоит под её плиткой (SimilarGame.shared)
   */
  similarTag: string | null
  /**
   * «Чем выделяется»: до двух характерных тегов (lib/hook, английскими
   * ключами). null — сказать честно нечего: нет карты тегов или ни один тег
   * не прошёл порог. Строку из него собирает gameTraits.
   */
  hook: string[] | null
}

export type ReviewFacts = {
  /** Доля положительных отзывов, 0…100. */
  percent: number
  /** Сколько отзывов учтено. */
  total: number
  /**
   * Словесная оценка Steam («Very Positive»). Есть ТОЛЬКО когда пришла
   * сводка: выводить её из процента мы намеренно не будем — это была бы наша
   * догадка, выданная за оценку площадки.
   */
  label: string | null
}

/**
 * Оценка игры из того, что есть.
 *
 * Страница называется «стоит ли играть», а кольцо с процентом рисовалось
 * только из reviews_summary_json — отдельной сводки, которую наполняет крон.
 * В каталоге на тысячу игр её нет у 278. То есть 28% страниц не отвечали на
 * вопрос из собственного заголовка — при том что reviews_percent и
 * reviews_total лежат в той же строке базы и заполнены у ВСЕХ до одной.
 * Half-Life: Opposing Force — 95% из 13 440 отзывов — показывал пустое место
 * там, где должно стоять число.
 *
 * Порядок источников: сводка точнее (в ней сырые количества, из которых
 * процент считается на месте), поэтому она первая. Колонки — запасной путь.
 *
 * Слово при этом берётся только из сводки. Числа — факт площадки, и мы их
 * пересказываем; словесная шкала — её суждение, и придумывать его за неё
 * нельзя. Без сводки рядом с кольцом остаётся «из N отзывов — за», и этого
 * достаточно: процент уже стоит внутри кольца.
 */
export function reviewFacts(
  meta: Pick<GameMeta, 'reviewsPercent' | 'reviewsTotal'>,
  summary: GamePageData['reviewsSummary'],
): ReviewFacts | null {
  const counted = summary ? summary.totalPositive + summary.totalNegative : 0
  if (summary && counted > 0) {
    return {
      percent: Math.round((summary.totalPositive / counted) * 100),
      total: counted,
      label: summary.scoreDesc,
    }
  }
  const { reviewsPercent, reviewsTotal } = meta
  if (typeof reviewsPercent === 'number' && typeof reviewsTotal === 'number' && reviewsTotal > 0) {
    return { percent: Math.max(0, Math.min(100, Math.round(reviewsPercent))), total: reviewsTotal, label: null }
  }
  return null
}

/** Сколько игр стоит на полке «Похожие». */
export const SIMILAR_SHOWN = 6

/**
 * Из скольких кандидатов полка выбирает свои шесть. Больше — ссылки разойдутся
 * по большему числу карточек, но в полку чаще попадут менее характерные
 * соседи. Тридцать — по замеру на каталоге, см. pickSimilar.
 */
export const SIMILAR_CANDIDATES = 30

/**
 * Среди скольких первых по весу тегов ищется тег полки. Без потолка редкость
 * вытаскивала хвост: у The Witcher 3 полка стала бы «Похожие · Nudity», у DayZ
 * с его ровными весами — «Choose Your Own Adventure». Пять — примерно столько
 * тегов Steam показывает у игры сразу, без раскрытия списка.
 */
const SHELF_TAG_POOL = 5

/** Тег, который в каталоге есть меньше чем у семи игр, полку не наполнит. */
const SHELF_MIN_GAMES = SIMILAR_SHOWN + 1

/**
 * Тег, по которому подбирается полка «Похожие».
 *
 * Вес в tags_json — это характерность, а не популярность, поэтому «первый по
 * весу» означает «чем эта игра является больше всего». Но первым почти всегда
 * стоит широкий тег — Action, Free to Play, RPG, — и полка превращалась в
 * случайную выборку из тысяч игр: у God of War «Похожие · Action», у Dota 2 —
 * «Похожие · Free to Play». С картой тегов каталога (loadTagStats) из первых
 * пяти по весу берётся тот, у которого вес × редкость больше, — тем же
 * rarityOf, что у подбора и совместимости: God of War получает Mythology,
 * Dota 2 — MOBA, Baldur's Gate 3 — Turn-Based Combat.
 *
 * Без карты (непрогретая база, сбой чтения) или когда все пять тегов
 * частотные — прежний порядок, первый по весу.
 *
 * Тай-брейк по имени обязателен: страница кэшируется на сутки и пререндерится,
 * и блок «похожие» не должен меняться от того, в каком порядке Object.entries
 * вернул ключи после очередной пересборки каталога.
 */
export function topTagOf(meta: GameMeta, tagStats?: Map<string, number> | null): string | null {
  const entries = Object.entries(meta.tags ?? {}).filter(([, w]) => Number.isFinite(w))
  if (!entries.length) return null
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const top = tagStats ? rarityScale(tagStats) : 0
  if (!tagStats || !top) return entries[0][0]
  let best = entries[0][0]
  let bestScore = 0
  // Обход — по весу, затем по имени, и сравнение строгое: при равном счёте
  // побеждает более весомый тег, а при равном весе — первый по алфавиту
  for (const [tag, weight] of entries.slice(0, SHELF_TAG_POOL)) {
    if ((tagStats.get(tag) ?? 0) < SHELF_MIN_GAMES) continue
    const score = weight * rarityOf(tag, tagStats, top)
    if (score > bestScore) {
      best = tag
      bestScore = score
    }
  }
  return best
}

/**
 * Шесть соседей из кандидатов — детерминированно по appid страницы.
 *
 * Кандидаты приходят упорядоченными (topGamesByTag: характерность, затем
 * отзывы), и раньше полка была просто первой шестёркой. Тогда у всех 339
 * карточек с главным тегом Action стояли одни и те же шесть игр: каждая из них
 * получала по 338 внутренних ссылок, а 3443 из 5000 страниц карты сайта — ни
 * одной. Полка — единственная перелинковка между карточками.
 *
 * Теперь шестёрка — взвешенная выборка без возвращения (ключ u^(1/w),
 * Efraimidis–Spirakis), где вес — место с конца: верхние кандидаты попадают
 * чаще, но не всегда. Замер на копии каталога, 5000 страниц карты сайта
 * вместе с выбором тега по редкости (topTagOf): страниц со входящей ссылкой с
 * полки — 3580 вместо 1535, самая «популярная» карточка — 45 входящих вместо
 * 339. Равномерная выборка разносит чуть шире (3718 и 39), но чаще выкидывает
 * самых похожих.
 *
 * Сид — appid страницы, а не время: страница кэшируется на сутки, и полка не
 * должна меняться от пересборки к пересборке, пока не поменялись кандидаты.
 * Показываются выбранные в исходном порядке — самые характерные первыми.
 */
export function pickSimilar<T>(ranked: readonly T[], pageAppid: number, shown = SIMILAR_SHOWN): T[] {
  if (ranked.length <= shown) return [...ranked]
  const rnd = mulberry32(hashString(`similar:${pageAppid}`))
  const n = ranked.length
  return ranked
    .map((_, i) => ({ i, key: rnd() ** (1 / (n - i)) }))
    .sort((a, b) => b.key - a.key || a.i - b.i)
    .slice(0, shown)
    .map((k) => k.i)
    .sort((a, b) => a - b)
    .map((i) => ranked[i])
}

/**
 * Соседи игры — для полки «Похожие» и для «Как «X», но…» на /play.
 *
 * Сначала готовые (getNeighbors, lib/neighbors): похожие по всему вектору
 * тегов с весом редкости, посчитанные офлайн. Замер на копии каталога, 5816
 * живых игр: первая шестёрка соседей даёт входящую ссылку 5348 карточкам из
 * 5816 (полка по тегу со взвешенной выборкой — 3580), самая «популярная» —
 * 48 входящих (было 45) — и это соседи по сути, а не шесть случайных из тысяч
 * игр с тем же Action. Поэтому готовые показываются просто по порядку, без
 * выборки pickSimilar: разносить ссылки им уже не нужно.
 *
 * Меньше шести живых — прежняя полка по тегу: таблицу ещё не залили (или
 * игры не было в каталоге при сборке), а половинная полка хуже полной по
 * тегу. Это же фолбэк держит «Как «X», но…» до первой заливки.
 *
 * stats — карта тегов или её промис: соседям она не нужна, и чтение соседей
 * идёт параллельно с ней, а не после.
 */
export async function nearGames(
  db: Db,
  meta: GameMeta,
  stats: Map<string, number> | null | Promise<Map<string, number> | null>,
): Promise<{ games: SimilarGame[]; tag: string | null; basis: 'neighbors' | 'tag' | 'none' }> {
  if (!Object.keys(meta.tags ?? {}).length) return { games: [], tag: null, basis: 'none' }
  const near = await getNeighbors(db, meta.appid, NEIGHBORS_K)
  if (near.length >= SIMILAR_SHOWN) return { games: near, tag: null, basis: 'neighbors' }
  const tag = topTagOf(meta, await stats)
  if (!tag) return { games: [], tag: null, basis: 'none' }
  return {
    games: await topGamesByTag(db, tag, meta.appid, SIMILAR_CANDIDATES),
    tag,
    basis: 'tag',
  }
}

/**
 * Карта тегов каталога для выбора тега полки — с памятью на процесс.
 *
 * loadTagStats читает всю таблицу tags, около 430 строк, а карточка — самая
 * массовая страница: пять тысяч адресов в карте сайта, у каждой ещё и
 * OG-картинка. Без памяти один проход краулера стоил бы больше двух миллионов
 * прочитанных строк Turso ради карты, которая меняется только с заливкой
 * каталога. Шесть часов — с запасом короче суток, на которые кэшируется сама
 * страница.
 *
 * Ключ — сам клиент базы: в проде он один на процесс (lib/server), а тесты с
 * базой в памяти не видят чужих карт. Сбой чтения не кэшируется и страницу не
 * роняет — полка просто подбирается по-старому.
 */
const TAG_STATS_TTL_SEC = 6 * 3600
const tagStatsMemo = new WeakMap<Db, { at: number; stats: Map<string, number> }>()

async function tagStatsFor(db: Db, nowSec: number): Promise<Map<string, number> | null> {
  const hit = tagStatsMemo.get(db)
  if (hit && nowSec - hit.at < TAG_STATS_TTL_SEC) return hit.stats
  try {
    const stats = await loadTagStats(db)
    tagStatsMemo.set(db, { at: nowSec, stats })
    return stats
  } catch (err) {
    logSwallowed('gamepage:tagstats', err)
    return hit?.stats ?? null
  }
}

/**
 * Вердикт мёртвой игре — одной фразой, словами, а не кодом причины.
 *
 * Курация каталога знает про 181 карточку, что играть в неё сегодня не выйдет:
 * у Dirty Bomb и Team Fortress Classic пустые серверы, у Kerbal Space Program 2
 * разгромные отзывы. Из подбора, карты сайта и «Похожих» они убраны, но по
 * прямой ссылке и из старого индекса страница отвечала на «стоит ли играть»
 * кнопкой «Запустить» и молчала о том, что продукт уже решил.
 *
 * Фраза без чисел: число рядом уже нарисовано — онлайн строкой PlayersNow,
 * доля отзывов в кольце. Повторять его здесь значило бы завести второе число,
 * которое разойдётся с первым после очередного замера.
 */
const DEAD_VERDICT: Record<DeadReason, string> = {
  'dead-multiplayer': 'Сетевая игра, в которой почти не осталось людей, — матч, скорее всего, не соберётся.',
  panned: 'Большинство отзывов отрицательные — игроки её не советуют.',
  'asset-flip': 'Отзывов почти нет — судить о ней пока не по чему.',
  'solo-only': 'В неё играют только в одиночку — компанию здесь не собрать.',
}

/** Причина неизвестна, а курация всё равно сняла игру с подбора */
const DEAD_VERDICT_UNKNOWN = 'Из подбора она снята: по нашим данным, сегодня это не лучший выбор.'

/**
 * Есть ли у страницы свежее число, которым проверяется эта причина. Без него
 * спорить с курацией нечем, и верим ей; с ним — верим ему.
 */
const SIGNAL_OF: Record<DeadReason, (m: GameMeta) => boolean> = {
  'dead-multiplayer': (m) => m.ccu !== undefined || m.reviews30d !== undefined,
  panned: (m) => m.reviewsPercent !== undefined && m.reviewsTotal !== undefined,
  'asset-flip': (m) => m.reviewsTotal !== undefined,
  'solo-only': () => true,
}

/**
 * Фраза-вердикт для мёртвой игры, либо null.
 *
 * Курация пишет alive раз в прогон, а онлайн и отзывы обновляются чаще —
 * поэтому вердикт сверяется с теми числами, что стоят на странице сейчас.
 * У игры, в которую вернулись люди, строка «2 400 сейчас играют» рядом с
 * «почти не осталось людей» была бы ровно той ложью, против которой вердикт и
 * заведён. Если свежие числа с курацией спорят — молчим; если согласны, но по
 * другой причине, — называем ту, что видно на странице.
 */
export function deadVerdict(meta: GameMeta): string | null {
  if (meta.alive !== false) return null
  const now = judgeLiveness({
    categories: meta.categories,
    ccu: meta.ccu,
    reviews30d: meta.reviews30d,
    reviewsTotal: meta.reviewsTotal,
    reviewsPercent: meta.reviewsPercent,
  })
  if (!now.alive && now.reason) return DEAD_VERDICT[now.reason]
  const stored = meta.deadReason
  if (!stored) return DEAD_VERDICT_UNKNOWN
  return SIGNAL_OF[stored](meta) ? null : DEAD_VERDICT[stored]
}

/** Потолок описания — в lib/clip, рядом с обрезкой; отсюда его берут тесты карточки */
export { DESCRIPTION_MAX }

/**
 * Написан ли текст по-русски.
 *
 * short_description каталог берёт у магазина с language=english, и русский
 * есть только у тех карточек, до которых дошёл крон страниц. Выборка из 25
 * адресов карты сайта: английский хвост у 19. Кириллицы больше, чем латиницы, —
 * а не «есть хоть одна буква»: названия и аббревиатуры в русском тексте
 * латиницей («Станьте вором в VR!») его русским быть не мешают.
 */
export function isRussianText(text: string | null | undefined): boolean {
  if (!text) return false
  const cyr = text.match(/[А-Яа-яЁё]/g)?.length ?? 0
  const lat = text.match(/[A-Za-z]/g)?.length ?? 0
  return cyr > 0 && cyr >= lat
}

/** Пункт из pros/cons как предложение: без своей точки в конце, одной строкой */
function point(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/[.,;:!?…]+$/, '')
}

/**
 * meta description карточки игры.
 *
 * Было `имя: 93% положительных отзывов · Action, FPS, Shooter · <первые 120
 * символов short_description>` — 190–207 символов, английские теги и у
 * трёх карточек из четырёх английский хвост, оборванный посреди слова. А
 * главное, что есть у страницы своего — «за что любят» и «за что ругают» по-
 * русски, — в сниппет не попадало вовсе.
 *
 * Теперь фразы идут по важности и берутся целиком, пока влезают:
 *   вердикт мёртвой игре — он и есть ответ на «стоит ли играть»;
 *   доля положительных и число отзывов — те же, что в кольце на странице;
 *   первый пункт «любят» и первый «ругают»;
 *   описание магазина — только русское и одно оно обрезается по слову.
 */
export function gameDescription({
  meta,
  facts,
  prosCons,
  verdict,
}: {
  meta: GameMeta
  facts: ReviewFacts | null
  prosCons: ProsCons | null
  verdict: string | null
}): string {
  const phrases: Array<{ text: string; clip?: boolean }> = []
  if (verdict) phrases.push({ text: verdict })
  if (facts) {
    const total = facts.total.toLocaleString('ru-RU')
    const noun = plural(facts.total, 'отзыва', 'отзывов', 'отзывов')
    phrases.push({ text: `${facts.percent}% из ${total} ${noun} — положительные.` })
  }
  const pro = prosCons?.pros[0]
  const con = prosCons?.cons[0]
  if (pro) phrases.push({ text: `Любят: ${point(pro)}.` })
  if (con) phrases.push({ text: `Ругают: ${point(con)}.` })
  if (meta.shortDescription && isRussianText(meta.shortDescription)) {
    phrases.push({ text: meta.shortDescription.replace(/\s+/g, ' ').trim(), clip: true })
  }

  const head = `${meta.name}:`
  let out = head
  for (const p of phrases) {
    const room = DESCRIPTION_MAX - out.length - 1
    const text = p.clip ? clip(p.text, room) : p.text.length <= room ? p.text : null
    if (text) out += ` ${text}`
  }
  if (out === head) out = `${meta.name} — отзывы, теги и патчноуты на русском.`
  // Длинное название само по себе может не влезть — режем и его, по слову
  return clip(out, DESCRIPTION_MAX) ?? out.slice(0, DESCRIPTION_MAX)
}

/*
 * Строка сессии переехала в lib/gametraits: её показывают и клиентские экраны
 * (герой /play, колода пати), а этот модуль тянет за собой базу. Реэкспорт —
 * ради карточки игры и её тестов, которые берут всё отсюда.
 */
export { SESSION_MIN_CONFIDENCE, sessionTrait, type GameTrait } from './gametraits'

/**
 * «Чем выделяется» — характерные теги игры (distinctiveTags в lib/hook)
 * русскими подписями. Подпись честная: это теги, которые проставили игроки,
 * а не пересказ. null — строки нет.
 */
export function hookTrait(hook: readonly string[] | null): GameTrait | null {
  if (!hook?.length) return null
  return { label: 'Чем выделяется', value: hook.map(tagRu).join(', ') }
}

/** Строки фактов карточки по порядку; пустой список — блока нет вовсе */
export function gameTraits(
  meta: Pick<GameMeta, 'semantics' | 'categories'>,
  hook: readonly string[] | null,
): GameTrait[] {
  return [hookTrait(hook), sessionTrait(meta)].filter((t): t is GameTrait => t !== null)
}

/**
 * Собирает данные карточки игры. ТОЛЬКО ЧТЕНИЕ ИЗ БАЗЫ — ни одного сетевого
 * вызова и ни одного обращения к модели.
 *
 * Это главное правило страницы, и оно стоило дорого, пока не соблюдалось.
 * Раньше здесь на промахе кэша вызывались appdetails, appreviews и Claude.
 * Страница публичная, кэша у неё не было, а в каталоге 6000 живых игр, у
 * которых ни один из этих полей не был заполнен, — то есть один проход
 * поискового краулера означал 6000 вызовов модели и 12000 запросов к Steam.
 * Злоумышленник для этого не нужен, достаточно карты сайта.
 *
 * Ровно это правило уже было сформулировано двадцатью строками ниже для
 * патчноутов — просто не применено к остальным полям. Теперь всё, что требует
 * сети, живёт в lib/pagejob.ts и ходит по расписанию с бюджетом и темпом.
 *
 * Следствие, с которым надо считаться: игры, до которой очередь ещё не дошла,
 * карточка покажет без скриншотов и без pros/cons. Это правильный компромисс —
 * неполная страница дешевле неограниченного счёта.
 */
export async function loadGamePage(appid: number): Promise<GamePageData | null> {
  const db = await getDb()

  // Строка и оба её блоба — одним чтением: см. докблок getGamePageRow.
  const строка = await getGamePageRow(db, appid)
  // Незнакомый appid — это и есть тот случай, ради которого всё написано:
  // краулер, перебирающий пространство идентификаторов, должен получать 404
  // после одного чтения из базы, а не запускать наполнение каталога.
  if (!строка) return null
  const meta = строка.meta

  // Отрицательные appid — кураторский пул других магазинов: у Steam про них
  // ничего нет, показываем только собственные данные
  // Соседей ищем и для чужих магазинов: тег у такой записи есть, а вот патчей
  // и отзывов Steam про неё нет — поэтому блок «похожие» стоит ДО раннего
  // возврата, а не после
  //
  // Карта тегов — только когда теги есть: игре без них ни полку, ни «Чем
  // выделяется» не собрать всё равно, и читать ради неё нечего. Одна на оба
  // потребителя; tagStatsFor не бросает — сбой чтения даёт null
  const hasTags = Object.keys(meta.tags ?? {}).length > 0
  const statsOf = hasTags
    ? tagStatsFor(db, Math.floor(Date.now() / 1000))
    : Promise.resolve(null)
  const similarOf = async (): Promise<Pick<GamePageData, 'similar' | 'similarTag' | 'hook'>> => {
    const [stats, near] = await Promise.all([statsOf, nearGames(db, meta, statsOf)])
    // Редкость — по той же карте, что у полки: тег, которым игра выделяется,
    // должен быть редким по каталогу, а не просто первым по голосам
    const hook = distinctiveTags(meta, stats ? tagWeightFrom(stats) : null)
    // Готовые соседи — по порядку сходства, полка по тегу — выборкой, см. nearGames
    const similar =
      near.basis === 'neighbors' ? near.games.slice(0, SIMILAR_SHOWN) : pickSimilar(near.games, appid)
    return { similar, similarTag: near.tag, hook }
  }

  if (appid < 0) {
    return {
      meta,
      reviewsSummary: null,
      prosCons: null,
      news: [],
      ...(await similarOf()),
    }
  }

  const reviewsSummary = строка.reviewsSummary as GamePageData['reviewsSummary']
  const stored = строка.prosCons as GamePageData['prosCons']
  const [news, shelf] = await Promise.all([
    getGameNews(db, appid, 8).then((rows) => rows.map(withoutBody)),
    similarOf(),
  ])

  /*
   * Наружу отдаём ТОЛЬКО собранное моделью.
   *
   * Эвристический вариант — это первые предложения самых залайканных отзывов
   * Steam, как есть. На витрине это выглядело так: китайский, испанский,
   * зацензуренный мат и прямая непристойность в блоке «за что любят» — на
   * русскоязычной странице, лежащей в карте сайта. Отбор по числу голосов
   * этого не чинит, скорее наоборот: залайкивают как раз шутки.
   *
   * Правило стоит здесь, а не в разметке, чтобы его нельзя было обойти новым
   * потребителем и чтобы оно было покрыто тестом.
   *
   * В базе эвристику при этом храним: source: 'reviews' и есть тот маркер, по
   * которому карточка вернётся в очередь на пересборку моделью (см.
   * claimPageEnrichBatch, redoHeuristic). 'thin' — та же эвристика у игры,
   * где полезных отзывов слишком мало, чтобы звать модель (lib/pagejob.ts);
   * её не показываем тем более.
   */
  const prosCons = stored?.source === 'claude' ? stored : null

  return { meta, reviewsSummary, prosCons, news, ...shelf }
}
