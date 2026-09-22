import { discountOf } from './discount'
import { isJunk } from './junk'
import { cosine, type TagWeight } from './tagweight'
import type {
  CandidateSource,
  GameMeta,
  LibraryGame,
  Mood,
  ScoreParts,
  ScoredCandidate,
} from './types'

/** id категорий Steam, означающих «можно с друзьями» */
const MULTIPLAYER_CATEGORIES = new Set([1, 9, 24, 36, 38, 39, 49])

const UNPLAYED_MAX_MIN = 120
const COMEBACK_AFTER_SEC = 180 * 86_400

/**
 * Экспортируется ради отбора кандидатов: там надо
 * оценить игру по ОДНОЙ оси, а scoreCandidates умеет только целое настроение.
 */
export const VIBE_TAGS: Record<Mood['vibe'], string[]> = {
  chill: ['Casual', 'Relaxing', 'Cozy', 'Wholesome', 'Puzzle', 'Atmospheric', 'Farming Sim'],
  engaged: ['Difficult', 'Competitive', 'Souls-like', 'Tactical', 'Strategy', 'Fast-Paced'],
}

/*
 * Корзины длины сессии.
 *
 * Раньше medium был ПУСТ, то есть самый частый ответ на самый ценный вопрос
 * квиза не двигал ни скор, ни объяснение на карточке. А он же — дефолт четырёх
 * входов: NEUTRAL_MOOD, «Игра дня», прямой заход на /play и половина пресетов.
 * Треть опроса была декорацией.
 *
 * В корзины идут теги, говорящие о ДЛИНЕ, а не о жанре. Поэтому из long убраны
 * 'Adventure' (53% каталога), 'Story Rich' и 'Simulation': тег у половины игр
 * не может ничего разделить — с ними поправка становилась почти равномерной,
 * то есть снова no-op. Замерено на 5723 играх: с ними охват long 81%, без них
 * 62%, и именно во втором случае ответ начинает что-то значить.
 *
 * Покрытие по пулу: short 34%, medium 59%, long 62%. У 7% игр не срабатывает
 * ни одна корзина — про их длину ничего не известно, и это причина не судить,
 * а не судить плохо.
 */
export const TIME_TAGS: Record<Mood['time'], string[]> = {
  short: [
    'Roguelike',
    'Roguelite',
    'Arcade',
    'Card Game',
    'Fast-Paced',
    'Short',
    'Twin Stick Shooter',
    'Bullet Hell',
    'Party Game',
    'Auto Battler',
    'Score Attack',
    'Time Attack',
    'Board Game',
    'Word Game',
    'Runner',
    'Racing',
    'Sports',
    'Rhythm',
    'Deckbuilding',
    'Roguelike Deckbuilder',
    "Shoot 'Em Up",
    'Idler',
    'Chess',
  ],
  medium: [
    'Platformer',
    'Metroidvania',
    'Puzzle Platformer',
    'Precision Platformer',
    'Action-Adventure',
    'Point & Click',
    'Detective',
    'Mystery',
    'Psychological Horror',
    'Stealth',
    'Turn-Based Tactics',
    'Dungeon Crawler',
    'Linear',
    'Walking Simulator',
    'Visual Novel',
    'Interactive Fiction',
    'Choose Your Own Adventure',
    'Hack and Slash',
    'Episodic',
    'Tower Defense',
  ],
  long: [
    'Open World',
    'RPG',
    'JRPG',
    'CRPG',
    'MMORPG',
    'Grand Strategy',
    '4X',
    'Colony Sim',
    'City Builder',
    'Base Building',
    'Automation',
    'Survival',
    'Sandbox',
    'Life Sim',
    'Farming Sim',
    'Crafting',
    'Management',
  ],
}

/*
 * Насколько игра подходит под заявленное время — и матрица намеренно
 * НЕСИММЕТРИЧНА.
 *
 * Аудит просил «сделать симметрично». На данных выяснилось, что честнее иначе:
 * «меньше часа» — это ОГРАНИЧЕНИЕ (стосчасовую RPG за сорок минут физически не
 * начать), а «весь вечер» — ПОЖЕЛАНИЕ (короткую игру никто не мешает включить
 * на весь вечер). Поэтому штраф за «слишком длинную» больше штрафа за
 * «слишком короткую».
 *
 * До этого штрафа не было вовсе — только буст за совпадение, — и игра на сто
 * часов при ответе «меньше часа» не получала ничего.
 */
const TIME_FIT: Record<Mood['time'], Record<Mood['time'], number>> = {
  //          длина игры:  short  medium  long
  short: { short: 0.15, medium: -0.1, long: -0.2 },
  medium: { short: 0, medium: 0.15, long: -0.1 },
  long: { short: -0.1, medium: 0, long: 0.15 },
}

/**
 * Игра может попасть в несколько корзин сразу (Roguelike + Open World).
 * Берём самую выгодную для неё: сомнение толкуем в пользу игры, иначе один
 * случайный тег вычёркивал бы её из выдачи целиком.
 */
export function timeFit(tags: Set<string>, time: Mood['time']): number {
  let best: number | null = null
  for (const [bucket, weight] of Object.entries(TIME_FIT[time]) as Array<
    [Mood['time'], number]
  >) {
    if (!TIME_TAGS[bucket].some((t) => tags.has(t))) continue
    if (best === null || weight > best) best = weight
  }
  return best ?? 0
}

/**
 * Косинус переехал в lib/tagweight.ts вместе с весом редкости; реэкспорт —
 * ради compat, group и тестов, которые берут его отсюда.
 */
export { cosine }

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

/** Только тип: сама база этому модулю не нужна, он чистый */
type FeedbackRow = import('./db').FeedbackRow

/*
 * Шаги фидбека: «зашло» > «запустил» > «открыл карточку». Запуск — сильнее
 * любопытства, но слабее оценки: человек мог запустить и закрыть через минуту.
 */
const LIKE_BOOST = 1.0
const LAUNCH_BOOST = 0.5
const OPEN_BOOST = 0.3
const GENRE_PENALTY = 0.8
const HARD_PENALTY = 1.0
const HARDCORE_TAGS = ['Difficult', 'Souls-like', 'Competitive', 'Tactical', 'Hardcore']

/**
 * Шаг фидбека на большом профиле — эта доля от максимума профиля.
 *
 * Профиль копит часы: у человека с тысячей часов вес любимого тега — десятки,
 * и прежний шаг в единицу был шумом — «зашло» не двигало ничего. Десятая
 * доля от максимума профиля держит шаг соразмерным библиотеке, а пол в
 * единицу оставляет маленькие профили (и тесты) как были.
 */
const FEEDBACK_STEP_SHARE = 0.1

function feedbackStep(profile: Record<string, number>): number {
  let max = 0
  for (const v of Object.values(profile)) if (v > max) max = v
  return Math.max(1, FEEDBACK_STEP_SHARE * max)
}

/**
 * Одна строка на (игру, действие, причину) — самая свежая.
 *
 * Пять нажатий «Зашло» — один сигнал, а не пять: иначе вкус уезжал бы к игре,
 * по которой человек просто кликал, пока грузилась страница. Дедуп в
 * logFeedback держит только сутки, и строки за разные дни здесь тоже
 * схлопываются: для вкуса важно, ЧТО сказано про игру, а не сколько раз.
 *
 * Порядок входа сохраняется: штрафы упираются в ноль, и от порядка шагов
 * зависит результат.
 */
function latestPerKind(feedback: FeedbackRow[]): FeedbackRow[] {
  const keyOf = (f: FeedbackRow) => `${f.appid}:${f.action}:${f.reason ?? ''}`
  const newest = new Map<string, FeedbackRow>()
  for (const f of feedback) {
    const cur = newest.get(keyOf(f))
    if (!cur || f.createdAt > cur.createdAt) newest.set(keyOf(f), f)
  }
  return feedback.filter((f) => newest.get(keyOf(f)) === f)
}

/**
 * Корректирует тег-профиль по истории фидбека: «зашло» усиливает вкус,
 * запуск и открытие карточки — слабее, скипы с причиной «не тот
 * жанр»/«надоела» ослабляют, «слишком сложная» бьёт только по хардкорным
 * тегам. «Не сейчас», «Крутить ещё» и скип без причины — это состояние или
 * случай, а не вкус: профиль не трогают.
 */
export function applyFeedbackToProfile(
  profile: Record<string, number>,
  feedback: FeedbackRow[],
  metaOf: (appid: number) => GameMeta | undefined,
): Record<string, number> {
  const out = { ...profile }
  const step = feedbackStep(profile)
  for (const f of latestPerKind(feedback)) {
    const meta = metaOf(f.appid)
    if (!meta) continue
    const norm = normalizedTags(meta)

    if (f.action === 'liked' || f.action === 'launched' || f.action === 'opened') {
      const boost =
        step * (f.action === 'liked' ? LIKE_BOOST : f.action === 'launched' ? LAUNCH_BOOST : OPEN_BOOST)
      for (const [tag, v] of Object.entries(norm)) out[tag] = (out[tag] ?? 0) + boost * v
    } else if (f.action === 'skipped' && (f.reason === 'genre' || f.reason === 'tired')) {
      for (const [tag, v] of Object.entries(norm)) {
        out[tag] = Math.max((out[tag] ?? 0) - step * GENRE_PENALTY * v, 0)
      }
    } else if (f.action === 'skipped' && f.reason === 'hard') {
      for (const tag of HARDCORE_TAGS) {
        if (tag in norm) out[tag] = Math.max((out[tag] ?? 0) - step * HARD_PENALTY * norm[tag], 0)
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

/**
 * Откуда вообще берутся главные карточки: только из своей библиотеки или из
 * всего каталога.
 *
 * Ось отдельная от Focus, потому что вопрос другой. Focus сужает СВОЁ («покажи
 * только нераспакованное»), scope решает, участвует ли в главной выдаче то,
 * чего у человека нет. По умолчанию 'all': на «во что поиграть» честный ответ
 * не обязан ограничиваться уже оплаченным — но и не должен превращаться в
 * витрину, поэтому у покупок есть потолок (MAX_NEW_PICKS) и весь блок
 * гасится, когда включён Focus.
 */
export type Scope = 'library' | 'all'

export function parseScope(raw: unknown): Scope {
  return raw === 'library' ? 'library' : 'all'
}

/** Карточек в главной выдаче */
export const PICK_COUNT = 5

/**
 * Сколько из них максимум может быть не куплено.
 *
 * Двойка — не про баланс жанров, а про то, за чем человек пришёл: ответ на
 * «во что поиграть сейчас» должен оставаться играбельным сегодня же, без
 * похода в магазин. Потолок поднимается сам, когда играбельного просто мало:
 * у человека с тремя играми в библиотеке пять карточек иначе не набрать.
 */
export const MAX_NEW_PICKS = 2

/**
 * Общий пул для главной выдачи: своё плюс дозированное «нет в библиотеке».
 *
 * Ограничение стоит ЗДЕСЬ, на входе в подбор, а не на выходе: и Claude, и
 * эвристика возвращают карточки вместе с объяснением, привязанным к конкретной
 * игре, и подменять лишнюю покупку после выбора было бы нечем — объяснение
 * пришлось бы выдумывать заново.
 */
export function mixHeroPool<T extends { score: number }>(
  own: T[],
  discovery: T[],
  opts: { maxNew?: number; picks?: number } = {},
): T[] {
  const { maxNew = MAX_NEW_PICKS, picks = PICK_COUNT } = opts
  const allowed = Math.max(maxNew, picks - own.length)
  return [...own, ...discovery.slice(0, allowed)].sort((a, b) => b.score - a.score)
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

/** Сколько совпавших тегов вообще имеет смысл называть. */
const SHARED_TAGS = 3

/**
 * Теги игры, которые уже есть во вкусе игрока, — по убыванию вклада в
 * совпадение.
 *
 * Отдельной функцией, а не строкой внутри explainMatch, потому что спрашивают
 * об этом ДВА экрана, и оба показывают ответ человеку. Выдача берёт список
 * через explainMatch (там же процент и вайб), «Игре дня» нужны только теги:
 * настроения у неё нет вообще — игра одна на сутки и ни под какой вайб не
 * подбиралась. Дублировать эти четыре строки во второй роут значило бы
 * завести второй источник правды ровно для того, что на обоих экранах
 * подсвечивается одинаково.
 */
export function sharedTasteTags(
  profile: Record<string, number>,
  meta: GameMeta,
  /**
   * Вес редкости (lib/tagweight.ts). Без него порядок прежний — по сырому
   * вкладу, и тогда наверх почти всегда выходят Indie и Action: они есть в
   * каждой второй игре, поэтому в профиле весят больше всего. С весом вклад
   * считается так же, как во взвешенном косинусе, — (профиль·вес)·(игра·вес),
   * и называется то, что человека отличает: «Automation», а не «Indie».
   */
  tagWeight: TagWeight | null = null,
): string[] {
  const norm = normalizedTags(meta)
  return Object.entries(norm)
    .filter(([tag]) => (profile[tag] ?? 0) > 0)
    .map(([tag, v]) => {
      const raw = (profile[tag] ?? 0) * v
      return { tag, raw, weighted: tagWeight ? raw * tagWeight(tag) ** 2 : raw }
    })
    // Равный взвешенный вклад (например, у двух тегов, которых нет в карте
    // редкости) решает сырой: иначе порядок зависел бы от порядка ключей
    .sort((a, b) => b.weighted - a.weighted || b.raw - a.raw)
    .slice(0, SHARED_TAGS)
    .map((x) => x.tag)
}

/** Прозрачность выдачи: из чего сложился скоринг этой игры */
export function explainMatch(
  profile: Record<string, number>,
  meta: GameMeta,
  mood: Mood,
  tagWeight: TagWeight | null = null,
): MatchExplanation {
  const profileEmpty = Object.keys(profile).length === 0
  const norm = normalizedTags(meta)
  const matchPercent = profileEmpty ? null : Math.round(cosine(profile, norm) * 100)

  const sharedTags = sharedTasteTags(profile, meta, tagWeight)

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
  mult += timeFit(tags, mood.time)
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
 * 0.55…1.40 (нижнюю границу опустила ось времени: −0.25 за противоположный
 * вайб плюс −0.20 за слишком длинную игру), то есть настроение решает примерно
 * в два с половиной раза. Запечатанная игра
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
 *
 * 0.4, а не прежние 0.3, ровно по этой же причине: у брони появился второй
 * потребитель. При scope = 'all' главная выдача берёт из тех же кандидатов
 * (mixHeroPool), и восьми забронированных мест хватало впритык — две уходили
 * наверх, шесть оставались нижнему блоку, ноль запаса. Десять возвращают
 * запас, не трогая ни порядок, ни длину результата.
 */
const DISCOVERY_SHARE = 0.4

/**
 * Насколько скидка поднимает кандидата из каталога.
 *
 * Максимум +15% к скору при −90% и больше — меньше, чем стоит один тег в
 * профиле. Это наклон, а не сортировка по распродаже: витрину скидок человек
 * и сам откроет, а здесь скидка отвечает лишь на вопрос «раз уж два кандидата
 * одинаково твои, какой показать сегодня».
 *
 * Купленного не касается вовсе: у бэклога цена в прошлом, и скидка на него
 * не меняет ничего, кроме настроения.
 */
const DEAL_BOOST_MAX = 0.15
const DEAL_BOOST_FULL_PERCENT = 90

export function dealMultiplier(meta: GameMeta, source: CandidateSource, nowSec: number): number {
  if (source !== 'new') return 1
  const deal = discountOf(meta, nowSec)
  if (!deal) return 1
  const share = Math.min(deal.percent, DEAL_BOOST_FULL_PERCENT) / DEAL_BOOST_FULL_PERCENT
  return 1 + DEAL_BOOST_MAX * share
}

/**
 * Скор из частей. Порядок умножения тот же, что был до появления частей
 * (вкус × настроение × источник × скидка), и это не педантизм: плавающая
 * точка не ассоциативна, а демо-пятёрки главной зафиксированы тестом до бита.
 * Новые множители идут в хвост — пока они единичные, результат не меняется.
 */
export function scoreOfParts(p: ScoreParts): number {
  return p.taste * p.mood * p.source * p.deal * p.lean * p.cooldown
}

export function scoreCandidates(args: {
  profile: Record<string, number>
  library: LibraryGame[]
  metaOf: (appid: number) => GameMeta | undefined
  newPool: GameMeta[]
  mood: Mood
  nowSec: number
  limit?: number
  /**
   * Кого не показывать вовсе — баны. Отсекаются ЗДЕСЬ, до среза limit, а не
   * фильтром после: иначе забаненные занимали места в тридцатке и выпадали
   * уже за отсечкой, и у человека с десятком банов выдача молча худела.
   */
  exclude?: ReadonlySet<number>
}): ScoredCandidate[] {
  const { profile, library, metaOf, newPool, mood, nowSec, limit = 25, exclude } = args
  const out: ScoredCandidate[] = []
  const profileEmpty = Object.keys(profile).length === 0

  const push = (meta: GameMeta, source: ScoredCandidate['source']) => {
    if (exclude?.has(meta.appid)) return
    if (!fitsSocial(meta, mood)) return
    const parts: ScoreParts = {
      taste: profileEmpty ? popularityScore(meta) : cosine(profile, normalizedTags(meta)),
      mood: moodMultiplier(meta, mood),
      source: SOURCE_WEIGHT[source],
      deal: dealMultiplier(meta, source, nowSec),
      lean: 1,
      cooldown: 1,
    }
    out.push({ appid: meta.appid, name: meta.name, source, score: scoreOfParts(parts), parts })
  }

  for (const g of library) {
    const meta = metaOf(g.appid)
    if (!meta) continue
    // Саундтрек, демка или SDK с нулём минут иначе становятся «ни разу не
    // запускал» с наклоном 1.25 — и в режиме одной игры занимают единственное
    // место. Тот же отсев, что у полки забытого на /library: одно определение
    // мусора на весь продукт.
    if (isJunk(g, meta)) continue
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
