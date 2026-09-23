import { pace } from './pace'
import { STORE_PACE_MS } from './catalog'

export type ParsedReviews = {
  score: number
  scoreDesc: string
  totalPositive: number
  totalNegative: number
  reviews: Array<{
    id: string
    text: string
    votedUp: boolean
    votesUp: number
    playtimeAtReview: number
  }>
}

/**
 * Что лежит в games.pros_cons_json. source — не украшение, а маркер очереди:
 *   'claude'  — собрано моделью; ничего другого страница игры не показывает
 *               (lib/gamepage.ts);
 *   'reviews' — эвристика без модели: карточка вернётся на пересборку, когда
 *               модель появится (claimPageEnrichBatch, redoHeuristic);
 *   'thin'    — полезных отзывов слишком мало, модель не зовём и пересобирать
 *               нечем: карточка ждёт общего срока устаревания
 *               (PROS_CONS_MIN_REVIEWS в lib/pagejob.ts).
 */
export type ProsCons = { pros: string[]; cons: string[]; source: 'claude' | 'reviews' | 'thin' }

const MIN_PLAYTIME_MIN = 120
const MAX_REVIEWS = 50

/**
 * Ответ appreviews в том виде, в каком его отдаёт Steam. Один на два разбора:
 * parseReviews берёт из него отзывы для pros/cons, parseReviewsRaw в
 * lib/reviewmine — все подряд, для полос и статистики наигранного.
 */
export type ReviewsResponse = {
  success?: number
  query_summary?: {
    review_score?: number
    review_score_desc?: string
    total_positive?: number
    total_negative?: number
  }
  reviews?: Array<{
    recommendationid?: string
    /** язык, который выбрал автор: 'english', 'russian', 'schinese'… */
    language?: string
    review?: string
    voted_up?: boolean
    votes_up?: number
    author?: { playtime_at_review?: number; playtime_forever?: number }
  }>
}

export function parseReviews(json: unknown): ParsedReviews | null {
  const data = json as ReviewsResponse
  if (data?.success !== 1) return null
  const s = data.query_summary
  const seen = new Set<string>()
  const reviews: ParsedReviews['reviews'] = []
  // Ответ приходит сюда сырым (fetchReviewsRaw), и не-массив на месте
  // reviews — это одна странная игра, а не повод ронять срез крона
  for (const r of Array.isArray(data.reviews) ? data.reviews : []) {
    const id = r?.recommendationid
    const playtime = r?.author?.playtime_at_review ?? 0
    const text = typeof r?.review === 'string' ? r.review : ''
    if (!id || seen.has(id) || playtime < MIN_PLAYTIME_MIN || !text) continue
    seen.add(id)
    reviews.push({
      id,
      text,
      votedUp: r.voted_up ?? false,
      votesUp: r.votes_up ?? 0,
      playtimeAtReview: playtime,
    })
    if (reviews.length >= MAX_REVIEWS) break
  }
  return {
    score: s?.review_score ?? 0,
    scoreDesc: s?.review_score_desc ?? '',
    totalPositive: s?.total_positive ?? 0,
    totalNegative: s?.total_negative ?? 0,
    reviews,
  }
}

/**
 * Фолбэк pros/cons без LLM: первые предложения самых полезных
 * позитивных и негативных отзывов.
 */
export function heuristicProsCons(
  reviews: ParsedReviews['reviews'],
  count: number,
): { pros: string[]; cons: string[] } {
  const firstSentence = (text: string): string => {
    const cleaned = text.replace(/\s+/g, ' ').trim()
    const m = cleaned.match(/^[^.!?\n]{3,160}[!?]?/)
    return (m ? m[0] : cleaned.slice(0, 160)).trim()
  }
  const top = (votedUp: boolean) =>
    reviews
      .filter((r) => r.votedUp === votedUp && r.votesUp >= 3)
      .sort((a, b) => b.votesUp - a.votesUp)
      .slice(0, count)
      .map((r) => firstSentence(r.text))
      .filter((s) => s.length >= 12)
  return { pros: top(true), cons: top(false) }
}

/**
 * Адрес appreviews — один на крон и на фикстуры (scripts/review-fixtures.ts):
 * тесты разбора отзывов должны видеть ровно тот ответ, который видит крон, —
 * те же языки, тот же порядок, та же сотня.
 */
export function reviewsUrl(appid: number): string {
  return `https://store.steampowered.com/appreviews/${appid}?json=1&filter=all&purchase_type=all&language=all&num_per_page=100&cursor=*`
}

/**
 * Сырой ответ appreviews — один запрос на два разбора: parseReviews (вердикт
 * и pros/cons) и parseReviewsRaw из lib/reviewmine (семантика игры). Разбор
 * у вызывающего, а не здесь: крону страниц нужны оба, и второй запрос за тем
 * же ответом стоил бы ещё одного шага пейсера и ещё одного шанса на 429.
 *
 * Отказ хоста — ИСКЛЮЧЕНИЕ, а не null, и это ровно то же правило, которое
 * сформулировано у соседнего fetchAppDetails: «лимит/сбой — исключение, чтобы
 * вызывающий не закэшировал неудачу как „данных нет"».
 *
 * Здесь оно было записано у соседа и нарушено тут, и цена оказалась высокой.
 * lib/pagejob взводит счётчик подряд идущих отказов только в .catch(), то есть
 * при 429 на appreviews страж «Steam закрылся от нашего IP» не срабатывал
 * НИКОГДА: срез доходил до конца, помечал карточки тронутыми и уводил их из
 * очереди на полгода — без вердикта отзывов и без pros/cons.
 *
 * null остаётся ответом на «Steam ответил, но разобрать нечего»: битое тело —
 * это про одну игру, а не про наш адрес, и весь срез из-за неё останавливать
 * не за что. Ответ с success != 1 возвращается как есть: оба разбора
 * превращают его в null сами.
 */
export async function fetchReviewsRaw(
  appid: number,
  fetchFn: typeof fetch = fetch,
): Promise<unknown> {
  // общий лимитер хоста store.steampowered.com с appdetails
  await pace('steam-store', STORE_PACE_MS)
  const res = await fetchFn(reviewsUrl(appid), { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`appreviews ${appid}: HTTP ${res.status}`)
  try {
    return await res.json()
  } catch {
    return null
  }
}
