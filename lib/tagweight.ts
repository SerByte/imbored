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

/**
 * Сторона косинуса, приготовленная заранее: вектор и его длина.
 *
 * Косинус считал обе нормы на каждой паре, а в подборе одна сторона — профиль
 * человека в четыре сотни тегов — одна и та же для всех кандидатов подряд.
 * Норма профиля и обход всех его ключей повторялись на каждом кандидате:
 * замер на шести тысячах игр каталога в роли библиотеки — 0.6 с CPU на один
 * скоринг, и столько же ещё на якоря. После — десятки миллисекунд.
 */
export type CosineSide = { v: Record<string, number>; len: number }

export function cosineSide(v: Record<string, number>): CosineSide {
  let sq = 0
  for (const x of Object.values(v)) sq += x * x
  return { v, len: Math.sqrt(sq) }
}

/**
 * Косинус двух приготовленных сторон. Обход — по b, и это соглашение: b —
 * короткая сторона (кандидат, два десятка тегов), a — длинная (профиль).
 * Произведение берётся в прежнем порядке, a × b, — сумма та же, что и раньше,
 * с точностью до порядка слагаемых.
 */
export function cosineOf(a: CosineSide, b: CosineSide): number {
  if (a.len === 0 || b.len === 0) return 0
  let dot = 0
  for (const [k, bv] of Object.entries(b.v)) {
    const av = a.v[k]
    if (av !== undefined) dot += av * bv
  }
  return dot / (a.len * b.len)
}

/**
 * Разовый косинус. Через ту же пару функций, что и подбор: «tagWeight: null —
 * скоры ровно прежние, до бита» (lib/recommend.test.ts) сравнивает их между
 * собой, и один алгоритм на оба пути держит это равенство точным.
 */
export function cosine(a: Record<string, number>, b: Record<string, number>): number {
  return cosineOf(cosineSide(a), cosineSide(b))
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

/** Все ли значения вектора — конечные числа */
function allFinite(v: Record<string, number>): boolean {
  for (const x of Object.values(v)) if (!Number.isFinite(x)) return false
  return true
}

/**
 * Вектор тегов, взвешенный редкостью. Теги с нулевым весом выпадают.
 *
 * Не-числа выпадают тоже: одно NaN в стороне косинуса делает NaN её длину, а
 * с ней и скор против любого кандидата. Без веса чистый вектор отдаётся тем же
 * объектом — «tagWeight: null — скоры ровно прежние, до бита» держится и на этом.
 */
export function weighTags(v: Record<string, number>, w: TagWeight | null): Record<string, number> {
  if (!w && allFinite(v)) return v
  const out: Record<string, number> = {}
  for (const [tag, value] of Object.entries(v)) {
    if (!Number.isFinite(value)) continue
    const r = w ? w(tag) : 1
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
 * Взвешенная сторона косинуса, приготовленная один раз. Без веса — сырая.
 *
 * Для стороны, которая прошла weighsSomething: у неё weightedCosineTo не
 * откатывается на сырой косинус, и сравнение двух таких сторон через cosineOf
 * даёт ровно то же, что дал бы он. Так живут якоря в buildAnchorFinder.
 */
export function weightedSide(v: Record<string, number>, w: TagWeight | null): CosineSide {
  return cosineSide(weighTags(v, w))
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
  // Сторона профиля готовится здесь, один раз: норма и вес — не на каждого
  // кандидата. Кандидат взвешивается и меряется сам, обход идёт по его тегам.
  if (w) {
    const wa = weighTags(a, w)
    if (!isEmpty(wa)) {
      const side = cosineSide(wa)
      return (b) => cosineOf(side, weightedSide(b, w))
    }
  }
  const side = cosineSide(a)
  return (b) => cosineOf(side, cosineSide(b))
}

export function weightedCosine(
  a: Record<string, number>,
  b: Record<string, number>,
  w: TagWeight | null,
): number {
  return weightedCosineTo(a, w)(b)
}
