import { filterActual } from './actual'
import {
  bannedAppids,
  getGamesMetaLite,
  getLatestSnapshot,
  getPoolSize,
  listFeedback,
  loadTagStats,
  type Db,
  type FeedbackRow,
} from './db'
import { editionKey } from './editions'
import { nearGames } from './gamepage'
import type { Lean } from './mood'
import type { NudgePlan } from './nudge'
import { fetchDiscoveryPool, pickQueryTags, rotationSlot } from './pool'
import {
  applyFeedbackToProfile,
  applyFocus,
  buildTagProfile,
  capSource,
  cooldownOf,
  mixHeroPool,
  scoreCandidates,
  seenTagsOf,
  splitBySource,
  type Cooldown,
  type CooldownKind,
  type Focus,
  type NudgeTilt,
  type Scope,
} from './recommend'
import { tagWeightFrom, type TagWeight } from './tagweight'
import type { GameMeta, LibraryGame, Mood, ScoredCandidate } from './types'

/*
 * КОНВЕЙЕР КАНДИДАТОВ — ОДИН НА ВСЕ ВЫДАЧИ.
 *
 * /api/recommend и /api/daily шли одной и той же дорогой — снапшот, баны,
 * фидбек, профиль вкуса, пул каталога, скоринг, актуальность, — и каждый нёс
 * свою копию. Копии уже разъехались: «Игра дня» читала метаданные только
 * библиотеки, и оценка игры не из библиотеки («Зашло» у находки из каталога)
 * её вкус не двигала, хотя /play двигала. Третий вход — подталкивания и
 * режим исследователя — завёл бы третью копию.
 *
 * Здесь всё, что стоит между steamid и отранжированными кандидатами. Что с
 * ними делать дальше — модель или эвристика, пятёрка или колода, что
 * запомнить на сутки, — решает маршрут. Отказы — строкой, а не ответом:
 * коды пишет маршрут, и сторож экранов отказа (lib/failscreens.test.ts)
 * видит их там же, где страница их ждёт.
 */

/** Кандидатов на ранжирование: из них модель или эвристика выбирает пятёрку */
export const CANDIDATE_LIMIT = 30

/**
 * Пул каталога, добираемый вне тегов профиля. Тридцать штук на четыре сотни —
 * заметная, но не подавляющая доля: ровно чтобы у большой игры не из твоего
 * жанра появился шанс, а не чтобы выдача перестала быть твоей.
 */
const WILDCARD_POOL = 30

/** Сколько игр каталога читает пул открытий — одним запросом с LIMIT */
const POOL_LIMIT = 400

/**
 * «Что-то другое» (lib/nudge.ts): соседний срез пула по тегам вкуса и вдвое
 * шире добор вне их. Срезов столько же, сколько у недельной ротации
 * (rotationSlot), — следующий по кругу.
 */
const ROTATION_SLOTS = 5
const REROLL_WILDCARD = 60

export type CandidateOpts = {
  /** Серверные часы запроса */
  nowSec: number
  /** Сколько кандидатов оставить после скоринга; по умолчанию CANDIDATE_LIMIT */
  limit?: number
  /**
   * Какие паузы учитывать (cooldownOf). «Игре дня» — только «надоела»:
   * «не сейчас» на /play посреди дня иначе сменило бы игру, выбранную на сутки.
   */
  cooldownKinds?: readonly CooldownKind[]
  /** Пускать ли знакомое любимое — только /play */
  allowFamiliar?: boolean
  /** Сколько знакомого дойдёт до выдачи (capSource); без него — всё */
  familiarCap?: number
  /** Ось состояния (lib/mood.ts) */
  lean?: Lean | null
  /** «Покажи только нераспакованное» */
  focus?: Focus | null
  /** «Как «X», но…» — appid игры, из соседей которой собирать */
  seed?: number | null
  /**
   * Подталкивание после выдачи (lib/nudge.ts). Настроение и источник план уже
   * поменял — маршрут передаёт их вместо спрошенных; здесь — отсев, наклоны и
   * «Что-то другое».
   */
  nudge?: NudgePlan | null
  /**
   * Чего не показывать сверх банов: «Что-то другое» — то, что уже на экране,
   * колоде исследователя — уже пролистанное. Баном это не становится: якорем
   * и «Продолжить» такая игра быть может.
   */
  exclude?: readonly number[]
  /** Без настроения — колода исследователя (scoreCandidates, moodless) */
  moodless?: boolean
}

/**
 * Всё, что конвейер узнал по дороге: маршруту оно нужно для причин, якорей,
 * «Продолжить» и цен, и читать то же самое второй раз незачем.
 */
export type CandidateSet = {
  now: number
  mood: Mood
  games: LibraryGame[]
  /** Мета библиотеки и игр из истории оценок — узкой выборкой, без блобов */
  libMetas: Map<number, GameMeta>
  /** Мета библиотеки, истории оценок и пула каталога */
  metaOf: (appid: number) => GameMeta | undefined
  feedback: FeedbackRow[]
  banned: Set<number>
  cooldown: Map<number, Cooldown>
  profile: Record<string, number>
  tagWeight: TagWeight | null
  /** Затравка, если она применилась: чьи соседи в кандидатах */
  seed: { appid: number; name: string } | null
  /** Отранжированные кандидаты — с частями скора */
  candidates: ScoredCandidate[]
  /** Они же после актуальности (filterActual) */
  actual: ScoredCandidate[]
  /** Своё после фокуса и потолка знакомого */
  own: ScoredCandidate[]
  /** Каталог — блок «Нет в твоей библиотеке» */
  discovery: ScoredCandidate[]
  /** Пул главной выдачи: своё плюс дозированный каталог при scope 'all' */
  heroPool: ScoredCandidate[]
}

export type CandidateMiss = 'nolibrary' | 'nocandidates'

export async function buildCandidates(
  db: Db,
  steamid: string,
  mood: Mood,
  scope: Scope,
  opts: CandidateOpts,
): Promise<CandidateSet | CandidateMiss> {
  const now = opts.nowSec
  /*
   * Пять чтений — двумя заходами, а не лесенкой из пяти.
   *
   * Зависимость тут ровно одна: getGamesMetaLite ниже нужны appid и из
   * библиотеки, и из истории оценок, поэтому он остаётся вторым заходом. Всё
   * остальное друг от друга не зависит вовсе — забаненное и оценки ключуются
   * одним steamid, а статистика тегов и размер пула вообще не про человека.
   * Один обход к Turso стоит около тридцати пяти миллисекунд по замеру на
   * проде; лесенка из пяти ложится в главное действие продукта целиком.
   *
   * Цена размена записана: у человека с сессией, но без снапшота четыре
   * запроса уходят впустую. Случай редкий — снапшот заводит /api/prepare, через
   * который проходит весь путь с квиза, — и молчаливый, в отличие от задержки,
   * которую видят все.
   */
  const [snapshot, banned, feedback, tagStats, poolSize] = await Promise.all([
    getLatestSnapshot(db, steamid),
    bannedAppids(db, steamid),
    listFeedback(db, steamid, 300),
    loadTagStats(db),
    getPoolSize(db),
  ])
  if (!snapshot) return 'nolibrary'

  const games = snapshot.games
  const owned = new Set(games.map((g) => g.appid))
  // Второй ключ владения — по названию: у Skyrim и Skyrim Special Edition
  // разные appid, и по одному только owned каталог предлагал бы купить то,
  // что уже стоит в библиотеке
  const ownedKeys = new Set(games.map((g) => editionKey(g.name)).filter(Boolean))

  // «Не сейчас» прячет игру на трое суток, «надоела» — на месяц: без паузы
  // отложенное возвращалось на следующей же перезагрузке
  const cooldown = cooldownOf(feedback, now, opts.cooldownKinds)

  // Исключённое уходит вместе с банами — и из пула, и из скоринга. Баны сами
  // по себе остаются банами: якорем и «Продолжить» уже показанная игра быть
  // может, забаненная — нет
  const plan = opts.nudge ?? null
  const reroll = plan?.reroll === true
  const shown = new Set(opts.exclude ?? [])
  const hidden = shown.size ? new Set([...banned, ...shown]) : banned

  // Метаданные своей библиотеки И игр из истории оценок: весь каталог на сотне
  // тысяч игр сжёг бы лимит прочитанных строк Turso. Игры из фидбека нужны
  // здесь же — иначе оценка игры, которой нет в библиотеке, перестанет влиять
  // на профиль вкуса. Узкой выборкой, без блобов: кадры героям читает маршрут
  // отдельным запросом по пятёрке. Показанное — отдельной картой и тем же
  // заходом: в libMetas ему не место, filterActual судил бы и по нему
  const [libMetas, shownMetas] = await Promise.all([
    getGamesMetaLite(db, [
      ...new Set([...games.map((g) => g.appid), ...feedback.map((f) => f.appid)]),
    ]),
    // Теги показанного нужны только штрафу похожести «Что-то другое»
    reroll && shown.size ? getGamesMetaLite(db, [...shown]) : new Map<number, GameMeta>(),
  ])
  const poolByAppid = new Map<number, GameMeta>()
  const metaOf = (appid: number): GameMeta | undefined =>
    libMetas.get(appid) ?? poolByAppid.get(appid)

  // профиль вкуса с поправкой на историю «зашло»/«не то»
  const profile = applyFeedbackToProfile(
    buildTagProfile(games, (id) => libMetas.get(id)),
    feedback,
    metaOf,
  )

  // Вес редкости тегов: объяснение называет характерное («Automation»), а не
  // то, что есть у половины каталога. null на непрогретой базе — тогда как раньше.
  const tagWeight = tagWeightFrom(tagStats)

  /*
   * «КАК «X», НО…» — КАНДИДАТЫ ИЗ СОСЕДЕЙ ОДНОЙ ИГРЫ.
   *
   * Только соседи X (nearGames: готовые из game_neighbors, а пока их не
   * залили — полка по тегу), свои и из каталога; дальше обычный скоринг под
   * настроение, ось и паузы. Пул каталога по тегам профиля здесь не нужен:
   * вопрос задан про X, а не про вкус вообще. Соседей не нашлось или всех
   * отсекли фильтры — тот же nocandidates, что у пустой выдачи.
   */
  const seedId = opts.seed ?? null
  let seed: CandidateSet['seed'] = null
  let scoredLibrary = games
  let newPool: GameMeta[]
  if (seedId !== null) {
    const seedMeta = libMetas.get(seedId) ?? (await getGamesMetaLite(db, [seedId])).get(seedId)
    if (!seedMeta) return 'nocandidates'
    const seedKey = editionKey(seedMeta.name)
    const near = new Set(
      (await nearGames(db, seedMeta, tagStats)).games.map((g) => g.appid).filter((id) => id !== seedId),
    )
    scoredLibrary = games.filter((g) => near.has(g.appid))
    newPool = [
      ...(await getGamesMetaLite(db, [...near].filter((id) => !owned.has(id)))).values(),
    ].filter(
      (m) => !ownedKeys.has(editionKey(m.name)) && !(seedKey && editionKey(m.name) === seedKey),
    )
    seed = { appid: seedId, name: seedMeta.name }
  } else {
    newPool = (
      await fetchDiscoveryPool(db, {
        tags: pickQueryTags(profile, tagStats, poolSize),
        bannedAppids: [...hidden],
        requireMultiplayer: mood.social === 'friends',
        rotation: (rotationSlot(steamid, now, ROTATION_SLOTS) + (reroll ? 1 : 0)) % ROTATION_SLOTS,
        limit: POOL_LIMIT,
        wildcard: reroll ? REROLL_WILDCARD : WILDCARD_POOL,
      })
    ).filter((m) => !owned.has(m.appid) && !ownedKeys.has(editionKey(m.name)))
  }
  for (const m of newPool) poolByAppid.set(m.appid, m)

  const tilt: NudgeTilt | null = plan && {
    cut: plan.cut,
    sourceWeight: plan.sourceWeight,
    tagBoost: plan.tagBoost,
    seenTags: reroll ? seenTagsOf(shownMetas.values()) : null,
  }

  const candidates = scoreCandidates({
    profile,
    // При затравке — только свои игры из её соседей; профиль вкуса, якоря и
    // «Продолжить» по-прежнему считаются по всей библиотеке
    library: scoredLibrary,
    metaOf,
    newPool,
    mood,
    nowSec: now,
    // Тридцать, а не прежние двадцать пять: доля каталога в бюджете выросла
    // (DISCOVERY_SHARE), и на прежнем лимите своих кандидатов стало бы меньше,
    // чем было до появления каталога в выдаче
    limit: opts.limit ?? CANDIDATE_LIMIT,
    // Баны — внутри скоринга, до отсечки: фильтр после неё отдавал тридцатку
    // минус забаненные, и места, которые они занимали, не доставались никому
    exclude: hidden,
    // Вкус с весом редкости: совпадение по частотному костяку больше не решает
    tagWeight,
    cooldown,
    allowFamiliar: opts.allowFamiliar,
    // Тот же потолок, что срежет знакомое ниже: без него пол паузы считал бы
    // своими все песочницы и не возвращал отложенное, хотя до выдачи дойдёт одна
    familiarCap: opts.familiarCap,
    lean: opts.lean ?? null,
    nudge: tilt,
    moodless: opts.moodless,
  })
  if (!candidates.length) return 'nocandidates'

  // Игры из библиотеки не проходят офлайн-фильтры каталога — считаем здесь.
  // «С друзьями» судим строже: в компанию не годится то, во что вместе не сесть.
  //
  // Метаданные каталога идут в тот же расчёт, а не только библиотечные: серии
  // определяются по группе целиком, и без пула вопрос «у тебя старая часть, а
  // живёт новая» решался бы вслепую. Но только по КАНДИДАТАМ, а не по всем
  // четырём сотням пула: лишние члены группы ничего не судят, зато могут её
  // возглавить — buildSeriesIndex выбирает победителя по номеру версии, и
  // случайная «Часть 3» из хвоста каталога отменила бы работавшее вытеснение.
  const judged = new Set(candidates.map((c) => c.appid))
  const allMetas = new Map(libMetas)
  for (const [appid, meta] of poolByAppid) {
    if (judged.has(appid) && !allMetas.has(appid)) allMetas.set(appid, meta)
  }
  const actual = filterActual(candidates, allMetas, mood.social === 'friends' ? 'party' : 'solo')

  // Своё и «нет в библиотеке» — разные разговоры и разные блоки. Потолок
  // знакомого ставится ДО смешивания с каталогом: mixHeroPool считает, сколько
  // мест отдать покупкам, по числу своих, и срезанное после него знакомое
  // оставило бы выдачу короче пяти
  const split = splitBySource(actual)
  const own = capSource(applyFocus(split.own, opts.focus ?? null), 'familiar', opts.familiarCap ?? Infinity)
  // При scope 'all' каталог получает и несколько мест в главной выдаче: «во что
  // поиграть» — вопрос про игры, а не про чеки. Потолок держит mixHeroPool
  const heroPool = scope === 'all' ? mixHeroPool(own, split.discovery) : own

  return {
    now,
    mood,
    games,
    libMetas,
    metaOf,
    feedback,
    banned,
    cooldown,
    profile,
    tagWeight,
    seed,
    candidates,
    actual,
    own,
    discovery: split.discovery,
    heroPool,
  }
}
