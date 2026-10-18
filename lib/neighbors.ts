/**
 * Соседи игры — «похожие» по всему вектору тегов, посчитанные заранее.
 *
 * Полка «Похожие» на карточке шла по ОДНОМУ тегу (topGamesByTag в lib/db), и
 * это было про деньги, а не про смысл: запрос по трём тегам с GROUP BY читает
 * все строки game_tags каждого из них, а карточку краулер обходит пятью
 * тысячами адресов. Два десятка тегов игры в рантайме не сравнить — поэтому
 * сравниваются здесь, офлайн (scripts/build-neighbors.ts), а карточка и
 * «Как «X», но…» на /play читают готовые двенадцать строк по первичному
 * ключу (getNeighbors).
 *
 * Основа меры — weightedCosineTo с весом редкости (lib/tagweight), тем же
 * откатом за сторону целиком, что у подбора, якорей и колоды пати. Но вес у
 * соседей свой, и косинусом общей меры их счёт уже не назвать: тема в нём
 * приглушена (THEME_DAMP, themeDampedWeight), а общие предупреждения
 * сближают слабее (CONTENT_SHARE — только в скалярном произведении, не в
 * длинах), и поверх — множители ниже. Не tasteCosine из lib/compat: тот
 * сделан для пары «человек — человек» и при нулевом весе одной из сторон
 * откатывается на сырой косинус, а сырые оценки на порядок больше вычтенных —
 * игра из одних Singleplayer, Indie и Action попала бы в соседи почти каждой.
 *
 * «Похожие» — про то, как в игру играют, а не про то, о чём она. Одних тегов
 * для этого мало: у Deep Rock Galactic главный по голосам и самый редкий тег —
 * Dwarves, и полка советовала Heroes VII, Dwarfs - F2P и Craft The World — ни
 * одного кооперативного шутера. Поэтому к косинусу приложены поправки,
 * каждая про своё (см. buildNeighbors): тема весит меньше механики
 * (THEME_TAGS), общая нагота сближает слабее (CONTENT_SHARE), «только по
 * сети» не соседствует с «только одному» (modeMultiplier), разное ощущение от
 * партии — чуть дальше (feelMultiplier), «Смешанные» отзывы — чуть ниже
 * (qualityMultiplier).
 *
 * Модуль чистый: база, сеть и модель здесь не нужны. Модель не нужна и вовсе.
 */

import { editionKey } from './editions'
import { CONTENT_WARNING_TAGS, GENERIC_TAGS } from './hook'
import { isMultiplayerCategories, SINGLE_PLAYER } from './steamcats'
import { weighTags, type TagWeight } from './tagweight'

/** Соседей на игру: полка показывает шесть (pickSimilar), /play берёт все */
export const NEIGHBORS_K = 12

/** Сколько общих тегов хранится при паре — подпись плитки берёт первые два */
export const SHARED_KEPT = 3

/**
 * Поправки за «главное в игре». Косинус видит все теги разом, и две игры с
 * одинаковым хвостом из Pixel Graphics, Retro и Difficult, но разной сутью
 * (платформер и рогалик) выходят похожими. Совпала суть — чуть выше, не
 * совпало в ней ничего — чуть ниже. Десять процентов в обе стороны: сдвиг
 * порядка среди близких, а не приговор далёким.
 */
export const SAME_CORE_MULT = 1.1
export const NO_CORE_MULT = 0.9

/**
 * Среди скольких первых по голосам тегов ищется суть игры — как у тега полки
 * (SHELF_TAG_POOL в lib/gamepage): без потолка редкость вытащила бы в суть
 * хвост вроде Nudity у The Witcher 3.
 */
const CORE_POOL = 5

/**
 * Теги темы: о чём игра, где и с кем она происходит, — а не что в ней делают.
 *
 * Редкость (lib/tagweight) тянет их наверх сильнее всего: Dwarves стоит у
 * двадцати игр каталога, Vikings — у одиннадцати, и одно такое совпадение
 * перевешивало в косинусе всю механику. Замер на каталоге до правки: у всех
 * двенадцати соседей Deep Rock Galactic первым общим тегом был Dwarves
 * (Heroes VII, Dwarf Fortress, SpellForce 3), у Vampire Survivors в соседях
 * стояли Vampyr и обе Bloodlines — по Vampires.
 *
 * Из вектора тема не выпадает (THEME_DAMP): две кооперативные стрелялки про
 * гномов похожи сильнее, чем стрелялка про гномов и стрелялка про зомби, —
 * просто механика решает раньше. В «главное в игре» (coreTags) тема не идёт
 * вовсе, пока в верхушке есть хоть одна механика.
 *
 * Zombies здесь нет намеренно: зомби в Steam — это орды, баррикады и
 * выживание, то есть механика, а не декорация. С ним в списке Dying Light
 * терял Dead Island и Back 4 Blood, а Project Zomboid — State of Decay.
 *
 * Только сюжет, сеттинг, эпоха и существа. Настроение (Atmospheric, Funny,
 * Cute) и графика сюда не идут: они и так частотные и весят мало, а «уютная»
 * или «сложная» — это уже о том, как играется. Имена — ровно как в Steam, со
 * всеми его странностями («1990's», хвостовой пробел у «Dystopian »):
 * совпадение строгое, как везде в каталоге.
 */
export const THEME_TAGS: ReadonlySet<string> = new Set([
  // существа и народы
  'Aliens',
  'Animals',
  'Birds',
  'Capybaras',
  'Cats',
  'Demons',
  'Dinosaurs',
  'Dogs',
  'Dragons',
  'Dwarves',
  'Elves',
  'Foxes',
  'Horses',
  'Robots',
  'Vampires',
  'Werewolves',
  'Wolves',
  // кто герой
  'Assassins',
  'Ninja',
  'Pirates',
  'Samurai',
  'Superhero',
  'Vikings',
  // сеттинг и эпоха
  '1980s',
  "1990's",
  'Alternate History',
  'Cold War',
  'Cyberpunk',
  'Dark Fantasy',
  'Dystopian ',
  'Fantasy',
  'Futuristic',
  'Gothic',
  'Historical',
  'Lovecraftian',
  'Magic',
  'Mars',
  'Medieval',
  'Military',
  'Modern',
  'Mythology',
  'Nature',
  'Post-apocalyptic',
  'Rome',
  'Sci-fi',
  'Space',
  'Steampunk',
  'Supernatural',
  'Underwater',
  'War',
  'Western',
  'World War I',
  'World War II',
  'Wuxia',
  'Xianxia',
])

/**
 * Во сколько раз тема весит меньше механики того же веса и редкости.
 *
 * Множитель стоит на обеих сторонах пары, поэтому совпадение по теме весит
 * в косинусе около восьмой части прежнего (0.35² ≈ 0.12). Замер на каталоге —
 * в докблоке THEME_TAGS и в золотых тестах scripts/neighborsbuild.test.ts.
 */
export const THEME_DAMP = 0.35

/**
 * Вес тега для соседей: редкость, а у темы — ещё и THEME_DAMP. Одна функция
 * на вектор пары и на подпись плитки (sharedTags): подпись «общее — гномы»
 * у пары кооперативных шутеров врала бы о том, почему они рядом.
 *
 * Не playWeight: так в lib/recommend зовётся вес игры библиотеки по
 * наигранному, и докблоки профиля (lib/badges, lib/llm, lib/wrapped)
 * ссылаются на него по голому имени.
 */
export function themeDampedWeight(w: TagWeight): TagWeight {
  return (tag) => (THEME_TAGS.has(tag) ? w(tag) * THEME_DAMP : w(tag))
}

/**
 * Как в игру играют с людьми — по категориям Steam (lib/steamcats):
 * solo — только одному, multi — без одиночного режима вовсе, both — и так и
 * так. Категорий нет — режим неизвестен, и поправки за него нет.
 *
 * Не по тегу Co-op и не по «есть кооп»: у Stardew Valley и Portal 2 он есть,
 * а соседи у них — одиночные My Time at Portia и Portal, и штрафовать их
 * значило бы спорить с тем, как в эти игры играют чаще всего. Разные по сути
 * только крайние: в HELLDIVERS 2 одному не сесть, в Portal — только одному.
 */
export type PlayMode = 'solo' | 'both' | 'multi'

export function playModeOf(categories: readonly number[]): PlayMode | undefined {
  const single = categories.includes(SINGLE_PLAYER)
  const multi = isMultiplayerCategories(categories)
  if (single && multi) return 'both'
  if (multi) return 'multi'
  return single ? 'solo' : undefined
}

/** Пара «только по сети» — «только одному» */
export const MODE_MISMATCH_MULT = 0.75

/** Поправка пары за режим: крайние друг другу — ×0.75, остальное — как есть */
export function modeMultiplier(a: PlayMode | undefined, b: PlayMode | undefined): number {
  return (a === 'multi' && b === 'solo') || (a === 'solo' && b === 'multi') ? MODE_MISMATCH_MULT : 1
}

/**
 * Ощущение от партии — по семантике (lib/semantics): длина захода и темп.
 * Кладётся только уверенная семантика (SEMANTICS_MIN_CONFIDENCE — тот же
 * порог, что у строки сессии на /game): по одним тегам она повторила бы сами
 * теги, и косинус услышал бы их дважды.
 */
export type NeighborFeel = { session: 'short' | 'medium' | 'long'; pace: number }

/**
 * Сколько снимает самое разное ощущение: забеги на двадцать минут против
 * вечерних партий или темп 10 против 90 — ×0.85. Пятнадцать процентов —
 * порядок среди похожих по механике, а не вычёркивание: у одной механики
 * бывают и короткие, и длинные игры, и обе — честные соседи.
 */
export const FEEL_SPAN = 0.15

const SESSION_STEP = { short: 0, medium: 1, long: 2 } as const

/** Поправка пары за ощущение: 0.85..1, без семантики у любой стороны — 1 */
export function feelMultiplier(a: NeighborFeel | undefined, b: NeighborFeel | undefined): number {
  if (!a || !b) return 1
  const session = Math.abs(SESSION_STEP[a.session] - SESSION_STEP[b.session]) / 2
  const pace = Math.min(1, Math.abs(a.pace - b.pace) / 100)
  return 1 - FEEL_SPAN * Math.max(session, pace)
}

/**
 * Ниже этой доли положительных — «Смешанные» и хуже по шкале Steam. Сосед с
 * такими отзывами отодвигается (QUALITY_MULT), но не вычёркивается: в нише
 * из пяти игр и смешанная — лучше, чем ничего.
 *
 * Поправки за малое число отзывов нет намеренно: в пул соседей (ALIVE_POOL)
 * малоизвестное не попадает и так — на копии каталога у самой тихой игры
 * пула 1235 отзывов, и порог «меньше пятисот» не задел бы ни одной. А при
 * равном сходстве первым и так идёт обсуждаемый (reviewsTotal).
 */
export const QUALITY_MIN_PERCENT = 70
export const QUALITY_MULT = 0.85

/** Поправка соседа за отзывы: «Смешанные» — ×0.85, доля неизвестна — как есть */
export function qualityMultiplier(percent: number | undefined): number {
  return percent !== undefined && Number.isFinite(percent) && percent < QUALITY_MIN_PERCENT ? QUALITY_MULT : 1
}

/** Игра на входе: вектор тегов (любой шкалы — косинусу она безразлична) */
export type NeighborGame = {
  appid: number
  name: string
  tags: Record<string, number>
  /** второй ключ ничьей: при равном сходстве первым идёт обсуждаемый */
  reviewsTotal: number
  /** режим по категориям Steam (playModeOf); нет — поправки за режим нет */
  mode?: PlayMode
  /** доля положительных отзывов, 0..100; нет — поправки за отзывы нет */
  percent?: number
  /** уверенная семантика; нет — поправки за ощущение нет */
  feel?: NeighborFeel
}

export type Neighbor = {
  neighbor: number
  score: number
  /** общие теги по вкладу в сходство, английскими ключами; без общих мест (GENERIC_TAGS) */
  shared: string[]
}

/**
 * Суть игры — k тегов: из CORE_POOL первых по голосам — самые весомые с учётом
 * редкости, как тег полки в topTagOf. Без веса или когда все пять частотные —
 * просто первые по голосам. Ничьи — по имени: порядок ключей tags_json не
 * должен решать.
 *
 * Тема (THEME_TAGS) в суть не идёт: «главное в Deep Rock Galactic — гномы»
 * давало ×1.1 каждой игре про гномов. Исключение — когда в верхушке одни
 * темы: другой сути по тегам у такой игры нет, а пустая сделала бы её «ничем
 * не похожей» на всех (×0.9 с каждым).
 */
export function coreTags(tags: Record<string, number>, w: TagWeight | null, k = 2): string[] {
  const top = Object.entries(tags)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, CORE_POOL)
  const mechanics = top.filter(([t]) => !THEME_TAGS.has(t))
  const byVotes = mechanics.length ? mechanics : top
  if (!w) return byVotes.slice(0, k).map(([t]) => t)
  const scored = byVotes
    .map(([tag, v], i) => ({ tag, i, score: v * w(tag) }))
    .filter((c) => c.score > 0)
    // стабильно: при равном счёте — прежний порядок, то есть по голосам
    .sort((a, b) => b.score - a.score || a.i - b.i)
  return (scored.length ? scored.map((c) => c.tag) : byVotes.map(([t]) => t)).slice(0, k)
}

/** Поправка пары за суть: общий первый тег — ×1.1, ни одного общего из двух — ×0.9 */
export function coreMultiplier(a: readonly string[], b: readonly string[]): number {
  if (a.length && a[0] === b[0]) return SAME_CORE_MULT
  return a.some((t) => b.includes(t)) ? 1 : NO_CORE_MULT
}

/** Сторона игры: теги с ненулевым значением и длина вектора */
type Side = { tags: string[]; vals: number[]; len: number }

function sideOf(v: Record<string, number>): Side {
  const tags: string[] = []
  const vals: number[] = []
  let sq = 0
  for (const [tag, x] of Object.entries(v)) {
    if (!Number.isFinite(x) || x <= 0) continue
    tags.push(tag)
    vals.push(x)
    sq += x * x
  }
  return { tags, vals, len: Math.sqrt(sq) }
}

/** Инвертированный индекс: тег → игры и их значения по этому тегу */
type Postings = Map<string, { idx: number[]; val: number[] }>

/**
 * Во сколько раз слабее сближает пару общий тег предупреждения
 * (CONTENT_WARNING_TAGS: Nudity, Gore…). Приглушается только произведение —
 * в длине вектора тег остаётся в полную силу, и у одной стороны он
 * по-прежнему отличие.
 *
 * Зачем. Когда тема Cyberpunk ушла в THEME_DAMP, главным в векторе Cyberpunk
 * 2077 остался Nudity, и в соседи по одному общему тегу вышли три новеллы для
 * взрослых. Приглушить предупреждения как тему, с обеих сторон, нельзя:
 * длина взрослой новеллы — почти вся в них, и она подобралась бы ко всем
 * чистым играм того же жанра (замер на каталоге: чистых игр со взрослой
 * игрой в первой шестёрке стало бы 497 против прежних 264). Выкинуть из
 * произведения совсем — тоже: Witcher 3 теряла Witcher 2, DOOM Eternal —
 * Serious Sam 4, у них общий Nudity и Gore — честная общность. При 0.35 —
 * ни того, ни другого, а взрослых у чистых игр стало меньше (235).
 */
export const CONTENT_SHARE = 0.35

/**
 * share — приглушать ли общие предупреждения (CONTENT_SHARE). Только у
 * взвешенного индекса: сырой косинус — откат «как было», и он остаётся как
 * было.
 */
function postingsOf(sides: readonly Side[], share: boolean): Postings {
  const out: Postings = new Map()
  sides.forEach((s, i) => {
    s.tags.forEach((tag, k) => {
      let p = out.get(tag)
      if (!p) out.set(tag, (p = { idx: [], val: [] }))
      p.idx.push(i)
      p.val.push(share && CONTENT_WARNING_TAGS.has(tag) ? s.vals[k] * CONTENT_SHARE : s.vals[k])
    })
  })
  return out
}

/**
 * Соседи для всех игр разом.
 *
 * Счёт пары — weightedCosineTo(a, themeDampedWeight(w))(b), умноженный на
 * поправки: за суть (coreMultiplier), за режим (modeMultiplier), за ощущение
 * (feelMultiplier) и за отзывы соседа (qualityMultiplier). Поправка, для
 * которой у одной из сторон нет данных, равна единице: игра без категорий,
 * доли отзывов и семантики меряется ровно как раньше. У стороны a, которая с
 * весом ничего не весит (все теги частотные или неизвестные карте), — сырой
 * косинус против всех, как у weightedCosineTo; кандидат, взвешенный в ноль,
 * соседом не становится (его счёт — ноль). Без карты тегов (w — null) тема
 * не приглушается: косинус сырой, как и был. Общий тег предупреждения
 * сближает пару слабее прочих (CONTENT_SHARE) — тоже только с весом.
 *
 * Считается не попарно, а через инвертированный индекс: скалярные
 * произведения копятся только с играми, у которых есть хоть один общий тег, —
 * пять тысяч игр за секунды, а не двадцать пять миллионов пар.
 *
 * Не соседи:
 *   - сама игра и её же другие издания (editionKey: Skyrim и Skyrim Special
 *     Edition — одна игра, и «похожей» друг на друга они не бывают);
 *   - два издания одной чужой игры — остаётся более похожее;
 *   - то, что отсёк isTarget (записи чужих магазинов: у них нет арта).
 *
 * Порядок: счёт, потом число отзывов, потом appid — чтобы пересборка на том же
 * каталоге давала ту же таблицу до строки.
 */
export function buildNeighbors(
  games: readonly NeighborGame[],
  w: TagWeight | null,
  opts: { k?: number; isTarget?: (g: NeighborGame) => boolean } = {},
): Map<number, Neighbor[]> {
  const k = opts.k ?? NEIGHBORS_K
  const isTarget = opts.isTarget ?? ((g) => g.appid > 0)
  const n = games.length

  const raw = games.map((g) => sideOf(g.tags))
  const pw = w && themeDampedWeight(w)
  const weighted = pw ? games.map((g) => sideOf(weighTags(g.tags, pw))) : raw
  const keys = games.map((g) => editionKey(g.name))
  const cores = games.map((g) => coreTags(g.tags, w))
  const target = games.map((g) => isTarget(g))

  const weightedIndex = postingsOf(weighted, pw !== null)
  // Сырой индекс нужен только играм, которые с весом ничего не весят, —
  // строится по первому требованию
  let rawIndex: Postings | null = w ? null : weightedIndex

  const dot = new Float64Array(n)
  const touched: number[] = []
  const out = new Map<number, Neighbor[]>()

  for (let i = 0; i < n; i++) {
    // Откат на сырой косинус — за эту сторону целиком, как в weightedCosineTo
    const useRaw = weighted[i].len === 0
    const sides = useRaw ? raw : weighted
    const a = sides[i]
    if (a.len === 0) {
      out.set(games[i].appid, [])
      continue
    }
    const index = useRaw ? (rawIndex ??= postingsOf(raw, false)) : weightedIndex

    touched.length = 0
    a.tags.forEach((tag, t) => {
      const p = index.get(tag)
      if (!p) return
      const va = a.vals[t]
      for (let m = 0; m < p.idx.length; m++) {
        const j = p.idx[m]
        if (dot[j] === 0) touched.push(j)
        dot[j] += va * p.val[m]
      }
    })

    const scored: Array<{ j: number; score: number }> = []
    for (const j of touched) {
      const d = dot[j]
      dot[j] = 0
      if (j === i || !target[j]) continue
      if (keys[i] && keys[j] === keys[i]) continue
      const cos = d / (a.len * sides[j].len)
      if (!(cos > 0)) continue
      const score =
        cos *
        coreMultiplier(cores[i], cores[j]) *
        modeMultiplier(games[i].mode, games[j].mode) *
        feelMultiplier(games[i].feel, games[j].feel) *
        qualityMultiplier(games[j].percent)
      scored.push({ j, score })
    }
    scored.sort(
      (x, y) =>
        y.score - x.score ||
        games[y.j].reviewsTotal - games[x.j].reviewsTotal ||
        games[x.j].appid - games[y.j].appid,
    )

    const list: Neighbor[] = []
    const seenKeys = new Set<string>()
    for (const { j, score } of scored) {
      // Пустой ключ ни с кем не склеивается — как в collapseEditions
      if (keys[j]) {
        if (seenKeys.has(keys[j])) continue
        seenKeys.add(keys[j])
      }
      list.push({ neighbor: games[j].appid, score, shared: sharedTags(a, sides[j]) })
      if (list.length >= k) break
    }
    out.set(games[i].appid, list)
  }
  return out
}

/**
 * Общие теги пары по вкладу в сходство — чем сильнее тег держит пару вместе,
 * тем раньше. Общие места (GENERIC_TAGS: Singleplayer, Great Soundtrack…) в
 * подпись не идут: «общее — Action» ничего не объясняет. Вклад считается по
 * тем же сторонам, что и счёт, — тема в них приглушена (themeDampedWeight), и
 * подпись называет сначала механику, ради которой пара рядом.
 */
function sharedTags(a: Side, b: Side): string[] {
  const bv = new Map(b.tags.map((t, i) => [t, b.vals[i]] as const))
  return a.tags
    .map((tag, i) => ({ tag, c: a.vals[i] * (bv.get(tag) ?? 0) }))
    .filter((x) => x.c > 0 && !GENERIC_TAGS.has(x.tag))
    .sort((x, y) => y.c - x.c || (x.tag < y.tag ? -1 : x.tag > y.tag ? 1 : 0))
    .slice(0, SHARED_KEPT)
    .map((x) => x.tag)
}
