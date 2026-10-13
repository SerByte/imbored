/**
 * Свежесть каталога: отзывы и онлайн игр пула, узкими UPDATE из крона.
 *
 * Каталог собирается руками (seed → promote → publish), и с 15 августа его
 * никто не пересобирал: у 4615 из 5000 страниц игр lastmod ровно тот день.
 * Застывшее тут не безобидно. reviews_total и reviews_percent стоят в порядке
 * пула и в порогах живости, отзывы на всех языках — в кольце и meta
 * description /game/*, на хабах и в /play; ccu — главный сигнал живости
 * совместной игры, и по нему рантайм (filterActual → judgeLiveness) решает,
 * звать ли её «с друзьями». Опустевшие в сентябре серверы по-прежнему
 * проходили бы фильтр пати по августовскому замеру.
 *
 * Полная пересборка — это обход 170 тысяч игр, секреты Turso в GitHub и
 * data/catalog.db артефактом; решение за владельцем. Здесь лёгкая половина,
 * которой хватает без всего этого: обновить замеры у того, что уже в пуле.
 *
 *   • Отзывы — GetItems с include_reviews, двести игр одним запросом. В
 *     ответе две шкалы: англоязычная — для порогов и порядка пула — и все
 *     языки, которые видят люди (shownReviews в lib/gametraits). Русские —
 *     вторым запросом той же пачки, в русском контексте.
 *   • Пульс — отзывы за последний месяц, по игре за запрос и только у верха
 *     пула (refreshReviewPulse ниже): ходит в магазин, а не в API, и потому
 *     скупо.
 *   • Онлайн — по игре за запрос (другого API нет), и только у совместных:
 *     живость гейтит только их, ровно как в promote-catalog.
 *   • Цены — тот же GetItems, но в регионе цен (lib/deals), той же пачкой, и
 *     только тем, у кого цены своего региона нет вовсе: ни разу не мерили,
 *     мерили в чужом или магазин региона игру не показывал (store_hidden).
 *     Здесь, а не отдельной очередью: это единственный крон, который обходит
 *     весь пул, и его шаг — неделя. Без него цену каталога двигали только
 *     заходы людей, и после смены STEAM_STORE_CC у переоценки не было бы
 *     срока; с ним весь пул переоценён не позже чем за SIGNALS_MAX_AGE_SEC.
 *     «Не продаётся» — единственное, что без сверки не переснял бы никто:
 *     такую игру подбор покупкой не предлагает (lib/candidates), и заходы
 *     людей до неё не доходят. Разовый visible:false (предзаказ, временный
 *     запрет, осечка магазина) держался бы вечно; так — не дольше недели.
 *     Скидки у скрытой строки нет, и бюджету ISR её перезамер не стоит ничего.
 *     Свою цену, пусть и давнюю, сверка не переснимает — это не забыто. Сама
 *     она карточек не сбрасывает, но замер со скидкой доверенный, и конец этой
 *     скидки отдаст карточку в revalidateEndedDeals (lib/gamecache): запись
 *     ISR, хотя собранная страница скидки обычно и не видела. Еженедельный
 *     замер всего пула платил бы так на каждой распродаже, а бюджет ISR и без
 *     того выбран. Свежесть своей цены держат заходы людей (refreshDeals); при
 *     постоянном регионе сверка спрашивает цены только у новичков без замера,
 *     у скрытых и у погасших распродаж.
 *     Погасшая распродажа — единственное исключение из «свою не трогаем».
 *     Акционную пару, которой уже не верят (срок вышел или замер без срока
 *     старше PRICE_TRUST_SEC), trustedPrice прячет целиком, и герой карточки
 *     стоял без цены, пока до игры не дойдёт заход человека: на проде так
 *     неделями молчали Hades, ICARUS и Among Us. Перезамер такой строки цену
 *     только возвращает, а стоит ISR не больше обычного: кончилась скидка —
 *     ложится обычная цена, и карточка покажет её на своей недельной
 *     перегенерации; идёт новая — её конец, как у любой скидки, — одна запись
 *     в revalidateEndedDeals.
 *
 * Очередь — колонка reviews_at: сперва ни разу не сверенные, потом самые
 * давние (catalogSignalsQueue). Ни alive, ни signals_at здесь не пишутся:
 * вердикт курации — дело промоута, а signals_at значит «запись прошла
 * games-only пайплайн» (lib/junk). Свежие числа и так доезжают до решений:
 * рантайм судит живость по ним сам.
 *
 * Логика здесь, а не в роуте крона, по той же причине, что у runPageSlice:
 * vitest собирает только lib/.
 */

import { callStoreItems, STORE_ITEMS_BATCH, STORE_PACE_MS } from './catalog'
import { sliceClock } from './cron'
import {
  catalogSignalsQueue,
  reviewPulseQueue,
  stalePriceAppids,
  updateCatalogSignals,
  updateGamePrices,
  updateReviewPulse,
  type Db,
  type PriceQuote,
} from './db'
import { fetchStorePrices } from './deals'
import { logSwallowed } from './errlog'
import {
  CCU_TIMEOUT_MS,
  fetchCurrentPlayers,
  fetchRecentPulse,
  pollPlayerCounts,
  type RecentPulse,
} from './ingest'
import { pace } from './pace'
import { priceRegion } from './steamregion'

/**
 * Раз в сколько сверять игру. Неделя: пул — около шести тысяч игр, и при
 * пачке в двести это тридцать запросов отзывов и пара тысяч замеров онлайна в
 * неделю — капля на фоне лимитов Steam, а для фильтра живости и процента в
 * сниппете недельная точность с запасом.
 */
export const SIGNALS_MAX_AGE_SEC = 7 * 86_400

/**
 * Онлайн моложе этого не перемеряем: его только что снял догрев в
 * /api/prepare. Тот же срок, что там (CCU_MAX_AGE_SEC) и в PlayersNow, — после
 * него число уже не «сейчас».
 */
export const CCU_FRESH_SEC = 6 * 3600

/** Пачка — ровно один запрос GetItems. */
export const SIGNALS_BATCH = STORE_ITEMS_BATCH

/**
 * Потолок пачек на звено. Упирается обычно не в него, а в бюджет: онлайн
 * меряется по игре через пейсер 'steam-api', и сотня совместных игр — это
 * сорок секунд. Потолок держит звено в рамках, когда онлайн свежий у всех
 * (его перемерил прогрев) и пачки идут почти даром.
 */
export const SIGNALS_MAX_BATCHES = 5

/**
 * Потолок ожидания одного GetItems на игру пачки. Ответ с одними отзывами
 * лёгкий — как у цен, не как у полного прогрева с ассетами и тегами.
 */
const REVIEWS_MS_PER_APP = 50

/** Сколько отзывов и доля положительных, 0…100 */
export type ReviewScale = { total: number; percent: number }

/** Все языки — с оценкой Steam словами той же сводки (EUserReviewScore 1…9) */
export type AllReviews = ReviewScale & { score: number | null }

/**
 * Отзывы игры по одной сверке. Сама пара — англоязычная шкала порогов и
 * порядка пула (почему — у parseStoreReviews); рядом — то, что видят люди.
 */
export type StoreReviews = ReviewScale & {
  /** Все языки (summary_filtered) — кольцо /game, хабы и /play (shownReviews) */
  all?: AllReviews
  /** На русском — второй GetItems той же пачки в русском контексте */
  ru?: ReviewScale
}

type ReviewSummary = {
  review_count?: unknown
  percent_positive?: unknown
  review_score?: unknown
}
type ReviewsItem = {
  appid?: number
  id?: number
  reviews?: { summary_filtered?: ReviewSummary; summary_language_specific?: ReviewSummary }
}
type ReviewsResponse = { response?: { store_items?: ReviewsItem[] } }

/**
 * Пара из сводки, или null. Ноль отзывов значением не считается: у игры пула
 * их по построению десятки и больше (иначе её отсеял бы промоут), и ноль —
 * это сбой ответа, а не новость. Записанный, он выкинул бы игру из выдачи как
 * мусорный хвост.
 */
function scaleOf(s: ReviewSummary | undefined): ReviewScale | null {
  const total = s?.review_count
  const percent = s?.percent_positive
  const ok =
    typeof total === 'number' &&
    Number.isInteger(total) &&
    total > 0 &&
    typeof percent === 'number' &&
    percent >= 0 &&
    percent <= 100
  return ok ? { total, percent: Math.round(percent) } : null
}

/** Игры ответа по appid — пропуская строки без него */
function itemsOf(json: unknown): Map<number, ReviewsItem> {
  const items = (json as ReviewsResponse)?.response?.store_items
  const out = new Map<number, ReviewsItem>()
  if (!Array.isArray(items)) return out
  for (const it of items) {
    const appid = it.appid ?? it.id
    if (typeof appid === 'number' && appid > 0) out.set(appid, it)
  }
  return out
}

/**
 * Разбор ответа GetItems с include_reviews: appid → отзывы, или null, если
 * игра в ответе есть, а отзывов на нужном языке нет. Игр, про которые Steam
 * промолчал, в карте нет вовсе.
 *
 * Пара берётся из summary_language_specific, а не summary_filtered, и это про
 * непрерывность шкалы. Посев каталога читал отзывы из поиска магазина с
 * l=english, то есть англоязычные: у CS2 в каталоге 2 593 099, а всех —
 * 9 878 407. Контекст запроса английский (STORE_LANGUAGE), и language_specific
 * — та же англоязычная шкала. Перейди мы на все языки разом, пороги живости
 * (MIN_REVIEWS_TAIL, PANNED_MIN_SAMPLE) и порядок пула поехали бы скачком у
 * сверенной половины каталога против несверенной.
 *
 * Но людям эта шкала не годится: «96% из 165 тыс.» у Isaac на хабе против
 * «459 857» на его карточке. Поэтому summary_filtered — все языки — едет
 * рядом, полем all, из того же ответа и без лишнего запроса: показывают
 * людям его (shownReviews в lib/gametraits). С ним — оценка Steam словами из
 * той же сводки, чтобы слово и доля не разошлись.
 */
export function parseStoreReviews(json: unknown): Map<number, StoreReviews | null> {
  const out = new Map<number, StoreReviews | null>()
  for (const [appid, it] of itemsOf(json)) {
    const lang = scaleOf(it.reviews?.summary_language_specific)
    if (!lang) {
      out.set(appid, null)
      continue
    }
    const filtered = it.reviews?.summary_filtered
    const all = scaleOf(filtered)
    const score = filtered?.review_score
    out.set(
      appid,
      all
        ? {
            ...lang,
            all: {
              ...all,
              score: typeof score === 'number' && Number.isInteger(score) && score >= 1 && score <= 9 ? score : null,
            },
          }
        : lang,
    )
  }
  return out
}

/**
 * Отзывы на языке контекста запроса — для второго, русского GetItems. Только
 * те, у кого они есть: «на русском нет» и «Steam промолчал» здесь одно и то
 * же — записывать нечего.
 */
export function parseLangReviews(json: unknown): Map<number, ReviewScale> {
  const out = new Map<number, ReviewScale>()
  for (const [appid, it] of itemsOf(json)) {
    const lang = scaleOf(it.reviews?.summary_language_specific)
    if (lang) out.set(appid, lang)
  }
  return out
}

/**
 * Отзывы пачки игр: англоязычные и все языки — одним запросом, русские —
 * вторым. Сбой первого — исключение: вызывающий не пишет ничего. Сбой
 * второго — строка в журнал и пачка без русских: это подпись на карточке, а
 * не повод терять сверку двухсот игр. Запрос — в api.steampowered.com
 * (pace 'steam-api', 0.4 с), то есть одна лишняя пачка из двухсот, а не
 * двести походов в магазин по одной игре.
 */
export async function fetchStoreReviews(
  appids: number[],
  fetchFn: typeof fetch = fetch,
): Promise<Map<number, StoreReviews | null>> {
  if (!appids.length) return new Map()
  const json = await callStoreItems(appids, { include_reviews: true }, fetchFn, REVIEWS_MS_PER_APP)
  const out = parseStoreReviews(json)
  const known = appids.filter((id) => out.get(id))
  if (!known.length) return out
  try {
    const ru = parseLangReviews(
      await callStoreItems(known, { include_reviews: true }, fetchFn, REVIEWS_MS_PER_APP, 'russian'),
    )
    for (const [appid, r] of ru) {
      const base = out.get(appid)
      if (base) out.set(appid, { ...base, ru: r })
    }
  } catch (err) {
    logSwallowed('catalog-signals:reviews-ru', err, { batch: known.length })
  }
  return out
}

export type SignalsResult = {
  /** Игр, получивших отметку сверки reviews_at */
  checked: number
  /** Из них с приехавшими отзывами */
  reviews: number
  /** Замеров онлайна */
  ccu: number
  /** Котировок цены, записанных в регионе цен (с ценой, без неё и скрытых) */
  prices: number
  /** Из них — «не продаётся в этом регионе» (visible:false) */
  hidden: number
  /**
   * done — устаревших больше нет; budget — кончилось время звена, а работа
   * осталась; blocked — Steam отказал, дальше в этом звене не ходим.
   */
  stopped: 'done' | 'budget' | 'blocked'
}

/**
 * Одно звено сверки: пачками по SIGNALS_BATCH, пока есть устаревшие, время и
 * согласие Steam.
 *
 * Отказ отзывов — пачка не пишется вовсе, отметок нет, и следующее звено
 * возьмёт её же первой. Отказ онлайна (серия из CCU_FAIL_STREAK) или срок —
 * пачка пишется тем, что успело приехать: отзывы и отметки у всех, онлайн у
 * замеренных. Недомеренные дождутся следующего круга. Отказ цен — строка в
 * журнал, и пачка пишется без них.
 */
export async function refreshCatalogSignals(
  db: Db,
  opts: {
    deadlineAt: number
    nowSec?: number
    batchSize?: number
    maxBatches?: number
    /** подменяются в тестах: иначе прогон уходит и в сеть, и в лимитер темпа */
    fetchReviews?: (appids: number[]) => Promise<Map<number, StoreReviews | null>>
    fetchPlayers?: (appid: number) => Promise<number | undefined>
    fetchPrices?: (appids: number[], cc: string) => Promise<PriceQuote[]>
  },
): Promise<SignalsResult> {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000)
  const batchSize = opts.batchSize ?? SIGNALS_BATCH
  const maxBatches = opts.maxBatches ?? SIGNALS_MAX_BATCHES
  const reviewsOf = opts.fetchReviews ?? ((ids: number[]) => fetchStoreReviews(ids))
  const playersOf =
    opts.fetchPlayers ?? ((appid: number) => fetchCurrentPlayers(appid, fetch, CCU_TIMEOUT_MS))
  const pricesOf =
    opts.fetchPrices ?? ((ids: number[], cc: string) => fetchStorePrices(ids, { cc }))
  // Один регион на звено: запрос и запись цен — про одни и те же деньги
  const cc = priceRegion()

  const result: SignalsResult = { checked: 0, reviews: 0, ccu: 0, prices: 0, hidden: 0, stopped: 'budget' }
  const часы = sliceClock(opts.deadlineAt)

  for (let b = 0; b < maxBatches; b++) {
    if (!часы.next()) {
      result.stopped = 'budget'
      return result
    }

    // Устаревшие — префикс очереди: она отсортирована по reviews_at, NULL первыми
    const head = await catalogSignalsQueue(db, batchSize)
    const due = head.filter((r) => r.reviewsAt === null || r.reviewsAt < now - SIGNALS_MAX_AGE_SEC)
    if (!due.length) {
      result.stopped = 'done'
      return result
    }

    let reviews: Map<number, StoreReviews | null>
    try {
      reviews = await reviewsOf(due.map((r) => r.appid))
    } catch (err) {
      logSwallowed('catalog-signals:reviews', err, { batch: due.length })
      result.stopped = 'blocked'
      return result
    }

    // Цены — сразу за отзывами и до онлайна: один запрос на пачку, а опрос
    // онлайна сам встаёт по сроку звена, и так звено не вылезает за срок
    // из-за цен. Их отказ пачку не останавливает: отзывы с отметками пишутся
    // всё равно, а цены этих игр переснимет первый же заход человека
    // (refreshDeals) или следующий круг.
    // Спрашиваем только игры без показанной цены своего региона: срок без
    // предела, и stalePriceAppids оставляет ровно «ни разу не мерили», «чужой
    // регион», «не продаётся» и погасшую распродажу (почему не всех — в
    // шапке). Нет таких — нет и запроса
    let quotes: PriceQuote[] = []
    try {
      const unpriced = await stalePriceAppids(
        db,
        due.map((r) => r.appid),
        Number.MAX_SAFE_INTEGER,
        now,
        due.length,
        cc,
        { hidden: true, deadDeals: true },
      )
      if (unpriced.length) quotes = await pricesOf(unpriced, cc)
    } catch (err) {
      logSwallowed('catalog-signals:prices', err, { batch: due.length })
    }

    const ccuDue = due
      .filter((r) => r.isMultiplayer && (r.ccuAt === null || r.ccuAt < now - CCU_FRESH_SEC))
      .map((r) => r.appid)
    const polled = ccuDue.length
      ? await pollPlayerCounts(ccuDue, { fetchOne: playersOf, deadlineAt: opts.deadlineAt })
      : { counts: [], stopped: false }

    await updateCatalogSignals(
      db,
      { checked: due.map((r) => r.appid), reviews, ccu: polled.counts },
      now,
    )
    if (quotes.length) await updateGamePrices(db, quotes, now, cc)
    result.checked += due.length
    result.reviews += due.filter((r) => reviews.get(r.appid)).length
    result.ccu += polled.counts.length
    result.prices += quotes.length
    result.hidden += quotes.filter((q) => q.hidden).length

    if (polled.stopped) {
      // Опрос онлайна встаёт по сроку или по серии отказов; различить их
      // можно только по часам
      result.stopped = Date.now() >= opts.deadlineAt ? 'budget' : 'blocked'
      return result
    }
    if (due.length < head.length || head.length < batchSize) {
      result.stopped = 'done'
      return result
    }
  }
  // Потолок пачек выбран, а устаревшие, может быть, остались
  result.stopped = 'budget'
  return result
}

/**
 * Пульс отзывов: за последний месяц, все языки — строка под кольцом /game
 * («за 30 дней до 3 октября: 71% — ниже, чем за всё время»). «Раньше
 * ругали — сейчас хвалят» и обратное — факт для решения, которого не видно
 * ни по одной сводке за всё время.
 *
 * Запрос — по игре (appreviews, num_per_page=0, ответ в пару сотен байт), в
 * store.steampowered.com через тот же pace('steam-store'), что у крона
 * карточек, и шаг пульса — это полкарточки, не обогащённой в этом звене.
 * Поэтому пульс скупой: не больше PULSE_PER_LINK игр на звено и только верх
 * пула (PULSE_TOP, reviewPulseQueue) — у хвоста полусотни отзывов в месяц
 * нет, и строке там нечего сказать. При девяти звеньях в сутки это около
 * четырёхсот замеров в неделю, ровно верх по кругу; без модели звеньев
 * больше, и круг короче.
 */
export const PULSE_TOP = 400

/** Потолок замеров пульса на звено — см. PULSE_TOP */
export const PULSE_PER_LINK = 6

/** Пульс моложе этого не перемеряем: шаг тот же, что у сверки, — неделя */
export const PULSE_MAX_AGE_SEC = SIGNALS_MAX_AGE_SEC

/** Отказов подряд, после которых звено пульса встаёт: магазин закрылся от нас */
const PULSE_FAIL_STREAK = 2

export type PulseResult = {
  /** Игр с отметкой пульса — и с числами, и тех, про кого Steam промолчал */
  measured: number
  /** done — очередь пуста; budget — потолок звена или срок; blocked — отказы */
  stopped: 'done' | 'budget' | 'blocked'
}

/**
 * Одно звено пульса. Пишется всё, что успело приехать, одной пачкой в конце —
 * и при сроке, и при отказах: недомеренные дождутся следующего звена.
 */
export async function refreshReviewPulse(
  db: Db,
  opts: {
    deadlineAt: number
    nowSec?: number
    limit?: number
    /** подменяется в тестах: иначе прогон уходит и в сеть, и в лимитер темпа */
    fetchPulse?: (appid: number, nowSec: number) => Promise<RecentPulse | undefined>
  },
): Promise<PulseResult> {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000)
  const limit = opts.limit ?? PULSE_PER_LINK
  const pulseOf =
    opts.fetchPulse ??
    (async (appid: number, at: number) => {
      // Общий ключ с appdetails, appreviews и лентой новостей — и тот же шаг
      await pace('steam-store', STORE_PACE_MS)
      return fetchRecentPulse(appid, at)
    })

  const due = await reviewPulseQueue(db, { top: PULSE_TOP, before: now - PULSE_MAX_AGE_SEC, limit })
  const rows: Array<{ appid: number; pulse: RecentPulse | undefined }> = []
  let stopped: PulseResult['stopped'] = due.length < limit ? 'done' : 'budget'
  let streak = 0
  const часы = sliceClock(opts.deadlineAt)
  for (const appid of due) {
    if (!часы.next()) {
      stopped = 'budget'
      break
    }
    try {
      rows.push({ appid, pulse: await pulseOf(appid, now) })
      streak = 0
    } catch (err) {
      logSwallowed('catalog-signals:pulse', err, { appid })
      if (++streak >= PULSE_FAIL_STREAK) {
        stopped = 'blocked'
        break
      }
    }
  }
  await updateReviewPulse(db, rows, now)
  return { measured: rows.length, stopped }
}
