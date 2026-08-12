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

const MIN_PLAYTIME_MIN = 120
const MAX_REVIEWS = 50

type ReviewsResponse = {
  success?: number
  query_summary?: {
    review_score?: number
    review_score_desc?: string
    total_positive?: number
    total_negative?: number
  }
  reviews?: Array<{
    recommendationid?: string
    review?: string
    voted_up?: boolean
    votes_up?: number
    author?: { playtime_at_review?: number }
  }>
}

export function parseReviews(json: unknown): ParsedReviews | null {
  const data = json as ReviewsResponse
  if (data?.success !== 1) return null
  const s = data.query_summary
  const seen = new Set<string>()
  const reviews: ParsedReviews['reviews'] = []
  for (const r of data.reviews ?? []) {
    const id = r.recommendationid
    const playtime = r.author?.playtime_at_review ?? 0
    if (!id || seen.has(id) || playtime < MIN_PLAYTIME_MIN || !r.review) continue
    seen.add(id)
    reviews.push({
      id,
      text: r.review,
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

export async function fetchReviews(
  appid: number,
  fetchFn: typeof fetch = fetch,
): Promise<ParsedReviews | null> {
  // общий лимитер хоста store.steampowered.com с appdetails
  await pace('steam-store', STORE_PACE_MS)
  const url = `https://store.steampowered.com/appreviews/${appid}?json=1&filter=all&purchase_type=all&language=all&num_per_page=100&cursor=*`
  const res = await fetchFn(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) return null
  try {
    return parseReviews(await res.json())
  } catch {
    return null
  }
}
