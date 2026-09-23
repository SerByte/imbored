/**
 * Семантика игры без модели: оси, длина сессии, время до веселья.
 *
 * Правило владельца — никакого нового LLM, поэтому здесь нет ни пересказа, ни
 * «понимания». Есть два детерминированных источника:
 *
 *   1. Приор по тегам Steam — явная таблица «тег → вклад в ось», взвешенная
 *      весом тега в игре. Grand Strategy тянет сессию в «на вечер», а старт — в
 *      медленный; Roguelite — в короткие забеги; Relaxing — вниз по сложности.
 *   2. Обновление по отзывам — доли полос из lib/reviewmine. Отзывы двигают
 *      ось только при n ≥ MIN_REVIEWS разобранных отзывов на русском и
 *      английском, и с весом n/(n+20): десяток отзывов — поправка, сотня —
 *      почти решение.
 *
 * Отзыв, который о полосе молчит, приор не трогает: «никто не сказал, что
 * сложно» — не свидетельство, что легко (сто отзывов о сюжете ничего не знают
 * о сложности). Поэтому цель по отзывам собирается как смесь приора с
 * упоминаниями, а не как «50 плюс упоминания»: без упоминаний цель равна приору.
 * Та же конструкция держит монотонность — больше «hard» никогда не даёт меньше
 * сложности, — и она проверена тестом.
 *
 * Модуль клиентобезопасный: чистые функции, из других модулей — только типы.
 * Его возьмёт и крон страниц (lib/pagejob), и страница игры.
 */
import type { MinedReviews } from './reviewmine'
import type { GameSemantics } from './types'

/** Оси приора. session: −1 короткие заходы … +1 на вечер; ttf: −1 сразу … +1 медленный старт; stop: +1 можно бросить в любой момент */
type Dim = 'challenge' | 'complexity' | 'pace' | 'session' | 'ttf' | 'stop'

const DIMS: readonly Dim[] = ['challenge', 'complexity', 'pace', 'session', 'ttf', 'stop']

type Contribution = Partial<Record<Dim, number>>

/*
 * Таблица приора. Вклады в −1..1; тег без строки здесь ничего не говорит.
 *
 * В таблицу идут теги, которые говорят о том, ЧЕГО игра требует, а не о чём
 * она: Fantasy, Sci-fi, Anime сюда не попадут никогда. Имена — ровно как в
 * Steam (Perma Death, а не Permadeath; Beat 'em up с маленькой e): совпадение
 * строгое, как везде в каталоге.
 */
export const TAG_PRIOR: Readonly<Record<string, Contribution>> = {
  // ── сложность ────────────────────────────────────────────────────────────
  Difficult: { challenge: 1 },
  'Souls-like': { challenge: 1, complexity: 0.3 },
  'Precision Platformer': { challenge: 0.9, session: -0.3, stop: 0.3 },
  'Perma Death': { challenge: 0.6 },
  'Traditional Roguelike': { challenge: 0.6, complexity: 0.6, pace: -0.6, stop: 0.6 },
  'Bullet Hell': { challenge: 0.7, pace: 0.9, session: -0.6, ttf: -0.6 },
  'Boss Rush': { challenge: 0.6, session: -0.4 },
  Competitive: { challenge: 0.5, pace: 0.4, ttf: 0.3, stop: -0.6 },
  eSports: { challenge: 0.6, complexity: 0.5, ttf: 0.5, stop: -0.8 },
  PvP: { challenge: 0.3, stop: -0.6 },
  Stealth: { challenge: 0.3, pace: -0.4 },
  Survival: { challenge: 0.3, session: 0.5, ttf: 0.3 },
  'Survival Horror': { challenge: 0.4, pace: -0.3 },
  Metroidvania: { challenge: 0.3, session: 0.1 },

  // ── уют: ниже сложность, медленнее темп, можно бросить ────────────────────
  Casual: { challenge: -0.6, complexity: -0.6, session: -0.5, ttf: -0.7, stop: 0.6 },
  Relaxing: { challenge: -1, pace: -0.8, stop: 0.7 },
  Cozy: { challenge: -1, pace: -0.8, stop: 0.6 },
  Wholesome: { challenge: -0.6, pace: -0.5 },
  'Family Friendly': { challenge: -0.5, complexity: -0.4 },
  Cute: { challenge: -0.2 },
  'Walking Simulator': { challenge: -0.8, complexity: -0.7, pace: -0.8, stop: 0.6 },
  'Visual Novel': { challenge: -0.8, complexity: -0.6, pace: -0.9, stop: 1 },
  'Interactive Fiction': { challenge: -0.6, pace: -0.8, stop: 0.9 },
  'Choose Your Own Adventure': { challenge: -0.5, pace: -0.7, stop: 0.8 },
  'Dating Sim': { challenge: -0.7, pace: -0.8, stop: 0.9 },
  Otome: { challenge: -0.7, pace: -0.8, stop: 0.9 },
  'Hidden Object': { challenge: -0.6, complexity: -0.6, pace: -0.6, session: -0.3, stop: 0.9 },
  'Point & Click': { challenge: -0.3, pace: -0.7, stop: 0.8 },
  Idler: { challenge: -0.8, pace: -1, session: -0.5, stop: 1 },
  Incremental: { challenge: -0.6, pace: -0.7, stop: 1 },
  'Farming Sim': { challenge: -0.6, pace: -0.6, session: 0.6, stop: 0.4 },
  'Life Sim': { challenge: -0.5, pace: -0.5, session: 0.6 },
  Decorating: { challenge: -0.7, pace: -0.7, stop: 0.8 },
  'Match 3': { challenge: -0.4, complexity: -0.6, session: -0.8, ttf: -0.8, stop: 0.7 },
  Solitaire: { challenge: -0.3, complexity: -0.3, session: -0.8, ttf: -0.8, stop: 0.8 },
  Mahjong: { challenge: -0.3, complexity: -0.3, session: -0.8, ttf: -0.8, stop: 0.8 },
  Trivia: { complexity: -0.5, session: -0.7, ttf: -0.9 },

  // ── освоение, вечерние сессии, медленный старт ───────────────────────────
  'Grand Strategy': { complexity: 1, pace: -0.7, session: 1, ttf: 1 },
  '4X': { complexity: 0.9, pace: -0.6, session: 1, ttf: 0.9, stop: 0.5 },
  CRPG: { complexity: 0.8, pace: -0.5, session: 0.8, ttf: 0.7, stop: 0.5 },
  Automation: { complexity: 0.9, session: 0.9, ttf: 0.8 },
  'Colony Sim': { complexity: 0.7, session: 0.8, ttf: 0.6 },
  'City Builder': { complexity: 0.5, pace: -0.5, session: 0.7, ttf: 0.4, stop: 0.5 },
  Management: { complexity: 0.5, pace: -0.3, session: 0.4 },
  'Resource Management': { complexity: 0.5, session: 0.4 },
  Economy: { complexity: 0.5 },
  Trading: { complexity: 0.3 },
  'Political Sim': { complexity: 0.7, pace: -0.5, ttf: 0.5 },
  Diplomacy: { complexity: 0.6, pace: -0.5 },
  Wargame: { complexity: 0.8, pace: -0.5, session: 0.6, ttf: 0.6 },
  'Space Sim': { complexity: 0.6, session: 0.5, ttf: 0.6 },
  Flight: { complexity: 0.4, ttf: 0.3 },
  Programming: { complexity: 1, pace: -0.7, ttf: 0.6, stop: 0.6 },
  Logic: { complexity: 0.4, pace: -0.6, stop: 0.6 },
  'Immersive Sim': { complexity: 0.5, pace: -0.3, ttf: 0.3 },
  'Real-Time with Pause': { complexity: 0.6, stop: 0.5 },
  Strategy: { complexity: 0.4, pace: -0.2 },
  'Turn-Based Strategy': { complexity: 0.6, pace: -0.8, session: 0.5, stop: 0.7 },
  'Turn-Based Tactics': { complexity: 0.5, pace: -0.8, stop: 0.7 },
  'Turn-Based': { pace: -0.8, stop: 0.6 },
  'Turn-Based Combat': { pace: -0.6, stop: 0.4 },
  'Tactical RPG': { complexity: 0.6, pace: -0.5 },
  'Strategy RPG': { complexity: 0.5, pace: -0.4 },
  'Party-Based RPG': { complexity: 0.4, session: 0.5 },
  Tactical: { complexity: 0.4, pace: -0.2 },
  RTS: { challenge: 0.3, complexity: 0.6, pace: 0.6, stop: -0.3 },
  'Real Time Tactics': { complexity: 0.4, pace: 0.3 },
  RPG: { complexity: 0.3, session: 0.5, ttf: 0.3 },
  JRPG: { pace: -0.3, session: 0.6, ttf: 0.4 },
  MMORPG: { complexity: 0.5, session: 1, ttf: 0.7, stop: -0.4 },
  'Massively Multiplayer': { session: 0.6, ttf: 0.4, stop: -0.5 },
  'Open World': { session: 0.5 },
  'Open World Survival Craft': { challenge: 0.3, session: 0.7, ttf: 0.4 },
  Sandbox: { session: 0.5, stop: 0.2 },
  'Base Building': { complexity: 0.3, session: 0.6 },
  Crafting: { complexity: 0.2, session: 0.4 },
  Simulation: { complexity: 0.2 },
  'God Game': { complexity: 0.5, pace: -0.4, session: 0.6 },

  // ── матчи: бросить посреди нельзя ────────────────────────────────────────
  MOBA: { challenge: 0.6, complexity: 0.6, pace: 0.4, session: 0.1, ttf: 0.6, stop: -1 },
  'Extraction Shooter': { challenge: 0.5, pace: 0.4, ttf: 0.4, stop: -0.8 },
  'Battle Royale': { pace: 0.5, session: -0.2, stop: -0.8 },
  'Hero Shooter': { challenge: 0.3, pace: 0.8, stop: -0.8 },
  'Team-Based': { stop: -0.6 },
  'Social Deduction': { session: -0.4, ttf: -0.3, stop: -0.6 },
  'Co-op': { stop: -0.2 },
  'Online Co-Op': { stop: -0.3 },
  'Asynchronous Multiplayer': { stop: 0.6 },

  // ── короткие заходы, веселье с первых минут ──────────────────────────────
  Roguelike: { challenge: 0.4, session: -0.6, ttf: -0.4 },
  Roguelite: { challenge: 0.3, session: -0.7, ttf: -0.6 },
  'Action Roguelike': { challenge: 0.4, pace: 0.7, session: -0.7, ttf: -0.6 },
  'Roguelike Deckbuilder': { complexity: 0.4, session: -0.5, ttf: -0.3, stop: 0.4 },
  Deckbuilding: { complexity: 0.4, session: -0.4 },
  'Card Game': { complexity: 0.3, session: -0.4, stop: 0.3 },
  'Card Battler': { complexity: 0.3, session: -0.4 },
  'Auto Battler': { complexity: 0.3, session: -0.4, stop: -0.3 },
  'Bullet Heaven': { challenge: -0.2, complexity: -0.4, pace: 0.6, session: -0.8, ttf: -0.9 },
  Arcade: { complexity: -0.6, pace: 0.7, session: -0.8, ttf: -0.9 },
  'Party Game': { challenge: -0.4, complexity: -0.8, pace: 0.6, session: -0.8, ttf: -1 },
  Party: { complexity: -0.6, session: -0.6, ttf: -0.8 },
  Minigames: { complexity: -0.6, session: -0.7, ttf: -0.9 },
  Racing: { complexity: -0.3, pace: 0.8, session: -0.6, ttf: -0.7 },
  'Combat Racing': { pace: 0.9, session: -0.6, ttf: -0.7 },
  Sports: { pace: 0.5, session: -0.4, ttf: -0.4 },
  Fighting: { challenge: 0.4, pace: 0.9, session: -0.6, ttf: -0.4 },
  '2D Fighter': { challenge: 0.4, pace: 0.9, session: -0.6 },
  '3D Fighter': { challenge: 0.4, pace: 0.9, session: -0.6 },
  Rhythm: { challenge: 0.3, pace: 0.8, session: -0.8, ttf: -0.8, stop: 0.5 },
  "Shoot 'Em Up": { challenge: 0.4, pace: 0.9, session: -0.7, ttf: -0.8 },
  'Twin Stick Shooter': { pace: 0.8, session: -0.6, ttf: -0.7 },
  'Arena Shooter': { pace: 0.9, session: -0.5, ttf: -0.7 },
  'Boomer Shooter': { pace: 0.9, ttf: -0.6 },
  'Fast-Paced': { pace: 1, ttf: -0.4 },
  'Hack and Slash': { pace: 0.7, ttf: -0.5 },
  "Beat 'em up": { pace: 0.7, session: -0.4, ttf: -0.6 },
  'Spectacle fighter': { challenge: 0.4, pace: 0.9 },
  'Character Action Game': { challenge: 0.4, pace: 0.9 },
  Musou: { challenge: -0.3, pace: 0.8, ttf: -0.6 },
  Platformer: { pace: 0.3, session: -0.2 },
  FPS: { pace: 0.6, ttf: -0.4 },
  Shooter: { pace: 0.5 },
  'Time Management': { challenge: 0.3, pace: 0.6, session: -0.5 },
  'Tower Defense': { complexity: 0.2, pace: -0.2, session: -0.3 },
  'Board Game': { complexity: 0.3, session: -0.3, stop: 0.3 },
  Tabletop: { complexity: 0.3, pace: -0.4 },
  Chess: { complexity: 0.6, pace: -0.8, session: -0.4 },
  'Word Game': { complexity: -0.3, session: -0.7, ttf: -0.7, stop: 0.8 },
  Typing: { session: -0.6, ttf: -0.7 },
  Short: { session: -0.8, ttf: -0.6 },
  'Score Attack': { pace: 0.5, session: -0.8, ttf: -0.8 },
  'Time Attack': { pace: 0.6, session: -0.8 },
  Runner: { complexity: -0.6, pace: 0.7, session: -0.9, ttf: -0.9 },
  Pinball: { pace: 0.6, session: -0.8, ttf: -0.9 },
  Puzzle: { complexity: 0.2, pace: -0.6, session: -0.2, stop: 0.7 },
  Sokoban: { complexity: 0.4, pace: -0.8, stop: 0.8 },
  'Escape Room': { pace: -0.5, session: -0.2 },
  Episodic: { session: -0.2, stop: 0.3 },
  Linear: { ttf: -0.2 },

  // ── повествование: медленнее темп, можно бросить на полуслове ────────────
  'Story Rich': { pace: -0.3, session: 0.2, stop: 0.2 },
  Detective: { complexity: 0.2, pace: -0.6, stop: 0.5 },
  Investigation: { pace: -0.5 },
  Mystery: { pace: -0.4 },
  Atmospheric: { pace: -0.3 },
  Exploration: { pace: -0.4 },
  'Dialogue Heavy': { pace: -0.7, stop: 0.5 },
  'Text-Based': { pace: -0.7, stop: 0.7 },
  Addictive: { session: 0.3 },
}

/**
 * Демпфер приора: сколько «полных» голосов тега должно набраться, чтобы ось
 * ушла далеко от середины. Один тег на полном весе со вкладом 1 даёт ±0.67,
 * два таких — ±0.8: чем больше согласных тегов, тем увереннее, но края шкалы
 * по одним тегам не достигаются никогда.
 */
const PRIOR_DAMPING = 0.5

/** Сумма весов известных таблице тегов, при которой покрытие полное */
const COVERAGE_FULL = 1.5

/** Отзывов на RU/EN меньше этого — оси по отзывам не двигаются вовсе */
export const MIN_REVIEWS = 8

/** Вес отзывов n/(n+REVIEW_HALF): при двадцати отзывах — ровно половина */
const REVIEW_HALF = 20

/**
 * Сколько «доли» весит приор против упоминаний в полосе. Десятая доля
 * отзывов со словом «hard» ставит цель посередине между приором и краем.
 */
const PRIOR_SHARE = 0.1

/** Потолок уверенности по одним тегам */
export const TAGS_MAX_CONFIDENCE = 0.4

/** Какая часть остатка уверенности достаётся отзывам при весе 1 */
const REVIEW_CONFIDENCE = 0.9

/** Минуты сессии: 40 × 4^s, s из −1..1 — от десяти минут до «на вечер» */
const SESSION_MID_MIN = 40
const SESSION_SPREAD = 4
const SESSION_SHORT_MAX = 25
const SESSION_LONG_MIN = 75

/** Выше этого наклона «можно бросить в любой момент» */
const STOP_AT = 0.25

/** Корзины осей на шкале 0..100 */
const LOW_AT = 35
const HIGH_AT = 65

/**
 * Время до веселья по названным часам: от двух часов (окно возврата Steam)
 * — медленный старт, до получаса — быстрый. Число берётся, только если его
 * назвали хотя бы двое: одинокое «через 30 часов» — чаще шутка, чем замер.
 */
const SLOW_HOURS = 2
const FAST_HOURS = 0.5
const MIN_TTF_MENTIONS = 2

/**
 * Вес тега в игре: голоса, нормированные к максимуму, — то же правило, что у
 * normalizedTags в lib/recommend (мусор и не-числа пропускаются, а не делятся:
 * одно NaN сделало бы NaN всю ось). Своя копия — ради клиентобезопасности:
 * recommend тянет за собой половину подбора.
 */
function tagShares(tags: Record<string, number>): [string, number][] {
  const votes = Object.entries(tags ?? {}).filter(
    ([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0,
  )
  const max = Math.max(...votes.map(([, v]) => v), 1)
  return votes.map(([tag, v]) => [tag, v / max])
}

export type TagPrior = {
  /** наклоны осей, −1..1 */
  lean: Record<Dim, number>
  /** насколько таблица знает эту игру, 0..1 */
  coverage: number
}

/** Приор по тегам: наклоны осей и покрытие таблицей */
export function tagPrior(tags: Record<string, number>): TagPrior {
  const sum = Object.fromEntries(DIMS.map((d) => [d, 0])) as Record<Dim, number>
  const mass = Object.fromEntries(DIMS.map((d) => [d, 0])) as Record<Dim, number>
  let known = 0
  // Сортировка — ради детерминизма до бита: порядок сложения чисел с плавающей
  // точкой меняет последние знаки, а порядок ключей tags_json — случайность.
  for (const [tag, w] of tagShares(tags).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const c = TAG_PRIOR[tag]
    if (!c) continue
    known += w
    for (const d of DIMS) {
      const x = c[d]
      if (x === undefined) continue
      sum[d] += w * x
      mass[d] += w * Math.abs(x)
    }
  }
  const lean = Object.fromEntries(
    DIMS.map((d) => [d, mass[d] ? sum[d] / (mass[d] + PRIOR_DAMPING) : 0]),
  ) as Record<Dim, number>
  return { lean, coverage: Math.min(1, known / COVERAGE_FULL) }
}

const toScale = (lean: number) => 50 + 50 * lean
const clamp100 = (x: number) => Math.min(100, Math.max(0, x))

/**
 * Сдвиг оси по отзывам. up и down — доли полос, толкающих ось вверх и вниз;
 * weight — n/(n+20). Цель — смесь приора с упоминаниями: без упоминаний она
 * равна приору, и ось не двигается; с упоминаниями тянется к краю. По up цель
 * монотонно растёт, по down — падает, и weight от долей не зависит.
 */
function pull(prior: number, up: number, down: number, weight: number): number {
  const target = (prior * PRIOR_SHARE + 100 * up) / (PRIOR_SHARE + up + down)
  return prior + weight * (target - prior)
}

const round5 = (x: number) => Math.round(x / 5) * 5
const round2 = (x: number) => Math.round(x * 100) / 100

/**
 * Семантика игры из тегов и — если набралось — из разбора отзывов.
 *
 * mined — результат mineReviews по ответу appreviews, null — отзывов не
 * получали. При n < MIN_REVIEWS результат ровно тот же, что без отзывов, с
 * basis 'tags': десяток слов не повод двигать приор.
 */
export function deriveSemantics(
  tags: Record<string, number>,
  mined: MinedReviews | null,
): GameSemantics {
  const { lean, coverage } = tagPrior(tags)
  const n = mined?.n ?? 0
  const useReviews = mined !== null && n >= MIN_REVIEWS
  const weight = useReviews ? n / (n + REVIEW_HALF) : 0
  const share = (lane: keyof MinedReviews['lanes']) => (useReviews ? mined.lanes[lane].share : 0)

  const axis = (d: Dim, up: number, down: number) => clamp100(pull(toScale(lean[d]), up, down, weight))
  const challenge = axis('challenge', share('hard'), share('relaxing'))
  const complexity = axis('complexity', share('complex'), 0)
  const pace = axis('pace', 0, share('relaxing'))
  const session = axis('session', share('longSession'), share('shortSession'))
  const ttf = axis('ttf', share('slowStart'), 0)

  const minutes = round5(SESSION_MID_MIN * SESSION_SPREAD ** ((session - 50) / 50))
  const bucket = minutes <= SESSION_SHORT_MAX ? 'short' : minutes >= SESSION_LONG_MIN ? 'long' : 'medium'

  const hours =
    useReviews && mined.timeToFunHours !== null && mined.timeToFunMentions >= MIN_TTF_MENTIONS
      ? mined.timeToFunHours
      : null
  const ttfBucket =
    hours !== null
      ? hours >= SLOW_HOURS
        ? 'slow'
        : hours <= FAST_HOURS
          ? 'fast'
          : null
      : ttf >= HIGH_AT
        ? 'slow'
        : ttf <= LOW_AT
          ? 'fast'
          : null

  const tagConfidence = TAGS_MAX_CONFIDENCE * coverage
  const confidence = tagConfidence + (1 - tagConfidence) * weight * REVIEW_CONFIDENCE

  return {
    v: 1,
    axes: {
      challenge: Math.round(challenge),
      complexity: Math.round(complexity),
      pace: Math.round(pace),
    },
    session: { bucket, minutes, canStopAnytime: lean.stop >= STOP_AT },
    timeToFun: { bucket: ttfBucket, hours },
    confidence: round2(confidence),
    n,
    basis: useReviews ? 'tags+reviews' : 'tags',
  }
}
