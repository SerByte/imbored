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

/** Явно запрошенный режим выдачи — не настроение, а «покажи только вот это» */
export type Focus = 'untouched'

export function parseFocus(raw: unknown): Focus | null {
  return raw === 'untouched' ? 'untouched' : null
}

/** Ниже этого числа режим «только запечатанное» превращается в тупик */
const FOCUS_FLOOR = 3

/**
 * «Покажи только то, во что я не играл». Жёсткий фильтр, но с полом.
 *
 * У игрока может не найтись трёх запечатанных игр с метаданными, а пустой экран
 * — худший из возможных ответов на «во что поиграть». Тогда добираем бэклогом
 * («открыл и закрыл»), и только потом сдаёмся и отдаём всё. Тот же приём, что в
 * filterActual и filterPlayable: фильтр, который всё выкинул, — не фильтр.
 *
 * Порядок сохраняется: вход уже отранжирован.
 */
export function applyFocus<T extends { source: CandidateSource }>(
  candidates: T[],
  focus: Focus | null,
): T[] {
  if (focus !== 'untouched') return candidates
  const untouched = candidates.filter((c) => c.source === 'untouched')
  if (untouched.length >= FOCUS_FLOOR) return untouched
  const widened = [...untouched, ...candidates.filter((c) => c.source === 'backlog')]
  return widened.length ? widened : candidates
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

/**
 * «Ни разу не запускал»: строже, чем isUnplayed — не «меньше двух часов»,
 * а ноль минут. Игра, которую даже не скачивали.
 *
 * Строгое подмножество isUnplayed, и это инвариант, а не совпадение. Счётчики
 * бэклога, цена в долларах и «Чистилище» на портрете считают ВЕСЬ бэклог и
 * остаются на isUnplayed — разойтись этим определениям нельзя, см. докблок
 * выше: они уже расходились однажды и показывали разные числа одному игроку.
 *
 * Проверка playtime2Weeks избыточна арифметически (ноль за всё время не может
 * быть меньше нуля за две недели), но повторяет форму isUnplayed и страхует от
 * битой записи Steam, где эти два поля противоречат друг другу.
 */
export function isUntouched(g: LibraryGame): boolean {
  return g.playtimeForever === 0 && g.playtime2Weeks === 0
}

export function classifyLibraryGame(g: LibraryGame, nowSec: number): LibraryGameState {
  if (g.playtime2Weeks > 0) return 'active'
  if (g.playtimeForever < UNPLAYED_MAX_MIN) return 'unplayed'
  // Steam отдаёт rtime_last_played только владельцу ключа; без даты считаем
  // наигранную, но не тронутую 2 недели игру кандидатом на возвращение.
  // Сравнение с undefined, а не truthy: lastPlayed = 0 теперь доезжает из
  // Steam и должен идти по общей ветке (now - 0 всегда больше порога, то есть
  // результат тот же 'comeback' — правка нейтральна по поведению).
  if (g.lastPlayed === undefined) return 'comeback'
  if (nowSec - g.lastPlayed > COMEBACK_AFTER_SEC) return 'comeback'
  return 'played'
}

/**
 * Состояние для подписи плитки: то же самое, но с отделённым «запечатано».
 *
 * Отдельная функция, а не пятый член LibraryGameState: добавление 'untouched'
 * в тот union молча сломало бы четыре места, ни одно из которых не является
 * ошибкой типов — lib/stats.ts (`!== 'unplayed'`) перестал бы считать нулевые
 * игры и цена бэклога просела бы, а wrapped и portrait считают через
 * isUnplayed и продолжили бы показывать старое число.
 */
export type LibraryTileState = 'untouched' | LibraryGameState

export function libraryTileState(g: LibraryGame, nowSec: number): LibraryTileState {
  const state = classifyLibraryGame(g, nowSec)
  return state === 'unplayed' && isUntouched(g) ? 'untouched' : state
}

/**
 * Порядок по вкусу: косинус между тег-профилем и тегами игры.
 *
 * Игры без метаданных уезжают в конец, а не выбрасываются: мета приезжает
 * прогревом, и у части библиотеки её может не быть вовсе. Сортировка
 * стабильная, поэтому при равном вкусе порядок не скачет между запросами.
 */
export function rankByTaste(
  games: LibraryGame[],
  metaOf: (appid: number) => GameMeta | undefined,
  profile: Record<string, number>,
): LibraryGame[] {
  return games
    .map((g) => {
      const meta = metaOf(g.appid)
      return { g, score: meta ? cosine(profile, normalizedTags(meta)) : -1 }
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.g)
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

/**
 * Вес источника. Двигается ровно одно число — «ни разу не запускал»: за этим
 * человек и приходит («куча игр, которые я даже не скачивал»).
 *
 * 1.25 откалибровано по уже существующему разбросу: moodMultiplier живёт в
 * 0.75…1.40, то есть настроение решает примерно вдвое. Запечатанная игра
 * выигрывает ничью и почти-ничью, но проигрывает тому, что заметно ближе по
 * вкусу. Это наклон, а не фильтр — фильтр отдельно, в applyFocus.
 *
 * У 'new' вес намеренно единичный: равномерный множитель не переупорядочил бы
 * блок открытий, но изменил бы, кто из каталога переживёт отсечку limit.
 */
const SOURCE_WEIGHT: Record<CandidateSource, number> = {
  untouched: 1.25,
  backlog: 1,
  comeback: 1,
  new: 1,
}

/**
 * Доля лимита, забронированная за каталогом.
 *
 * Ранжирование общее, а бюджет раздельный, и это обязательный спутник наклона:
 * scoreCandidates режет глобально, дальше splitBySource отдаёт discovery в
 * отдельный блок «Нет в твоей библиотеке», и без брони усиленный бэклог
 * выбрал бы все слоты — блок просто перестал бы рендериться. Без ошибки,
 * без пустого состояния, молча.
 */
const DISCOVERY_SHARE = 0.3

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
    out.push({
      appid: meta.appid,
      name: meta.name,
      source,
      score: base * moodMultiplier(meta, mood) * SOURCE_WEIGHT[source],
    })
  }

  for (const g of library) {
    const meta = metaOf(g.appid)
    if (!meta) continue
    const state = classifyLibraryGame(g, nowSec)
    if (state === 'unplayed') push(meta, isUntouched(g) ? 'untouched' : 'backlog')
    else if (state === 'comeback') push(meta, 'comeback')
  }

  const owned = new Set(library.map((g) => g.appid))
  for (const meta of newPool) {
    if (!owned.has(meta.appid)) push(meta, 'new')
  }

  const ranked = out.sort((a, b) => b.score - a.score)
  const { own, discovery } = splitBySource(ranked)
  // Каждая сторона добирает то, что не выбрала другая, поэтому длина результата
  // остаётся min(limit, всего кандидатов) — ровно как до появления брони.
  const discoveryTake = Math.min(
    discovery.length,
    Math.max(limit - own.length, Math.round(limit * DISCOVERY_SHARE)),
  )
  return [...own.slice(0, limit - discoveryTake), ...discovery.slice(0, discoveryTake)].sort(
    (a, b) => b.score - a.score,
  )
}
