import { getGameMeta, getStaleAppids, upsertGameMeta, type Db } from './db'
import { pace } from './pace'
import type { GameMeta } from './types'

type AppDetailsData = {
  type?: string
  name?: string
  steam_appid?: number
  is_free?: boolean
  short_description?: string
  header_image?: string
  screenshots?: Array<{ path_full?: string }>
  genres?: Array<{ description?: string }>
  categories?: Array<{ id?: number }>
  price_overview?: { final?: number }
  release_date?: { date?: string }
}

export function parseAppDetails(json: unknown, appid: number): GameMeta | null {
  const entry = (json as Record<string, { success?: boolean; data?: AppDetailsData }>)?.[
    String(appid)
  ]
  if (!entry?.success || !entry.data) return null
  const d = entry.data
  if (d.type !== 'game') return null
  const meta: GameMeta = {
    appid,
    name: d.name ?? `App ${appid}`,
    tags: {},
    genres: (d.genres ?? []).map((g) => g.description).filter((x): x is string => Boolean(x)),
    categories: (d.categories ?? []).map((c) => c.id).filter((x): x is number => x !== undefined),
  }
  if (d.short_description) meta.shortDescription = d.short_description
  if (d.header_image) meta.headerImage = d.header_image
  const shots = (d.screenshots ?? [])
    .map((s) => s.path_full)
    .filter((x): x is string => Boolean(x))
    .slice(0, 8)
  if (shots.length) meta.screenshots = shots
  if (d.is_free !== undefined) meta.isFree = d.is_free
  if (d.price_overview?.final !== undefined) meta.priceFinal = d.price_overview.final
  if (d.release_date?.date) meta.releaseDate = d.release_date.date
  return meta
}

export function parseSteamSpyTags(json: unknown): Record<string, number> {
  const tags = (json as { tags?: unknown })?.tags
  if (!tags || Array.isArray(tags) || typeof tags !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [tag, votes] of Object.entries(tags as Record<string, unknown>)) {
    if (typeof votes === 'number') out[tag] = votes
  }
  return out
}

/* ---------- сетевые фетчеры с бережным темпом ---------- */

const STORE_CC = process.env.STEAM_STORE_CC ?? 'us'
const FETCH_TIMEOUT_MS = 10_000
// ~200 запросов/5 мин на store.steampowered.com => >=1.7с между запросами
export const STORE_PACE_MS = 1700
const STEAMSPY_PACE_MS = 1100

export async function fetchAppDetails(
  appid: number,
  fetchFn: typeof fetch = fetch,
): Promise<GameMeta | null> {
  await pace('steam-store', STORE_PACE_MS)
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${STORE_CC}&l=russian`
  const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  // rate limit/сбой — исключение, чтобы вызывающий не закэшировал неудачу как «данных нет»
  if (!res.ok) throw new Error(`appdetails ${appid}: HTTP ${res.status}`)
  try {
    return parseAppDetails(await res.json(), appid)
  } catch {
    return null
  }
}

export async function fetchSteamSpyTags(
  appid: number,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, number>> {
  await pace('steamspy', STEAMSPY_PACE_MS)
  const res = await fetchFn(`https://steamspy.com/api.php?request=appdetails&appid=${appid}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`steamspy ${appid}: HTTP ${res.status}`)
  try {
    return parseSteamSpyTags(await res.json())
  } catch {
    return {}
  }
}

/** Популярные игры за 2 недели по SteamSpy — пул кандидатов «попробуй новое» */
export async function fetchSteamSpyTop(
  fetchFn: typeof fetch = fetch,
): Promise<Array<{ appid: number; name: string }>> {
  await pace('steamspy', STEAMSPY_PACE_MS)
  try {
    const res = await fetchFn('https://steamspy.com/api.php?request=top100in2weeks', {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return []
    const json = (await res.json()) as Record<string, { appid?: number; name?: string }> | null
    if (!json || typeof json !== 'object') return []
    return Object.values(json)
      .filter((g) => g && typeof g.appid === 'number' && typeof g.name === 'string')
      .map((g) => ({ appid: g.appid as number, name: g.name as string }))
  } catch {
    return []
  }
}

const META_MAX_AGE_SEC = 14 * 86_400

/**
 * Догружает метаданные (SteamSpy теги + при необходимости appdetails) для appid'ов,
 * которых нет в кэше или которые протухли. Ограничен по количеству за один вызов,
 * чтобы не подвешивать запрос пользователя.
 */
export async function ensureMeta(
  db: Db,
  appids: number[],
  opts: { maxFetch?: number; withStore?: boolean; names?: Map<number, string>; fetchFn?: typeof fetch } = {},
): Promise<void> {
  const { maxFetch = 30, withStore = false, names, fetchFn = fetch } = opts
  const now = Math.floor(Date.now() / 1000)
  const stale = (await getStaleAppids(db, appids, META_MAX_AGE_SEC, now)).slice(0, maxFetch)
  for (const appid of stale) {
    try {
      const existing = await getGameMeta(db, appid)
      let meta: GameMeta | null = existing ? { ...existing } : null
      if (withStore || !meta) {
        const fresh = withStore ? await fetchAppDetails(appid, fetchFn) : null
        if (fresh) {
          // не терять уже накопленные теги, если store их не отдал
          if (existing && !Object.keys(fresh.tags).length) fresh.tags = existing.tags
          meta = fresh
        } else if (!meta) {
          meta = {
            appid,
            name: names?.get(appid) ?? `App ${appid}`,
            tags: {},
            genres: [],
            categories: [],
          }
        }
      }
      const tags = await fetchSteamSpyTags(appid, fetchFn)
      if (Object.keys(tags).length) meta.tags = tags
      await upsertGameMeta(db, meta, now)
    } catch {
      // сеть/лимиты: пропускаем без записи — updated_at не двигается,
      // игра останется «протухшей» и догрузится в следующий раз
    }
  }
}
