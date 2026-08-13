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
  /** год выхода — для определения серий; парсится из releaseDate в любой локали */
  releaseYear?: number
  developer?: string
  publisher?: string
  /** всего отзывов и доля положительных — сигналы актуальности */
  reviewsTotal?: number
  reviewsPercent?: number
  /** отзывов за последние 30 дней — запасной сигнал актуальности */
  reviews30d?: number
  /** игроков прямо сейчас — главный сигнал «можно ли в это играть сегодня» */
  ccu?: number
  /** когда замерен онлайн (unix-секунды) */
  ccuAt?: number
  /** магазин вне Steam (epic/battlenet/riot/...); отсутствие = Steam */
  store?: string
  /** страница игры в её магазине */
  storeUrl?: string
  /**
   * Вердикт офлайн-курации каталога. Пишется одним UPDATE в promote-catalog,
   * копируется в прод publish-catalog и до сих пор молча терялся при чтении:
   * колонки приезжали из `SELECT *` и выбрасывались в JS — та же история, что
   * была с developer и release_year.
   *
   * Три поля читаются как единое целое и появляются только вместе, потому что
   * вместе и пишутся. Ценность в первую очередь у signalsAt: непустой означает,
   * что appid прошёл через games-only пайплайн (catalog_ingest наполняется из
   * раздела «Игры» магазина), то есть это точно игра, а не саундтрек или SDK.
   * У прогретой в рантайме записи их нет вовсе — судить не по чему.
   */
  signalsAt?: number
  alive?: boolean
  supersededBy?: number
}

export type Mood = {
  time: 'short' | 'medium' | 'long'
  vibe: 'chill' | 'engaged'
  social: 'solo' | 'friends'
}

/**
 * Откуда взялся кандидат. Порядок значим: он же порядок приоритета при
 * наборе разнообразия в heuristicPicks.
 *
 * 'untouched' и 'backlog' — обе про непройденное, но это разные разговоры:
 * первую даже не скачивали, вторую открыли и закрыли. Отдельный источник, а не
 * флаг рядом с 'backlog', именно потому, что различие ведёт свой бейдж, свой
 * шаблон причины и свою строку в промпте — Record<CandidateSource, …> не даст
 * собраться, пока для нового источника не написана вся копия.
 */
export const CANDIDATE_SOURCES = ['untouched', 'backlog', 'comeback', 'new'] as const

export type CandidateSource = (typeof CANDIDATE_SOURCES)[number]

export type ScoredCandidate = {
  appid: number
  name: string
  source: CandidateSource
  score: number
}
