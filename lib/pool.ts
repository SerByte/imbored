import type { Db } from './db'
import type { GameMeta } from './types'

/**
 * Выборка кандидатов «попробуй новое» из большого каталога.
 *
 * Turso тарифицирует ПРОЧИТАННЫЕ строки, поэтому полный скан каталога на
 * каждый запрос неприемлем: сотня тысяч строк на подбор сожгла бы месячный
 * лимит за считанные дни. Здесь читается порядка тысячи строк: по ветке
 * на каждый тег профиля с LIMIT внутри, затем join к метаданным.
 *
 * Сортировка идёт по ХАРАКТЕРНОСТИ тега, а не по популярности: «топ по тегу
 * Roguelike» — это игры, которые больше всего являются рогаликами, а не самые
 * продаваемые. Это встроенная защита от «всем выпадают одни и те же хиты».
 */

export type DiscoveryQuery = {
  /** теги профиля; пустой список уводит в холодный старт */
  tags: string[]
  bannedAppids?: number[]
  requireMultiplayer?: boolean
  /** сколько игр брать по каждому тегу */
  perTag?: number
  limit?: number
  /** слот разнообразия: сдвигает окно по хвосту */
  rotation?: number
  /**
   * Сколько заметных игр добрать ВНЕ тегов профиля.
   *
   * Ветки по тегам отвечают на «что ещё такое же», и без этой добавки каталог
   * для человека сужается до его собственного вкуса: любитель рогаликов не
   * увидит ни одной большой RPG, сколько бы их ни было в базе. Скоринг таких
   * кандидатов не трогается — по косинусу они выигрывают редко, но шанс у них
   * появляется. Стоит одного запроса по индексу.
   */
  wildcard?: number
}

const DEFAULT_PER_TAG = 60
const DEFAULT_LIMIT = 400
/** Тег, который есть у слишком большой доли каталога, о вкусе не говорит ничего */
const STOP_TAG_SHARE = 0.15
const DEFAULT_TAG_COUNT = 12

const COLUMNS = `g.appid, g.name, g.tags_json, g.genres_json, g.categories_json,
  g.short_description, g.header_image, g.art_json, g.is_free, g.price_final,
  g.price_initial, g.discount_percent, g.discount_ends_at, g.price_at,
  g.release_date, g.median_forever, g.store, g.store_url,
  g.reviews_total, g.reviews_percent, g.ccu,
  g.developer, g.publisher, g.release_year, g.signals_at, g.alive, g.superseded_by`

type PoolRow = {
  appid: number
  name: string
  tags_json: string
  genres_json: string
  categories_json: string
  short_description: string | null
  header_image: string | null
  art_json: string | null
  is_free: number | null
  price_final: number | null
  price_initial: number | null
  discount_percent: number | null
  discount_ends_at: number | null
  price_at: number | null
  release_date: string | null
  median_forever: number | null
  store: string | null
  store_url: string | null
  reviews_total: number | null
  reviews_percent: number | null
  ccu: number | null
  developer: string | null
  publisher: string | null
  release_year: number | null
  signals_at: number | null
  alive: number | null
  superseded_by: number | null
}

function rowToMeta(row: PoolRow): GameMeta {
  const meta: GameMeta = {
    appid: row.appid,
    name: row.name,
    tags: JSON.parse(row.tags_json),
    genres: JSON.parse(row.genres_json),
    categories: JSON.parse(row.categories_json),
  }
  if (row.short_description) meta.shortDescription = row.short_description
  if (row.header_image) meta.headerImage = row.header_image
  if (row.art_json) meta.art = JSON.parse(row.art_json)
  if (row.is_free !== null) meta.isFree = row.is_free === 1
  if (row.price_final !== null) meta.priceFinal = row.price_final
  // Скидка: без этих четырёх колонок карточка открытия знала бы цену, но не
  // знала бы, что она распродажная — ровно тот класс потери, что уже был у
  // developer и signals_at (см. докблоки в lib/db и lib/types)
  if (row.price_initial !== null && row.price_initial !== undefined) {
    meta.priceInitial = row.price_initial
  }
  if (row.discount_percent !== null && row.discount_percent !== undefined) {
    meta.discountPercent = row.discount_percent
  }
  if (row.discount_ends_at !== null && row.discount_ends_at !== undefined) {
    meta.discountEndsAt = row.discount_ends_at
  }
  if (row.price_at !== null && row.price_at !== undefined) meta.priceAt = row.price_at
  if (row.release_date) meta.releaseDate = row.release_date
  if (row.median_forever !== null) meta.medianForever = row.median_forever
  if (row.store) meta.store = row.store
  if (row.store_url) meta.storeUrl = row.store_url
  if (row.reviews_total !== null) meta.reviewsTotal = row.reviews_total
  // Сигналы живости. Пока каталог жил отдельным блоком внизу, судить его было
  // не по чему и не нужно: офлайн-курация уже отсеяла мёртвое для одиночной
  // игры. С выходом каталога в главную выдачу — и особенно в режим «с
  // друзьями», где живость решает всё, — эти два поля перестали быть лишними.
  if (row.reviews_percent !== null && row.reviews_percent !== undefined) {
    meta.reviewsPercent = row.reviews_percent
  }
  if (row.ccu !== null && row.ccu !== undefined) meta.ccu = row.ccu

  /*
   * Издатель, разработчик и вердикт курации.
   *
   * Пока каталог жил отдельным блоком внизу, серии по нему считались офлайн, и
   * в проекции этих полей не было. С выходом каталога в общий расчёт серий их
   * отсутствие стало не экономией, а ошибкой: buildSeriesIndex выбирает в
   * группе победителя по номеру версии, и кандидат из каталога легко забирал
   * эту роль — а дальше, без издателя, не проходил sameMaker и НЕ вытеснял
   * старую часть, которую до его появления вытесняла своя же вторая. Итог:
   * добавление каталога втихую воскрешало мёртвый мультиплеер в библиотеке.
   *
   * Тройка signals_at / alive / superseded_by читается целиком — ровно как в
   * lib/db.ts: alive = 1 стоит по умолчанию и сам по себе означает лишь «не
   * помечена мёртвой», а не «проверена».
   */
  if (row.developer) meta.developer = row.developer
  if (row.publisher) meta.publisher = row.publisher
  if (row.release_year !== null && row.release_year !== undefined) {
    meta.releaseYear = row.release_year
  }
  if (row.signals_at !== null && row.signals_at !== undefined) {
    meta.signalsAt = row.signals_at
    meta.alive = row.alive === 1
    if (row.superseded_by !== null && row.superseded_by !== undefined) {
      meta.supersededBy = row.superseded_by
    }
  }
  return meta
}

/**
 * Теги для запроса: самые весомые в профиле, за вычетом слишком частых.
 * Стоп-слова считаются по каталогу, а не задаются руками.
 */
export function pickQueryTags(
  profile: Record<string, number>,
  tagStats: Map<string, number>,
  catalogSize: number,
  k = DEFAULT_TAG_COUNT,
): string[] {
  return Object.entries(profile)
    .filter(([, weight]) => weight > 0)
    .filter(([tag]) => {
      const count = tagStats.get(tag)
      if (!count || !catalogSize) return true
      return count / catalogSize <= STOP_TAG_SHARE
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([tag]) => tag)
}

/** FNV-1a: детерминированный хеш без зависимостей */
function hash(s: string): number {
  let h = 2_166_136_261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16_777_619)
  }
  return h >>> 0
}

/**
 * Слот разнообразия: свой у каждого игрока и свой на каждой неделе. Так хвост
 * каталога показывается по очереди, а скоринг при этом не трогается вообще.
 */
export function rotationSlot(steamid: string, nowSec: number, slots = 5): number {
  const week = Math.floor(nowSec / (7 * 86_400))
  return hash(`${steamid}:${week}`) % slots
}

/**
 * Заметные игры каталога по числу отзывов. Ими живёт холодный старт (профиля
 * ещё нет) и добор вне вкуса (wildcard). Идёт по частичному индексу
 * idx_games_pool, поэтому без полного скана.
 */
async function fetchNotable(
  db: Db,
  args: { limit: number; offset: number; mpOnly: number; banned: string },
): Promise<GameMeta[]> {
  const page = async (offset: number) => {
    const res = await db.execute({
      sql: `SELECT ${COLUMNS} FROM games g
            WHERE g.alive = 1 AND g.superseded_by IS NULL AND g.tag_count > 0
              AND (?1 = 0 OR g.is_multiplayer = 1)
              AND g.appid NOT IN (SELECT value FROM json_each(?2))
            ORDER BY g.reviews_total DESC LIMIT ?3 OFFSET ?4`,
      args: [args.mpOnly, args.banned, args.limit, offset],
    })
    return (res.rows as unknown as PoolRow[]).map(rowToMeta)
  }

  const rows = await page(args.offset)
  // Окно ротации уехало за конец каталога — возвращаемся к началу. На проде с
  // сотней тысяч игр этого не случается никогда, а на свежей или локальной
  // базе именно так «попробуй новое» молча превращалось в пустоту: смещение
  // считается от номера недели и легко оказывается больше всего каталога.
  return rows.length || !args.offset ? rows : page(0)
}

export async function fetchDiscoveryPool(db: Db, q: DiscoveryQuery): Promise<GameMeta[]> {
  const perTag = q.perTag ?? DEFAULT_PER_TAG
  const limit = q.limit ?? DEFAULT_LIMIT
  const offset = (q.rotation ?? 0) * perTag
  const mpOnly = q.requireMultiplayer ? 1 : 0
  const banned = JSON.stringify(q.bannedAppids ?? [])

  // Холодный старт: профиля ещё нет, показываем заметное
  if (!q.tags.length) return fetchNotable(db, { limit, offset, mpOnly, banned })

  // По ветке на тег: LIMIT обязан быть внутри подзапроса, иначе в SQLite он
  // применится ко всему объединению и срежет хвост последних тегов
  const branches = q.tags
    .map(
      () =>
        `SELECT appid, weight FROM (SELECT appid, weight FROM game_tags
           WHERE tag = ? ORDER BY weight DESC LIMIT ? OFFSET ?)`,
    )
    .join(' UNION ALL ')

  const args: Array<string | number> = []
  for (const tag of q.tags) args.push(tag, perTag, offset)
  args.push(mpOnly, banned, limit)

  const res = await db.execute({
    sql: `WITH pool AS (${branches}),
               best AS (SELECT appid, MAX(weight) AS w FROM pool GROUP BY appid)
          SELECT ${COLUMNS} FROM best b JOIN games g ON g.appid = b.appid
          WHERE (? = 0 OR g.is_multiplayer = 1)
            AND g.appid NOT IN (SELECT value FROM json_each(?))
          ORDER BY b.w DESC LIMIT ?`,
    args,
  })
  const byTaste = (res.rows as unknown as PoolRow[]).map(rowToMeta)
  if (!q.wildcard) return byTaste

  // Добор вне вкуса. Идёт ПОСЛЕ основного пула и без обрезки по limit: это
  // не «ещё немного похожего», а единственная дверь наружу из своих же тегов,
  // и срезать её вместе с хвостом ранжирования значило бы не добавить ничего.
  const seen = new Set(byTaste.map((m) => m.appid))
  const notable = await fetchNotable(db, {
    limit: q.wildcard,
    offset: (q.rotation ?? 0) * q.wildcard,
    mpOnly,
    banned,
  })
  return [...byTaste, ...notable.filter((m) => !seen.has(m.appid))]
}
