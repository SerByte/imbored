import type {
  CandidateSource,
  GameMeta,
  LibraryGame,
  Mood,
  ScoredCandidate,
} from './types'

/** id категорий Steam, означающих «можно с друзьями» */
const MULTIPLAYER_CATEGORIES = new Set([1, 9, 24, 36, 38, 39, 49])

const UNPLAYED_MAX_MIN = 120
const COMEBACK_AFTER_SEC = 180 * 86_400

const VIBE_TAGS: Record<Mood['vibe'], string[]> = {
  chill: ['Casual', 'Relaxing', 'Cozy', 'Wholesome', 'Puzzle', 'Atmospheric', 'Farming Sim'],
  engaged: ['Difficult', 'Competitive', 'Souls-like', 'Tactical', 'Strategy', 'Fast-Paced'],
}

const TIME_TAGS: Record<Mood['time'], string[]> = {
  short: ['Roguelike', 'Roguelite', 'Arcade', 'Card Game', 'Fast-Paced', 'Short'],
  medium: [],
  long: ['Open World', 'RPG', 'Story Rich', 'Adventure', 'Simulation'],
}

export function cosine(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (const v of Object.values(a)) normA += v * v
  for (const v of Object.values(b)) normB += v * v
  if (normA === 0 || normB === 0) return 0
  for (const [k, v] of Object.entries(a)) {
    const bv = b[k]
    if (bv !== undefined) dot += v * bv
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** Тег-вектор игры, нормированный к максимуму голосов (0..1) */
export function normalizedTags(meta: GameMeta): Record<string, number> {
  const max = Math.max(...Object.values(meta.tags), 1)
  const out: Record<string, number> = {}
  for (const [tag, votes] of Object.entries(meta.tags)) out[tag] = votes / max
  return out
}

export function buildTagProfile(
  library: LibraryGame[],
  metaOf: (appid: number) => GameMeta | undefined,
): Record<string, number> {
  const profile: Record<string, number> = {}
  for (const g of library) {
    const meta = metaOf(g.appid)
    if (!meta) continue
    let weight = Math.log1p(g.playtimeForever / 60)
    if (weight === 0) continue
    if (g.playtime2Weeks > 0) weight *= 1.5
    for (const [tag, v] of Object.entries(normalizedTags(meta))) {
      profile[tag] = (profile[tag] ?? 0) + weight * v
    }
  }
  return profile
}

const LIKE_BOOST = 1.0
const OPEN_BOOST = 0.3
const GENRE_PENALTY = 0.8
const HARD_PENALTY = 1.0
const HARDCORE_TAGS = ['Difficult', 'Souls-like', 'Competitive', 'Tactical', 'Hardcore']

/**
 * Корректирует тег-профиль по истории фидбека: «зашло» усиливает вкус,
 * скипы с причиной «не тот жанр»/«надоела» ослабляют, «слишком сложная»
 * бьёт только по хардкорным тегам. «Не сейчас» и скип без причины — это
 * состояние, а не вкус: профиль не трогают.
 */
export function applyFeedbackToProfile(
  profile: Record<string, number>,
  feedback: import('./db').FeedbackRow[],
  metaOf: (appid: number) => GameMeta | undefined,
): Record<string, number> {
  const out = { ...profile }
  for (const f of feedback) {
    const meta = metaOf(f.appid)
    if (!meta) continue
    const norm = normalizedTags(meta)

    if (f.action === 'liked' || f.action === 'opened') {
      const boost = f.action === 'liked' ? LIKE_BOOST : OPEN_BOOST
      for (const [tag, v] of Object.entries(norm)) out[tag] = (out[tag] ?? 0) + boost * v
    } else if (f.action === 'skipped' && (f.reason === 'genre' || f.reason === 'tired')) {
      for (const [tag, v] of Object.entries(norm)) {
        out[tag] = Math.max((out[tag] ?? 0) - GENRE_PENALTY * v, 0)
      }
    } else if (f.action === 'skipped' && f.reason === 'hard') {
      for (const tag of HARDCORE_TAGS) {
        if (tag in norm) out[tag] = Math.max((out[tag] ?? 0) - HARD_PENALTY * norm[tag], 0)
      }
    }
  }
  return out
}

/**
 * Разделяет выдачу на «своё» и «нет в библиотеке». Пользователь просил не
 * смешивать: основной ответ на «во что поиграть» — это игры, за которые уже
 * заплачено, а покупки идут отдельной секцией и по своей воле.
 */
export function splitBySource<T extends { source: CandidateSource }>(
  candidates: T[],
): { own: T[]; discovery: T[] } {
  const own: T[] = []
  const discovery: T[] = []
  for (const c of candidates) (c.source === 'new' ? discovery : own).push(c)
  return { own, discovery }
}

export type MatchExplanation = {
  matchPercent: number | null
  sharedTags: string[]
  moodTags: string[]
}

/** Прозрачность выдачи: из чего сложился скоринг этой игры */
export function explainMatch(
  profile: Record<string, number>,
  meta: GameMeta,
  mood: Mood,
): MatchExplanation {
  const profileEmpty = Object.keys(profile).length === 0
  const norm = normalizedTags(meta)
  const matchPercent = profileEmpty ? null : Math.round(cosine(profile, norm) * 100)

  const sharedTags = Object.entries(norm)
    .filter(([tag]) => (profile[tag] ?? 0) > 0)
    .sort((a, b) => (profile[b[0]] ?? 0) * b[1] - (profile[a[0]] ?? 0) * a[1])
    .slice(0, 3)
    .map(([tag]) => tag)

  const moodWanted = new Set([...VIBE_TAGS[mood.vibe], ...TIME_TAGS[mood.time]])
  const moodTags = Object.keys(meta.tags)
    .filter((t) => moodWanted.has(t))
    .slice(0, 3)

  return { matchPercent, sharedTags, moodTags }
}

export type LibraryGameState = 'unplayed' | 'comeback' | 'active' | 'played'

/**
 * «Так и не запущена»: меньше двух часов и без активности за две недели.
 * Единое определение для /library и портрета — раньше они расходились и
 * показывали разные числа для одного и того же игрока.
 */
export function isUnplayed(g: LibraryGame): boolean {
  return g.playtimeForever < UNPLAYED_MAX_MIN && g.playtime2Weeks === 0
}

export function classifyLibraryGame(g: LibraryGame, nowSec: number): LibraryGameState {
  if (g.playtime2Weeks > 0) return 'active'
  if (g.playtimeForever < UNPLAYED_MAX_MIN) return 'unplayed'
  // Steam отдаёт rtime_last_played только владельцу ключа; без даты считаем
  // наигранную, но не тронутую 2 недели игру кандидатом на возвращение
  if (!g.lastPlayed) return 'comeback'
  if (nowSec - g.lastPlayed > COMEBACK_AFTER_SEC) return 'comeback'
  return 'played'
}

function moodMultiplier(meta: GameMeta, mood: Mood): number {
  const tags = new Set(Object.keys(meta.tags))
  const hasAny = (list: string[]) => list.some((t) => tags.has(t))
  let mult = 1
  if (hasAny(VIBE_TAGS[mood.vibe])) mult += 0.25
  const oppositeVibe = mood.vibe === 'chill' ? 'engaged' : 'chill'
  if (hasAny(VIBE_TAGS[oppositeVibe])) mult -= 0.25
  if (hasAny(TIME_TAGS[mood.time])) mult += 0.15
  return Math.max(mult, 0.1)
}

/** Фолбэк для реального режима: appdetails с categories может быть не загружен */
const MULTIPLAYER_TAGS = [
  'Multiplayer',
  'Multi-player',
  'Co-op',
  'Online Co-Op',
  'Local Co-Op',
  'Co-op Campaign',
  'PvP',
  'Online PvP',
  'Massively Multiplayer',
  'MOBA',
]

/** Годится ли игра для совместной игры (категории Steam или теги как фолбэк) */
export function isMultiplayerMeta(meta: GameMeta): boolean {
  if (meta.categories.length) return meta.categories.some((c) => MULTIPLAYER_CATEGORIES.has(c))
  return MULTIPLAYER_TAGS.some((t) => t in meta.tags)
}

function fitsSocial(meta: GameMeta, mood: Mood): boolean {
  if (mood.social !== 'friends') return true
  return isMultiplayerMeta(meta)
}

/** Запасной скоринг при пустом тег-профиле: популярность по голосам тегов */
function popularityScore(meta: GameMeta): number {
  const total = Object.values(meta.tags).reduce((s, v) => s + v, 0)
  return Math.min(total / 20_000, 1)
}

export function scoreCandidates(args: {
  profile: Record<string, number>
  library: LibraryGame[]
  metaOf: (appid: number) => GameMeta | undefined
  newPool: GameMeta[]
  mood: Mood
  nowSec: number
  limit?: number
}): ScoredCandidate[] {
  const { profile, library, metaOf, newPool, mood, nowSec, limit = 25 } = args
  const out: ScoredCandidate[] = []
  const profileEmpty = Object.keys(profile).length === 0

  const push = (meta: GameMeta, source: ScoredCandidate['source']) => {
    if (!fitsSocial(meta, mood)) return
    const base = profileEmpty ? popularityScore(meta) : cosine(profile, normalizedTags(meta))
    out.push({ appid: meta.appid, name: meta.name, source, score: base * moodMultiplier(meta, mood) })
  }

  for (const g of library) {
    const meta = metaOf(g.appid)
    if (!meta) continue
    const state = classifyLibraryGame(g, nowSec)
    if (state === 'unplayed') push(meta, 'backlog')
    else if (state === 'comeback') push(meta, 'comeback')
  }

  const owned = new Set(library.map((g) => g.appid))
  for (const meta of newPool) {
    if (!owned.has(meta.appid)) push(meta, 'new')
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}
