import { STORE_API_PACE_MS } from './catalog'
import type { IngestRow } from './db'
import { pace } from './pace'

/**
 * Разбор источников большого каталога.
 *
 * Главный источник — недокументированный JSON поиска магазина
 * (`/search/results/?infinite=1&category1=998`): он отдаёт ~170 тысяч игр
 * страницами по 100, и в каждой строке уже есть appid, название, теги, дата
 * выхода, отзывы и цена. Официальные API такого набора за один проход не дают:
 * IStoreService/GetAppList отдаёт только appid и имя, а appdetails — по одной
 * игре за запрос при лимите ~200 запросов за 5 минут.
 *
 * Разметка приходит HTML-строкой, поэтому разбираем регулярками: полноценный
 * парсер сюда тащить незачем, структура строки простая и стабильная.
 */

/** Игр на странице выдачи: больше Steam не отдаёт, count>100 молча режется */
export const SEARCH_PAGE_SIZE = 100
const FETCH_TIMEOUT_MS = 20_000

export type SearchPage = { rows: IngestRow[]; totalCount: number }

/**
 * Одна страница каталога. При бёрсте Steam отдаёт 429, поэтому вызывающий
 * обязан выдерживать паузу и отступать при ошибке.
 */
export async function fetchSearchPage(
  start: number,
  opts: { fetchFn?: typeof fetch; cc?: string } = {},
): Promise<SearchPage> {
  const { fetchFn = fetch, cc = 'us' } = opts
  const url =
    `https://store.steampowered.com/search/results/?query&start=${start}` +
    `&count=${SEARCH_PAGE_SIZE}&infinite=1&category1=998&cc=${cc}&l=english`
  const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`search ${start}: HTTP ${res.status}`)
  const json = (await res.json()) as { results_html?: string; total_count?: number }
  return {
    rows: parseSearchRows(json.results_html ?? ''),
    totalCount: Number(json.total_count ?? 0),
  }
}

/**
 * Игроков прямо сейчас. Работает без ключа, один appid за запрос.
 *
 * Самый резкий сигнал «можно ли в это играть сегодня»: у Half-Life 2:
 * Deathmatch 86 отзывов за месяц, но 99 игроков на весь мир — по отзывам
 * игра выглядит живой, а сесть играть не с кем.
 */
export async function fetchCurrentPlayers(
  appid: number,
  fetchFn: typeof fetch = fetch,
): Promise<number | undefined> {
  // Единственный вызов Steam, который жил без pace(), — и при этом он ходит в
  // цикле до сорока раз подряд из пользовательского запроса (refreshPlayerCounts
  // в /api/prepare). Ключ тот же, что у остальных вызовов api.steampowered.com:
  // лимит там общий на хост, и отдельная очередь просто обходила бы его.
  await pace('steam-api', STORE_API_PACE_MS)
  const res = await fetchFn(
    `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
  )
  if (!res.ok) throw new Error(`players ${appid}: HTTP ${res.status}`)
  const json = (await res.json()) as { response?: { result?: number; player_count?: number } }
  const count = json.response?.player_count
  return typeof count === 'number' ? count : undefined
}

/**
 * Отзывов за последние 30 дней — главный сигнал «во что играют сейчас».
 * Работает без ключа для любого appid, ответ ~200 байт. Именно он отличает
 * CS2 (76 179) от CS 1.6 (810): по доле положительных старая версия выигрывает,
 * а по объёму проигрывает в 94 раза.
 */
export async function fetchRecentReviews(
  appid: number,
  nowSec: number,
  fetchFn: typeof fetch = fetch,
): Promise<number | undefined> {
  const start = nowSec - 30 * 86_400
  const url =
    `https://store.steampowered.com/appreviews/${appid}?json=1&language=all` +
    `&purchase_type=all&num_per_page=0&filter=recent` +
    `&start_date=${start}&end_date=${nowSec}&date_range_type=include`
  const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`appreviews ${appid}: HTTP ${res.status}`)
  const json = (await res.json()) as {
    success?: number
    query_summary?: { total_reviews?: number }
  }
  if (json.success !== 1) return undefined
  const total = json.query_summary?.total_reviews
  return typeof total === 'number' ? total : undefined
}

/** Год выхода регуляркой — дата приходит в локали магазина и парсингу не поддаётся */
export function parseReleaseYear(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined
  const m = raw.match(/\b(19|20)\d{2}\b/)
  return m ? Number(m[0]) : undefined
}

/** «Very Positive<br>86% of the 2,593,032 user reviews...» -> {percent, total} */
export function parseReviewTooltip(
  tooltip: string | undefined | null,
): { percent: number; total: number } | null {
  if (!tooltip) return null
  const m = tooltip.match(/(\d+)%\s+of\s+the\s+([\d,.\s ]+)\s+user\s+reviews/i)
  if (!m) return null
  const total = Number(m[2].replace(/[^\d]/g, ''))
  if (!Number.isFinite(total) || total <= 0) return null
  return { percent: Number(m[1]), total }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const num = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
      return Number.isFinite(num) ? String.fromCodePoint(num) : whole
    }
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

/** Одна строка выдачи поиска — от одного data-ds-appid до следующего */
function splitRows(html: string): string[] {
  const parts = html.split(/(?=<a[^>]*\sdata-ds-appid=)/i)
  return parts.filter((p) => /\sdata-ds-appid=/i.test(p))
}

export function parseSearchRows(html: string): IngestRow[] {
  const out: IngestRow[] = []
  for (const row of splitRows(html)) {
    const appid = Number(row.match(/data-ds-appid="(\d+)"/)?.[1])
    if (!Number.isFinite(appid) || appid <= 0) continue

    const rawName = row.match(/<span class="title">([\s\S]*?)<\/span>/)?.[1]
    if (!rawName) continue

    let tagids: number[] = []
    const rawTags = row.match(/data-ds-tagids="\[([^\]]*)\]"/)?.[1]
    if (rawTags) {
      tagids = rawTags
        .split(',')
        .map((t) => Number(t.trim()))
        .filter((t) => Number.isFinite(t) && t > 0)
    }

    const item: IngestRow = { appid, name: decodeEntities(rawName).trim(), tagids }

    const released = row.match(/class="search_released[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1]
    const year = parseReleaseYear(released?.replace(/\s+/g, ' ').trim())
    if (year) item.releaseYear = year

    const tooltip = row.match(/class="search_review_summary[^"]*"[^>]*data-tooltip-html="([^"]*)"/)?.[1]
    const reviews = parseReviewTooltip(tooltip ? decodeEntities(tooltip) : null)
    if (reviews) {
      item.reviewsTotal = reviews.total
      item.reviewsPercent = reviews.percent
    }

    const price = Number(row.match(/data-price-final="(\d+)"/)?.[1])
    if (Number.isFinite(price)) item.priceFinal = price

    out.push(item)
  }
  return out
}
