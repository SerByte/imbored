/**
 * Один срез работы по карточкам игр: догрузить скриншоты и описание, посчитать
 * вердикт отзывов, собрать pros/cons.
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

import { fetchAppDetails, mergeMeta } from './catalog'
import {
  claimPageEnrichBatch,
  getGameMeta,
  markPageEnriched,
  markPageMissed,
  setGameJson,
  upsertGameMeta,
  type Db,
} from './db'
import { claudeProsCons, llmAvailable, LLM_MIN_BUDGET_MS, LlmUnavailableError } from './llm'
import { fetchReviews, heuristicProsCons, type ParsedReviews } from './reviews'

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
  enriched: number
  withShots: number
  withProsCons: number
  viaClaude: number
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
    fetchReviewsFn?: typeof fetchReviews
    prosConsFn?: typeof claudeProsCons
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
  const reviewsOf = opts.fetchReviewsFn ?? fetchReviews
  const prosConsOf = opts.prosConsFn ?? claudeProsCons
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
  let withProsCons = 0
  let viaClaude = 0
  let blockedRun = 0
  /** Отказы appdetails подряд — своя ось, см. MAX_BLOCKED_RUN. */
  let detailsBlocked = 0
  let stopped: PageSliceResult['stopped'] = 'done'
  let claudeDown = false

  for (const appid of targets) {
    if (Date.now() > opts.deadlineAt) {
      stopped = 'budget'
      break
    }

    // ---- скриншоты и описание ----
    // GetItems их не отдаёт (см. mergeMeta), поэтому единственный источник —
    // appdetails, и ходить туда можно только отсюда.
    let sawNetworkFailure = false
    // Отказ СЕТИ отличается от «Steam про эту игру ничего не знает»:
    // fetchAppDetails бросает на не-2xx и таймауте, а null возвращает, когда
    // ответ пришёл, но игры в нём нет. Штрафовать очередь стоит только за
    // второе.
    let sawDetailsFailure = false
    const fresh = await details(appid).catch(() => {
      sawNetworkFailure = true
      sawDetailsFailure = true
      return null
    })
    if (fresh) detailsBlocked = 0
    else if (sawDetailsFailure) detailsBlocked++
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
      if (merged.screenshots?.length) withShots++
    }

    // ---- отзывы, вердикт и pros/cons ----
    const parsed: ParsedReviews | null = await reviewsOf(appid).catch(() => {
      sawNetworkFailure = true
      return null
    })

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
      let prosCons: { pros: string[]; cons: string[]; source: 'claude' | 'reviews' } | null =
        h.pros.length || h.cons.length ? { ...h, source: 'reviews' } : null

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
      if (useClaude && !claudeDown && parsed.reviews.length && бюджет >= LLM_MIN_BUDGET_MS) {
        try {
          const fromClaude = await prosConsOf(fresh?.name ?? `Игра ${appid}`, parsed.reviews, бюджет)
          if (fromClaude && (fromClaude.pros.length || fromClaude.cons.length)) {
            prosCons = { ...fromClaude, source: 'claude' }
            viaClaude++
          }
        } catch (e) {
          // Сервис недоступен (пустой баланс, отозванный ключ, квота) — это не
          // про эту игру. Дальше в этом срезе модель не зовём, но работу не
          // бросаем: эвристика уже посчитана и карточка будет наполнена.
          if (e instanceof LlmUnavailableError) {
            claudeDown = true
            log(`  pros/cons недоступны (${e.status ?? '—'}), дальше только эвристика`)
          } else {
            throw e
          }
        }
      }

      if (prosCons) {
        await setGameJson(db, appid, 'pros_cons_json', prosCons)
        withProsCons++
      }
    } else if (sawNetworkFailure) {
      blockedRun++
    }

    /*
     * Отметку ставим в любом случае — даже когда Steam ничего не отдал: иначе
     * одна проблемная игра навсегда осталась бы первой в очереди и забирала
     * весь суточный бюджет на себя. Но отметки теперь ДВЕ, и это весь смысл
     * правки.
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
    if (fresh) await markPageEnriched(db, appid, now)
    else await markPageMissed(db, appid, now)
    enriched++

    if (blockedRun >= MAX_BLOCKED_RUN || detailsBlocked >= MAX_BLOCKED_RUN) {
      stopped = 'blocked'
      break
    }
  }

  if (enriched) log(`  карточек обогащено: ${enriched}`)

  return {
    claimed: targets.length,
    enriched,
    withShots,
    withProsCons,
    viaClaude,
    hasMore: targets.length === limit && stopped !== 'blocked',
    stopped,
  }
}
