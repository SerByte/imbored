export type LibraryGame = {
  appid: number
  name: string
  /** минуты за всё время */
  playtimeForever: number
  /** минуты за последние 2 недели */
  playtime2Weeks: number
  /** unix-секунды последнего запуска; 0/undefined если Steam не отдал */
  lastPlayed?: number
}

export type GameMeta = {
  appid: number
  name: string
  /** пользовательские теги Steam: тег -> голоса */
  tags: Record<string, number>
  genres: string[]
  /** id категорий Steam (1 Multi-player, 2 Single-player, 9 Co-op, 38 Online Co-op...) */
  categories: number[]
  shortDescription?: string
  /** Обложка 460×215; оставлена для совместимости, дублирует art.header */
  headerImage?: string
  /** Резолвленные ссылки на арт всех размеров */
  art?: import('./art').GameArtUrls
  screenshots?: string[]
  isFree?: boolean
  /** цена в минимальных единицах валюты (копейки/центы) */
  priceFinal?: number
  releaseDate?: string
  /** медиана наигранного (минуты), из SteamSpy */
  medianForever?: number
  /** магазин вне Steam (epic/battlenet/riot/...); отсутствие = Steam */
  store?: string
  /** страница игры в её магазине */
  storeUrl?: string
}

export type Mood = {
  time: 'short' | 'medium' | 'long'
  vibe: 'chill' | 'engaged'
  social: 'solo' | 'friends'
}

export type CandidateSource = 'backlog' | 'comeback' | 'new'

export type ScoredCandidate = {
  appid: number
  name: string
  source: CandidateSource
  score: number
}
