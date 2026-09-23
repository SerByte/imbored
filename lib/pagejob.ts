/**
 * Один срез работы по карточкам игр: догрузить скриншоты, трейлер и описание,
 * посчитать вердикт отзывов, собрать pros/cons и семантику игры
 * (lib/semantics).
 *
 * Раньше всё это делала сама страница /game/[appid] на рендере. Страница
 * публичная, кэша у неё не было, а в каталоге 6000 живых игр — то есть один
 * проход краулера стоил 6000 вызовов модели и 12000 запросов к Steam, причём
 * без злого умысла с чьей-либо стороны. Правило «за сетью с публичной страницы
 * не ходим» уже было записано в lib/gamepage.ts для патчноутов; здесь оно
 * доведено до остальных полей карточки.
 *
 * Логика живёт здесь, а не в роуте крона, ровно по той же причине, что и у
 * runNewsSlice: vitest собирает только lib/, и этот же срез гоняет ручной
 * скрипт scripts/enrich-pages.ts — расписание и разовый прогон обязаны делать
 * одно и то же.
 */

import { fetchAppDetails, fetchStoreMedia, mergeMeta } from './catalog'
import { sliceClock } from './cron'
import {
  claimPageEnrichBatch,
  getGameMeta,
  markPageEnriched,
  markPageMissed,
  setGameJson,
  setGamesMedia,
  upsertGameMeta,
  upsertSemantics,
  type Db,
} from './db'
import { logSwallowed } from './errlog'
import { claudeProsCons, llmAvailable, LLM_MIN_BUDGET_MS, LlmUnavailableError } from './llm'
import { fetchReviewsRaw, heuristicProsCons, parseReviews, type ProsCons } from './reviews'
import { mineReviews, parseReviewsRaw } from './reviewmine'
import { deriveSemantics } from './semantics'

/** Раз в полгода карточку стоит перечитать: отзывы и цена уезжают. */
export const PAGE_MAX_AGE_SEC = 180 * 86_400

/**
 * Сколько раз подряд возвращаться за карточкой, из-за которой поход вернулся
 * пустым.
 *
 * Четыре, потому что типичная причина пустого похода — лимит appdetails, а он
 * снимается за минуты: следующий же прогон обычно и привозит данные. Больше
 * четырёх — это уже игра, которой у Steam нет, и держать её в очереди не за
 * чем: дождётся общего срока устаревания вместе со всеми.
 */
export const PAGE_MAX_TRIES = 4

/** Сколько цитат берём в эвристический фолбэк. */
const PROS_CONS_COUNT = 4

/**
 * Сколько отзывов с хотя бы одним «полезно» нужно, чтобы звать модель.
 *
 * Pros/cons уходят на публичную /game/[appid], которая лежит в карте сайта, а
 * собираются из текста посторонних людей. У малоизвестной игры в выборку
 * попадает любой отзыв — в том числе написанный под модель: реклама, домен,
 * «игнорируй инструкции». Отметка «полезно» от другого игрока — дешёвый, но
 * настоящий фильтр: такой отзыв хоть кто-то прочёл и не счёл мусором. Если
 * таких меньше пяти, повторяющегося в отзывах просто нет — модели не из чего
 * выделять «то, что реально повторяется», и её не зовём вовсе.
 */
export const PROS_CONS_MIN_REVIEWS = 5

/**
 * Подряд идущие отказы на РАЗНЫХ играх означают, что Steam закрылся от нашего
 * IP, а не что игры плохие. Останавливаемся, не штампуя весь набор.
 *
 * Считается ОТДЕЛЬНО по двум ручкам, и это не педантизм. Отзывы и appdetails
 * живут на разных лимитах, и закрыться может любая из них поодиночке. Пока
 * страж смотрел только на отзывы, душимый appdetails его не трогал вовсе:
 * счётчик обнулялся на каждом удачном ответе отзывов, срез доходил до конца
 * и помечал ВЕСЬ набор как «сходили, не привезли». Это и есть механизм, из-за
 * которого 596 карточек из 721 остались без скриншотов на полгода, — и без
 * отдельного счётчика повторные попытки просто сгорели бы тем же способом за
 * четыре прогона.
 */
export const MAX_BLOCKED_RUN = 3

export type PageSliceResult = {
  claimed: number
  /** Карточек, получивших отметку в очереди: удачную или «сходили впустую» */
  enriched: number
  /**
   * Карточек, отказ на которых списан на блок Steam: отметки у них нет, и
   * следующий срез возьмёт их первыми. См. «подозреваемые» в runPageSlice.
   */
  deferred: number
  withShots: number
  /** Карточек среза, которым пачка GetItems привезла трейлер */
  withTrailers: number
  withProsCons: number
  viaClaude: number
  /** Карточек, получивших запись в game_semantics (по тегам или с отзывами) */
  withSemantics: number
  hasMore: boolean
  stopped: 'done' | 'budget' | 'blocked'
}

export async function runPageSlice(
  db: Db,
  opts: {
    deadlineAt: number
    nowSec?: number
    limit?: number
    /** подменяются в тестах: иначе прогон уходит и в сеть, и в лимитер темпа */
    fetchDetails?: typeof fetchAppDetails
    /** кадры и трейлеры всего среза одним GetItems */
    fetchMediaFn?: typeof fetchStoreMedia
    /** сырой ответ appreviews — один на вердикт, pros/cons и семантику */
    fetchReviewsRawFn?: typeof fetchReviewsRaw
    prosConsFn?: typeof claudeProsCons
    /** подменяется в тестах: сбой семантики не имеет права ронять карточку */
    semanticsFn?: typeof deriveSemantics
    /**
     * Явное «модель не зовём» для --no-llm. Без него флаг работал наоборот:
     * заглушка приезжала как prosConsFn, Boolean(prosConsFn) включал useClaude,
     * тот включал redoHeuristic — и прогон вечно перезабирал те же карточки,
     * переписывая эвристику эвристикой по два запроса в Steam на каждую.
     */
    useClaude?: boolean
    onProgress?: (line: string) => void
  },
): Promise<PageSliceResult> {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000)
  const limit = opts.limit ?? 20
  const details = opts.fetchDetails ?? fetchAppDetails
  const mediaOf = opts.fetchMediaFn ?? fetchStoreMedia
  const reviewsOf = opts.fetchReviewsRawFn ?? fetchReviewsRaw
  const prosConsOf = opts.prosConsFn ?? claudeProsCons
  const semanticsOf = opts.semanticsFn ?? deriveSemantics
  const log = opts.onProgress ?? (() => {})

  // Модель зовём, только если ключ есть. Без этой проверки каждая карточка
  // впустую тратила бы попытку, а page_at всё равно проставлялся бы — то есть
  // забытый ключ выжигал бы очередь на полгода вперёд.
  const useClaude = opts.useClaude ?? (Boolean(opts.prosConsFn) || llmAvailable())

  // Когда модель есть, в очередь возвращаются и карточки, собранные раньше без
  // неё: page_at значит «в сеть сходили», а не «карточка готова». Без ключа
  // такой пересборки нет — иначе очередь бесконечно крутилась бы на одних и
  // тех же играх, каждый раз переписывая эвристику эвристикой.
  const targets = await claimPageEnrichBatch(db, now - PAGE_MAX_AGE_SEC, limit, {
    maxTries: PAGE_MAX_TRIES,
    redoHeuristic: useClaude,
  })

  let enriched = 0
  let withShots = 0
  let withTrailers = 0
  let withProsCons = 0
  let viaClaude = 0
  let withSemantics = 0
  let blockedRun = 0
  /** Отказы appdetails подряд — своя ось, см. MAX_BLOCKED_RUN. */
  let detailsBlocked = 0
  let stopped: PageSliceResult['stopped'] = 'done'
  let claudeDown = false

  /*
   * Карточки, на которых отказала сеть, ждут приговора, а не отметки.
   *
   * Отметка «сходили впустую» (markPageMissed) тратит попытку из
   * PAGE_MAX_TRIES, а после последней карточка уходит ждать общего срока —
   * полгода. Но серия отказов, на которой срабатывает страж, — это Steam,
   * закрывшийся от IP Vercel на несколько часов (lib/gamepage.ts:43), а не
   * плохие игры. Страж останавливал срез, но три карточки из головы очереди —
   * верх каталога — к тому моменту уже получили по штрафу, и четыре дня блока
   * хоронили их на полгода без скриншотов. Если отзывы при этом приехали, а
   * appdetails — нет, карточка и вовсе получала «обогащена» и полгода стояла
   * без вердикта отзывов.
   *
   * Поэтому отказ сети откладывает отметку до конца серии. Серию оборвал
   * чистый поход — отказы были про отдельные игры, и отметки прежние. Серия
   * довела стража до блока — отметок нет вовсе: карточка остаётся в очереди
   * ровно в том месте, где стояла, и срез после блока возьмёт её первой.
   * Всё, что успело приехать (appdetails или отзывы), уже записано выше.
   *
   * Отметку не подделываем и под «вернуться через сутки» (page_at в прошлом):
   * карточка без page_at из первой группы выборки переехала бы во вторую, за
   * пять тысяч нетронутых, а карта сайта отдала бы поддельный lastmod.
   * Повтор и так не раньше следующего среза — блок останавливает цепочку.
   */
  let подозреваемые: Array<{ appid: number; fresh: boolean }> = []
  const отметить = async (appid: number, fresh: boolean): Promise<void> => {
    if (fresh) await markPageEnriched(db, appid, now)
    else await markPageMissed(db, appid, now)
    enriched++
  }
  let deferred = 0

  /*
   * Кадры и трейлеры — одной пачкой GetItems на весь срез, до карточек.
   *
   * Не по запросу на карточку: GetItems берёт до двухсот appid за раз, и
   * двадцать игр среза — это один поход на ~130 КБ. Не в прогреве библиотеки:
   * там тот же ответ втрое тяжелее обычного на каждой пачке (см.
   * STORE_MEDIA_DATA_REQUEST в lib/catalog).
   *
   * Пишется узким UPDATE (setGamesMedia) раньше карточек, и порядок важен:
   * карточка ниже читает строку (getGameMeta) и сливает с ответом appdetails
   * через mergeMeta — трейлер переезжает в её запись нетронутым, а кадры
   * appdetails, если приехали, ложатся поверх тех же самых кадров. Если же
   * appdetails отказал — а именно так 596 карточек верха каталога полгода
   * стояли без скриншотов, — кадры у игры всё равно будут.
   *
   * Отказ здесь — не повод останавливать срез и не отказ «про игру»: это
   * другая ручка (api.steampowered.com) со своим лимитом, и стражи блока
   * ниже её не считают. Без медиа карточка наполняется как раньше.
   */
  try {
    const media = await mediaOf(targets)
    withTrailers = [...media.values()].filter((m) => m.trailer).length
    await setGamesMedia(
      db,
      [...media].map(([appid, m]) => ({ appid, ...m })),
    )
  } catch (err) {
    withTrailers = 0
    logSwallowed('pagejob:media', err, { batch: targets.length })
  }

  // Не «прошёл ли срок», а «уложится ли ещё одна карточка» — см. sliceClock.
  // Карточка, начатая на 48-й секунде бюджета, раньше доезжала до конца уже
  // за maxDuration: снимали весь вызов вместе с finally, где передача звена.
  const часы = sliceClock(opts.deadlineAt)

  for (const appid of targets) {
    if (!часы.next()) {
      stopped = 'budget'
      break
    }

    // ---- скриншоты и описание ----
    // Описание на языке сайта, жанры и полные кадры — у appdetails, и ходить
    // туда можно только отсюда. Кадры из пачки GetItems выше — страховка на
    // случай его отказа.
    let sawNetworkFailure = false
    // Отказ СЕТИ отличается от «Steam про эту игру ничего не знает»:
    // fetchAppDetails бросает на не-2xx и таймауте, а null возвращает, когда
    // ответ пришёл, но игры в нём нет. Останавливать срез стоит только за
    // первое: второе — про игру, а не про наш IP.
    let sawDetailsFailure = false
    const fresh = await details(appid).catch((err: unknown) => {
      logSwallowed('pagejob:appdetails', err, { appid })
      sawNetworkFailure = true
      sawDetailsFailure = true
      return null
    })
    if (fresh) detailsBlocked = 0
    else if (sawDetailsFailure) detailsBlocked++
    /** Теги, с которыми карточка ушла в базу: семантике не нужно второе чтение */
    let tags: Record<string, number> | null = null
    if (fresh) {
      const existing = await getGameMeta(db, appid)
      const merged = mergeMeta(existing, fresh)
      // теги из GetItems точнее, чем из appdetails: не даём их перетереть
      if (existing && Object.keys(existing.tags).length) merged.tags = existing.tags

      // Цена в этом ответе только что из магазина — датируем замер, иначе
      // скидка приедет и тут же будет отброшена как «неизвестной свежести».
      if (fresh.priceFinal !== undefined) merged.priceAt = now
      // Срок распродажи знает только GetItems, appdetails его не отдаёт вовсе.
      // Пока процент тот же и срок ещё не вышел — это та же акция, и дату
      // конца незачем терять из-за того, что данные приехали другой ручкой.
      // Проверка «не вышел» обязательна: иначе новая распродажа с тем же
      // процентом унаследовала бы прошлогоднюю дату и погасла бы на месте.
      if (
        existing?.discountEndsAt !== undefined &&
        existing.discountEndsAt > now &&
        fresh.discountPercent === existing.discountPercent
      ) {
        merged.discountEndsAt = existing.discountEndsAt
      }

      await upsertGameMeta(db, merged, now)
      tags = merged.tags
      if (merged.screenshots?.length) withShots++
    }

    // ---- отзывы, вердикт и pros/cons ----
    // Один запрос на всё: вердикт и pros/cons разбирают ответ здесь, семантика
    // — ниже, из того же ответа
    let reviewsAnswered = true
    const raw: unknown = await reviewsOf(appid).catch((err: unknown) => {
      logSwallowed('pagejob:reviews', err, { appid })
      sawNetworkFailure = true
      reviewsAnswered = false
      return null
    })
    const parsed = parseReviews(raw)

    if (parsed) {
      blockedRun = 0
      await setGameJson(db, appid, 'reviews_summary_json', {
        scoreDesc: parsed.scoreDesc,
        totalPositive: parsed.totalPositive,
        totalNegative: parsed.totalNegative,
      })

      // Эвристику считаем ВСЕГДА и пишем первой. Так карточка получает
      // содержание даже если модели нет, а Claude потом только улучшает —
      // тот же порядок, что у масштаба патчей в runNewsSlice.
      const h = heuristicProsCons(parsed.reviews, PROS_CONS_COUNT)
      // В модель — только отзывы, которые кто-то отметил полезными: см.
      // PROS_CONS_MIN_REVIEWS
      const useful = parsed.reviews.filter((r) => r.votesUp >= 1)
      /*
       * Мало полезных отзывов — модель не зовём, и маркер у эвристики другой.
       *
       * 'reviews' значит «собрано без модели, пересобрать, когда она будет»:
       * по нему claimPageEnrichBatch возвращает карточку в очередь на каждом
       * прогоне. Здесь пересобирать нечем — модель не позовём и в следующий
       * раз, — и с тем же маркером карточка крутилась бы в очереди вечно, по
       * два запроса в Steam за круг. 'thin' очередь не трогает: карточка
       * дождётся общего срока устаревания, а там, глядишь, отзывов прибавится.
       * На странице не показывается ни то ни другое (lib/gamepage.ts).
       *
       * Пишется и с пустыми списками: иначе старый маркер 'reviews' от
       * прошлого прогона остался бы на месте и держал ту же петлю.
       */
      const thin = useful.length < PROS_CONS_MIN_REVIEWS
      let prosCons: ProsCons | null = thin
        ? { ...h, source: 'thin' }
        : h.pros.length || h.cons.length
          ? { ...h, source: 'reviews' }
          : null

      /*
       * Остаток бюджета — внутрь вызова, а не только на вход в карточку.
       *
       * Срок проверяется в начале цикла; между той проверкой и этой строкой
       * лежат два похода в Steam с шагом пейсера. Зашли на 45с — и вызов, у
       * которого своих 30с × 2, доводит инстанс до maxDuration. Дальше
       * снимают весь срез: finally не отрабатывает, цепочка не передаётся,
       * аренда не снимается. Ради одной карточки из полусотни.
       *
       * Если остатка мало — не зовём вовсе. Эвристика уже посчитана и записана
       * выше, карточка не пустая, а к Клоду она вернётся сама: ветка
       * redoHeuristic в claimPageEnrichBatch как раз и выбирает те, у кого
       * source === 'reviews'.
       */
      const бюджет = opts.deadlineAt - Date.now()
      if (useClaude && !claudeDown && !thin && бюджет >= LLM_MIN_BUDGET_MS) {
        try {
          const fromClaude = await prosConsOf(fresh?.name ?? `Игра ${appid}`, useful, бюджет)
          if (fromClaude && (fromClaude.pros.length || fromClaude.cons.length)) {
            prosCons = { ...fromClaude, source: 'claude' }
            viaClaude++
          }
        } catch (e) {
          // Сервис недоступен (пустой баланс, отозванный ключ, квота) — это не
          // про эту игру. Дальше в этом срезе модель не зовём, но работу не
          // бросаем: эвристика уже посчитана и карточка будет наполнена.
          if (e instanceof LlmUnavailableError) {
            // onProgress слышит только ручной прогон; в кроне это единственный след
            logSwallowed('pagejob:pros-cons', e)
            claudeDown = true
            log(`  pros/cons недоступны (${e.status ?? '—'}), дальше только эвристика`)
          } else {
            throw e
          }
        }
      }

      if (prosCons) {
        await setGameJson(db, appid, 'pros_cons_json', prosCons)
        if (prosCons.pros.length || prosCons.cons.length) withProsCons++
      }
    } else if (sawNetworkFailure) {
      blockedRun++
    }

    // ---- семантика: из того же ответа, без нового запроса и без модели ----
    /*
     * parseReviewsRaw берёт ВСЕ отзывы ответа, а не отобранные для pros/cons:
     * там порог в два часа игры, а здесь короткий негатив «через час бросил»
     * и есть сигнал медленного старта (lib/reviewmine).
     *
     * Отзывов нет, их мало или сеть отказала — пишется приор по тегам. Он
     * ничего не стоит и не затрёт посчитанного раньше по отзывам: это решает
     * сама upsertSemantics. Отметка reviews_at ставится, если Steam ответил,
     * — даже пустым или битым ответом: такую игру незачем перезапрашивать
     * semantics:build --with-reviews, ответ был бы тем же.
     *
     * Сбой здесь — не Steam, а код или база, и карточку он не роняет:
     * скриншоты и pros/cons уже записаны, отметка очереди — ниже. Семантика
     * вернётся со следующим обходом карточки.
     */
    try {
      const known = tags ?? (await getGameMeta(db, appid))?.tags ?? {}
      const all = parseReviewsRaw(raw)
      const semantics = semanticsOf(known, all ? mineReviews(all) : null)
      await upsertSemantics(db, [
        { appid, semantics, computedAt: now, reviewsAt: reviewsAnswered ? now : null },
      ])
      withSemantics++
    } catch (err) {
      logSwallowed('pagejob:semantics', err, { appid })
    }

    /*
     * Отметку ставим в любом случае — даже когда Steam ничего не отдал: иначе
     * одна проблемная игра навсегда осталась бы первой в очереди и забирала
     * весь суточный бюджет на себя. Единственное исключение — блок Steam, см.
     * «подозреваемые» выше. Но отметки теперь ДВЕ, и это весь смысл правки.
     *
     * Раньше пустой поход был неотличим от удачного, и карточка выпадала из
     * очереди на полгода. На проде это стоило так: из 721 обогащённой карточки
     * скриншоты и жанры приехали к 125. Недостающие 596 — верх каталога по
     * числу отзывов, то есть ровно те страницы, ради которых всё и делается.
     * Проверено вручную: appdetails отдаёт по этим играм и скриншоты, и жанры
     * прямо сейчас — данные были доступны всё это время.
     *
     * Признак удачи — appdetails: скриншоты, жанры и описание есть только
     * там (см. комментарий про GetItems выше). Отзывы живут своей ручкой,
     * своим лимитом и, судя по тому же замеру, почти не отказывают.
     */
    if (sawNetworkFailure) {
      подозреваемые.push({ appid, fresh: Boolean(fresh) })
    } else {
      // Чистый поход оборвал серию: отказы перед ним — про сами игры.
      for (const p of подозреваемые) await отметить(p.appid, p.fresh)
      подозреваемые = []
      await отметить(appid, Boolean(fresh))
    }

    if (blockedRun >= MAX_BLOCKED_RUN || detailsBlocked >= MAX_BLOCKED_RUN) {
      // Блок: подозреваемые не виноваты, отметок не ставим.
      deferred = подозреваемые.length
      подозреваемые = []
      stopped = 'blocked'
      break
    }
  }

  // Срез кончился не блоком (срок или конец пачки): серию, не дошедшую до
  // стража, блоком не доказать, и отметки у неё прежние.
  for (const p of подозреваемые) await отметить(p.appid, p.fresh)

  if (enriched) log(`  карточек обогащено: ${enriched}, с семантикой: ${withSemantics}`)
  if (deferred) log(`  Steam закрылся: отложено без отметки ${deferred}`)

  return {
    claimed: targets.length,
    enriched,
    deferred,
    withShots,
    withTrailers,
    withProsCons,
    viaClaude,
    withSemantics,
    hasMore: targets.length === limit && stopped !== 'blocked',
    stopped,
  }
}
