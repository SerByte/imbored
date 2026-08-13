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
}

const DEFAULT_PER_TAG = 60
const DEFAULT_LIMIT = 400
/** Тег, который есть у слишком большой доли каталога, о вкусе не говорит ничего */
const STOP_TAG_SHARE = 0.15
const DEFAULT_TAG_COUNT = 12

const COLUMNS = `g.appid, g.name, g.tags_json, g.genres_json, g.categories_json,
  g.short_description, g.header_image, g.art_json, g.is_free, g.price_final,
  g.release_date, g.median_forever, g.store, g.store_url, g.reviews_total`

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
  release_date: string | null
  median_forever: number | null
  store: string | null
  store_url: string | null
  reviews_total: number | null
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
  if (row.release_date) meta.releaseDate = row.release_date
  if (row.median_forever !== null) meta.medianForever = row.median_forever
  if (row.store) meta.store = row.store
  if (row.store_url) meta.storeUrl = row.store_url
  if (row.reviews_total !== null) meta.reviewsTotal = row.reviews_total
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

export async function fetchDiscoveryPool(db: Db, q: DiscoveryQuery): Promise<GameMeta[]> {
  const perTag = q.perTag ?? DEFAULT_PER_TAG
  const limit = q.limit ?? DEFAULT_LIMIT
  const offset = (q.rotation ?? 0) * perTag
  const mpOnly = q.requireMultiplayer ? 1 : 0
  const banned = JSON.stringify(q.bannedAppids ?? [])

  // Холодный старт: профиля ещё нет, показываем заметное. Идёт по частичному
  // индексу, поэтому тоже без полного скана.
  if (!q.tags.length) {
    const res = await db.execute({
      sql: `SELECT ${COLUMNS} FROM games g
            WHERE g.alive = 1 AND g.superseded_by IS NULL AND g.tag_count > 0
              AND (?1 = 0 OR g.is_multiplayer = 1)
              AND g.appid NOT IN (SELECT value FROM json_each(?2))
            ORDER BY g.reviews_total DESC LIMIT ?3 OFFSET ?4`,
      args: [mpOnly, banned, limit, offset],
    })
    return (res.rows as unknown as PoolRow[]).map(rowToMeta)
  }

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
  return (res.rows as unknown as PoolRow[]).map(rowToMeta)
}
