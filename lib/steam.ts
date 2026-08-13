import type { LibraryGame } from './types'

export type ProfileInput = { kind: 'steamid64' | 'vanity'; value: string }

export type SteamClientOpts = {
  apiKey: string
  fetchFn?: typeof fetch
  retryDelayMs?: number
}

const API_BASE = 'https://api.steampowered.com'

async function steamApiGet(
  path: string,
  params: Record<string, string>,
  opts: SteamClientOpts,
): Promise<unknown> {
  const fetchFn = opts.fetchFn ?? fetch
  const url = new URL(`${API_BASE}${path}`)
  url.searchParams.set('key', opts.apiKey)
  url.searchParams.set('format', 'json')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetchFn(url.toString(), { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Steam API ${path}: HTTP ${res.status}`)
  return res.json()
}

type OwnedGamesResponse = {
  response?: {
    game_count?: number
    games?: Array<{
      appid: number
      name?: string
      playtime_forever?: number
      playtime_2weeks?: number
      rtime_last_played?: number
    }>
  }
}

export async function fetchOwnedGames(
  steamid: string,
  opts: SteamClientOpts,
): Promise<LibraryGame[] | 'private'> {
  const attempts = 2
  for (let i = 0; i < attempts; i++) {
    const data = (await steamApiGet('/IPlayerService/GetOwnedGames/v1/', {
      steamid,
      include_appinfo: '1',
      include_played_free_games: '1',
    }, opts)) as OwnedGamesResponse
    const games = data.response?.games
    if (games) {
      return games.map((g) => {
        const item: LibraryGame = {
          appid: g.appid,
          name: g.name ?? `App ${g.appid}`,
          playtimeForever: g.playtime_forever ?? 0,
          playtime2Weeks: g.playtime_2weeks ?? 0,
        }
        // Проверка на тип, а не на truthy: rtime_last_played = 0 — это ответ
        // Steam «не запускалась ни разу», и он ценнее отсутствия поля. Раньше
        // ноль отбрасывался и был неотличим от «Steam не отдал дату».
        if (typeof g.rtime_last_played === 'number') item.lastPlayed = g.rtime_last_played
        return item
      })
    }
    // Пустой ответ бывает и у публичных профилей (глюки Steam) — один ретрай
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 1000))
    }
  }
  return 'private'
}

type VanityResponse = { response?: { success?: number; steamid?: string } }

export async function resolveVanity(vanity: string, opts: SteamClientOpts): Promise<string | null> {
  const data = (await steamApiGet('/ISteamUser/ResolveVanityURL/v1/', {
    vanityurl: vanity,
  }, opts)) as VanityResponse
  if (data.response?.success === 1 && data.response.steamid) return data.response.steamid
  return null
}

type PlayerSummaryResponse = {
  response?: {
    players?: Array<{
      steamid: string
      personaname?: string
      avatarfull?: string
      communityvisibilitystate?: number
    }>
  }
}

export type PlayerSummary = {
  steamid: string
  personaName?: string
  avatarUrl?: string
  /** 3 = профиль публичный */
  publicProfile: boolean
}

export async function fetchPlayerSummary(
  steamid: string,
  opts: SteamClientOpts,
): Promise<PlayerSummary | null> {
  const data = (await steamApiGet('/ISteamUser/GetPlayerSummaries/v2/', {
    steamids: steamid,
  }, opts)) as PlayerSummaryResponse
  const p = data.response?.players?.[0]
  if (!p) return null
  const summary: PlayerSummary = {
    steamid: p.steamid,
    publicProfile: p.communityvisibilitystate === 3,
  }
  if (p.personaname) summary.personaName = p.personaname
  if (p.avatarfull) summary.avatarUrl = p.avatarfull
  return summary
}

const STEAMID64_RE = /^\d{17}$/
const VANITY_RE = /^[A-Za-z0-9_-]{2,32}$/

export function parseProfileInput(raw: string): ProfileInput | null {
  const input = raw.trim()
  if (!input) return null

  const urlMatch = input.match(
    /^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/(profiles|id)\/([^/?#]+)/i,
  )
  if (urlMatch) {
    const [, kind, value] = urlMatch
    if (kind.toLowerCase() === 'profiles') {
      return STEAMID64_RE.test(value) ? { kind: 'steamid64', value } : null
    }
    return VANITY_RE.test(value) ? { kind: 'vanity', value } : null
  }

  // Ссылки на чужие домены не принимаем
  if (input.includes('/') || input.includes('.')) return null

  if (STEAMID64_RE.test(input)) return { kind: 'steamid64', value: input }
  if (VANITY_RE.test(input)) return { kind: 'vanity', value: input }
  return null
}
