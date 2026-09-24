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
 * Мера — weightedCosineTo с весом редкости (lib/tagweight): та же, которой
 * ранжируют подбор, якоря и колода пати. Не tasteCosine из lib/compat: тот
 * сделан для пары «человек — человек» и при нулевом весе одной из сторон
 * откатывается на сырой косинус, а сырые оценки на порядок больше вычтенных —
 * игра из одних Singleplayer, Indie и Action попала бы в соседи почти каждой.
 *
 * Модуль чистый: база, сеть и модель здесь не нужны. Модель не нужна и вовсе.
 */

import { editionKey } from './editions'
import { GENERIC_TAGS } from './hook'
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

/** Игра на входе: вектор тегов (любой шкалы — косинусу она безразлична) */
export type NeighborGame = {
  appid: number
  name: string
  tags: Record<string, number>
  /** второй ключ ничьей: при равном сходстве первым идёт обсуждаемый */
  reviewsTotal: number
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
 */
export function coreTags(tags: Record<string, number>, w: TagWeight | null, k = 2): string[] {
  const byVotes = Object.entries(tags)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, CORE_POOL)
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

function postingsOf(sides: readonly Side[]): Postings {
  const out: Postings = new Map()
  sides.forEach((s, i) => {
    s.tags.forEach((tag, k) => {
      let p = out.get(tag)
      if (!p) out.set(tag, (p = { idx: [], val: [] }))
      p.idx.push(i)
      p.val.push(s.vals[k])
    })
  })
  return out
}

/**
 * Соседи для всех игр разом.
 *
 * Счёт пары — ровно weightedCosineTo(a, w)(b): у стороны a, которая с весом
 * ничего не весит (все теги частотные или неизвестные карте), — сырой косинус
 * против всех, как у weightedCosineTo; кандидат, взвешенный в ноль, соседом не
 * становится (его счёт — ноль). Считается не попарно, а через инвертированный
 * индекс: скалярные произведения копятся только с играми, у которых есть хоть
 * один общий тег, — пять тысяч игр за секунды, а не двадцать пять миллионов
 * пар.
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
  const weighted = w ? games.map((g) => sideOf(weighTags(g.tags, w))) : raw
  const keys = games.map((g) => editionKey(g.name))
  const cores = games.map((g) => coreTags(g.tags, w))
  const target = games.map((g) => isTarget(g))

  const weightedIndex = postingsOf(weighted)
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
    const index = useRaw ? (rawIndex ??= postingsOf(raw)) : weightedIndex

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
      scored.push({ j, score: cos * coreMultiplier(cores[i], cores[j]) })
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
 * подпись не идут: «общее — Action» ничего не объясняет.
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
