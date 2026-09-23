/**
 * Вес редкости тега — общий для совместимости, подбора и объяснений.
 *
 * Жил приватно в lib/compat.ts, и там он был доказан замерами (см. докблок у
 * tasteCosine). Переехал сюда, когда понадобился подбору: частотные теги —
 * Singleplayer, Indie, Action — есть у половины каталога и в любом профиле
 * весят больше всего, поэтому сырой косинус и список «совпавших тегов» про
 * них и говорили. «По тегам (Indie, Action) это очень твоё» — описание
 * каталога, а не человека.
 *
 * Модуль чистый и ничего не импортирует: его берут и lib/recommend.ts, и
 * lib/compat.ts, а compat сам зависит от recommend — цикл здесь недопустим.
 */

/** Ниже этого карта тегов не считается пригодной — работаем как раньше. */
const MIN_TAG_STATS = 20

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

/**
 * Знаменатель редкости берём как максимум по самой карте, а не как настоящее
 * число игр с тегами.
 *
 * Истинное N потребовало бы либо COUNT(DISTINCT appid) по всей game_tags на
 * каждый запрос (а Turso берёт деньги за прочитанные строки), либо счётчика в
 * catalog_meta, который до ближайшего publish-catalog возвращал бы ноль — и
 * правка молча не работала бы. Разница между истинным N и максимумом — общий
 * сдвиг всех редкостей на константу; на медианах это меняет не больше трёх
 * пунктов (проверено: 0/3/27 против 0/3/25).
 *
 * Чего делать НЕЛЬЗЯ — брать сюда countIngest: это другая популяция (все игры
 * Steam, 138 тысяч), и доля любого тега выходит около двух процентов. На этой
 * ошибке уже был мёртв STOP_TAG_SHARE в lib/pool.ts; там её починили честным
 * счётчиком pool_size, который пишется в catalog_meta рядом с game_count (см.
 * rebuildTagStats). Здесь тот же путь не нужен: редкость терпит сдвиг на
 * константу, а стоп-слова — нет.
 */
export function rarityScale(tagStats: Map<string, number>): number {
  let top = 0
  for (const count of tagStats.values()) if (count > top) top = count
  return top >= MIN_TAG_STATS ? top : 0
}

/** Тег у половины каталога не разделяет людей — его вес около нуля. */
export function rarityOf(tag: string, tagStats: Map<string, number>, top: number): number {
  const df = tagStats.get(tag)
  return !df || df >= top ? 0 : Math.log(top / df)
}

/** Вес тега: во сколько раз его совпадение говорит больше, чем «средний» тег. */
export type TagWeight = (tag: string) => number

/**
 * Вес редкости по карте тегов каталога. null — карта непригодна (пустая база,
 * непрогретый каталог): тогда все потребители работают по-старому, без веса.
 *
 * Тег, которого в карте нет, весит ноль — то же правило, что у совместимости:
 * про его редкость ничего не известно, и утверждать по нему нечего.
 */
export function tagWeightFrom(tagStats: Map<string, number>): TagWeight | null {
  const top = rarityScale(tagStats)
  if (!top) return null
  return (tag) => rarityOf(tag, tagStats, top)
}

/** Вектор тегов, взвешенный редкостью. Теги с нулевым весом выпадают. */
export function weighTags(v: Record<string, number>, w: TagWeight | null): Record<string, number> {
  if (!w) return v
  const out: Record<string, number> = {}
  for (const [tag, value] of Object.entries(v)) {
    const r = w(tag)
    if (r > 0) out[tag] = value * r
  }
  return out
}

function isEmpty(v: Record<string, number>): boolean {
  for (const x of Object.values(v)) if (x !== 0) return false
  return true
}

/**
 * Остаётся ли у вектора хоть что-то после веса. Без веса — да: считается
 * сырой косинус. С весом — нет, когда все теги частотные или неизвестные карте.
 */
export function weighsSomething(v: Record<string, number>, w: TagWeight | null): boolean {
  return !w || !isEmpty(weighTags(v, w))
}

/**
 * Косинус с весом редкости против ОДНОГО вектора, который взвешивается один
 * раз: в подборе это профиль человека против сотен кандидатов подряд.
 *
 * Откат на сырой косинус — только за эту сторону: когда веса нет вовсе или
 * она сама взвешивается в ноль (все её теги частотные или неизвестные карте).
 * Решение тогда одно на весь запрос, и все кандидаты меряются одной шкалой.
 *
 * Кандидат, взвешенный в ноль, получает ноль, а не сырой косинус. Откат по
 * одному кандидату смешивал шкалы: игра с одним Singleplayer получала сырые
 * 0.7 и обходила игру с настоящим редким совпадением на 0.2 — ровно то, от
 * чего вес редкости и защищает. Пара «человек — человек» (tasteCosine в
 * lib/compat.ts) откатывается по-своему: там сравниваются двое, а не
 * ранжируется список.
 */
export function weightedCosineTo(
  a: Record<string, number>,
  w: TagWeight | null,
): (b: Record<string, number>) => number {
  if (!w) return (b) => cosine(a, b)
  const wa = weighTags(a, w)
  if (isEmpty(wa)) return (b) => cosine(a, b)
  return (b) => cosine(wa, weighTags(b, w))
}

export function weightedCosine(
  a: Record<string, number>,
  b: Record<string, number>,
  w: TagWeight | null,
): number {
  return weightedCosineTo(a, w)(b)
}
