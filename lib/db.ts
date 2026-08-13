import { createClient, type Client } from '@libsql/client'
import type { GameMeta, LibraryGame, Mood } from './types'

/** Соединение с БД: локальный файл в dev, Turso в проде — API одинаковый */
export type Db = Client

export type FeedbackAction = 'liked' | 'skipped' | 'opened' | 'banned'

export type SkipReason = 'genre' | 'hard' | 'tired' | 'notnow'

export type FeedbackRow = {
  steamid: string
  appid: number
  action: FeedbackAction
  reason?: SkipReason
  mood?: Mood
  createdAt: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  steamid TEXT PRIMARY KEY,
  persona_name TEXT,
  avatar_url TEXT,
  portrait_json TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS library_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  steamid TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  games_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_steamid ON library_snapshots (steamid, taken_at DESC);
CREATE TABLE IF NOT EXISTS games (
  appid INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '{}',
  genres_json TEXT NOT NULL DEFAULT '[]',
  categories_json TEXT NOT NULL DEFAULT '[]',
  short_description TEXT,
  header_image TEXT,
  screenshots_json TEXT,
  is_free INTEGER,
  price_final INTEGER,
  release_date TEXT,
  median_forever INTEGER,
  store TEXT,
  store_url TEXT,
  reviews_summary_json TEXT,
  pros_cons_json TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  steamid TEXT NOT NULL,
  appid INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('liked','skipped','opened','banned')),
  reason TEXT,
  mood_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_steamid ON feedback (steamid, created_at DESC);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  mood_json TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  matched_appid INTEGER,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL,
  steamid TEXT NOT NULL,
  persona_name TEXT,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, steamid)
);
CREATE TABLE IF NOT EXISTS room_votes (
  room_id TEXT NOT NULL,
  steamid TEXT NOT NULL,
  appid INTEGER NOT NULL,
  vote INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, steamid, appid)
);
`

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(',')
}

export async function createDb(url: string, authToken?: string): Promise<Db> {
  const client = createClient({ url, ...(authToken ? { authToken } : {}) })
  return migrateDb(client)
}

/** Схема и миграции; идемпотентно, безопасно вызывать на каждом старте */
export async function migrateDb(db: Db): Promise<Db> {
  await db.executeMultiple(SCHEMA)

  // колонки, добавленные после первых версий схемы
  for (const [table, col] of [
    ['games', 'store TEXT'],
    ['games', 'store_url TEXT'],
    ['games', 'art_json TEXT'],
    ['feedback', 'reason TEXT'],
    ['rooms', 'is_public INTEGER NOT NULL DEFAULT 0'],
    ['users', 'portrait_json TEXT'],
  ] as const) {
    try {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${col}`)
    } catch {
      // колонка уже есть
    }
  }

  // старый CHECK у feedback не пускал action='banned' — пересобираем таблицу
  const info = await db.execute(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='feedback'",
  )
  const createSql = info.rows[0]?.sql as string | undefined
  if (createSql?.includes('CHECK') && !createSql.includes('banned')) {
    await db.batch(
      [
        `CREATE TABLE feedback_new (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           steamid TEXT NOT NULL,
           appid INTEGER NOT NULL,
           action TEXT NOT NULL CHECK (action IN ('liked','skipped','opened','banned')),
           reason TEXT,
           mood_json TEXT,
           created_at INTEGER NOT NULL
         )`,
        `INSERT INTO feedback_new (id, steamid, appid, action, reason, mood_json, created_at)
           SELECT id, steamid, appid, action, reason, mood_json, created_at FROM feedback`,
        'DROP TABLE feedback',
        'ALTER TABLE feedback_new RENAME TO feedback',
        'CREATE INDEX IF NOT EXISTS idx_feedback_steamid ON feedback (steamid, created_at DESC)',
      ],
      'write',
    )
  }

  return db
}

/* ---------- пользователи ---------- */

export async function upsertUser(
  db: Db,
  user: { steamid: string; personaName?: string; avatarUrl?: string },
  nowSec: number,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO users (steamid, persona_name, avatar_url, created_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(steamid) DO UPDATE SET
            persona_name = excluded.persona_name,
            avatar_url = excluded.avatar_url,
            last_seen_at = excluded.last_seen_at`,
    args: [user.steamid, user.personaName ?? null, user.avatarUrl ?? null, nowSec, nowSec],
  })
}

export async function getPersonaName(db: Db, steamid: string): Promise<string | null> {
  const res = await db.execute({
    sql: 'SELECT persona_name FROM users WHERE steamid = ?',
    args: [steamid],
  })
  return (res.rows[0]?.persona_name as string | null) ?? null
}

export type PortraitCache = { takenAt: number; text: string }

export async function setUserPortrait(
  db: Db,
  steamid: string,
  value: PortraitCache,
): Promise<void> {
  await db.execute({
    sql: 'UPDATE users SET portrait_json = ? WHERE steamid = ?',
    args: [JSON.stringify(value), steamid],
  })
}

export async function getUserPortrait(db: Db, steamid: string): Promise<PortraitCache | null> {
  const res = await db.execute({
    sql: 'SELECT portrait_json AS v FROM users WHERE steamid = ?',
    args: [steamid],
  })
  const v = res.rows[0]?.v as string | null | undefined
  return v ? (JSON.parse(v) as PortraitCache) : null
}

/* ---------- комнаты (групповой режим) ---------- */

export type Room = {
  id: string
  createdBy: string
  mood?: Mood
  status: 'open' | 'matched'
  matchedAppid?: number
  isPublic: boolean
  createdAt: number
}

export type RoomMember = { steamid: string; personaName?: string; joinedAt: number }

export async function createRoom(
  db: Db,
  room: { id: string; steamid: string; mood?: Mood },
  nowSec: number,
): Promise<void> {
  await db.execute({
    sql: 'INSERT INTO rooms (id, created_by, mood_json, status, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [room.id, room.steamid, room.mood ? JSON.stringify(room.mood) : null, 'open', nowSec],
  })
}

export async function getRoom(db: Db, id: string): Promise<Room | null> {
  const res = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [id] })
  const row = res.rows[0] as unknown as
    | {
        id: string
        created_by: string
        mood_json: string | null
        status: 'open' | 'matched'
        matched_appid: number | null
        is_public: number
        created_at: number
      }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    createdBy: row.created_by,
    ...(row.mood_json ? { mood: JSON.parse(row.mood_json) as Mood } : {}),
    status: row.status,
    ...(row.matched_appid !== null ? { matchedAppid: row.matched_appid } : {}),
    isPublic: row.is_public === 1,
    createdAt: row.created_at,
  }
}

export async function joinRoom(
  db: Db,
  roomId: string,
  steamid: string,
  personaName: string | undefined,
  nowSec: number,
): Promise<boolean> {
  if (!(await getRoom(db, roomId))) return false
  await db.execute({
    sql: 'INSERT OR REPLACE INTO room_members (room_id, steamid, persona_name, joined_at) VALUES (?, ?, ?, ?)',
    args: [roomId, steamid, personaName ?? null, nowSec],
  })
  return true
}

export async function roomMembers(db: Db, roomId: string): Promise<RoomMember[]> {
  const res = await db.execute({
    sql: 'SELECT steamid, persona_name, joined_at FROM room_members WHERE room_id = ? ORDER BY joined_at ASC',
    args: [roomId],
  })
  return (
    res.rows as unknown as Array<{
      steamid: string
      persona_name: string | null
      joined_at: number
    }>
  ).map((r) => ({
    steamid: r.steamid,
    ...(r.persona_name ? { personaName: r.persona_name } : {}),
    joinedAt: r.joined_at,
  }))
}

export async function castRoomVote(
  db: Db,
  roomId: string,
  steamid: string,
  appid: number,
  vote: 0 | 1,
  nowSec: number,
): Promise<void> {
  await db.execute({
    sql: 'INSERT OR REPLACE INTO room_votes (room_id, steamid, appid, vote, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [roomId, steamid, appid, vote, nowSec],
  })
}

/** appid, за который проголосовали «да» ВСЕ участники, либо null */
export async function findRoomMatch(db: Db, roomId: string): Promise<number | null> {
  const res = await db.execute({
    sql: `SELECT v.appid AS appid FROM room_votes v
          WHERE v.room_id = ? AND v.vote = 1
          GROUP BY v.appid
          HAVING COUNT(DISTINCT v.steamid) >= (
            SELECT COUNT(*) FROM room_members WHERE room_id = ?
          )
          ORDER BY MAX(v.created_at) ASC
          LIMIT 1`,
    args: [roomId, roomId],
  })
  return (res.rows[0]?.appid as number | undefined) ?? null
}

export async function setRoomMatched(db: Db, roomId: string, appid: number): Promise<void> {
  await db.execute({
    sql: "UPDATE rooms SET status = 'matched', matched_appid = ? WHERE id = ?",
    args: [appid, roomId],
  })
}

export async function myVotedAppids(
  db: Db,
  roomId: string,
  steamid: string,
): Promise<Set<number>> {
  const res = await db.execute({
    sql: 'SELECT appid FROM room_votes WHERE room_id = ? AND steamid = ?',
    args: [roomId, steamid],
  })
  return new Set((res.rows as unknown as Array<{ appid: number }>).map((r) => r.appid))
}

export async function setRoomPublic(db: Db, roomId: string, isPublic: boolean): Promise<void> {
  await db.execute({
    sql: 'UPDATE rooms SET is_public = ? WHERE id = ?',
    args: [isPublic ? 1 : 0, roomId],
  })
}

export type PublicRoomListing = {
  id: string
  createdAt: number
  memberNames: string[]
}

const PUBLIC_ROOM_MAX_AGE_SEC = 86_400
const PUBLIC_ROOM_LIMIT = 20

/** Доска «ищут игроков»: открытые публичные комнаты за последние сутки (один запрос) */
export async function listPublicRooms(db: Db, nowSec: number): Promise<PublicRoomListing[]> {
  const res = await db.execute({
    sql: `SELECT r.id AS id, r.created_at AS created_at, m.steamid AS steamid, m.persona_name AS persona_name
          FROM rooms r
          LEFT JOIN room_members m ON m.room_id = r.id
          WHERE r.is_public = 1 AND r.status = 'open' AND r.created_at > ?
          ORDER BY r.created_at DESC, m.joined_at ASC`,
    args: [nowSec - PUBLIC_ROOM_MAX_AGE_SEC],
  })

  const byRoom = new Map<string, PublicRoomListing>()
  for (const raw of res.rows as unknown as Array<{
    id: string
    created_at: number
    steamid: string | null
    persona_name: string | null
  }>) {
    let room = byRoom.get(raw.id)
    if (!room) {
      if (byRoom.size >= PUBLIC_ROOM_LIMIT) continue
      room = { id: raw.id, createdAt: raw.created_at, memberNames: [] }
      byRoom.set(raw.id, room)
    }
    if (raw.steamid) {
      room.memberNames.push(raw.persona_name ?? `Игрок ${raw.steamid.slice(-4)}`)
    }
  }
  return [...byRoom.values()]
}

/* ---------- библиотеки ---------- */

const SNAPSHOTS_KEPT = 3

export async function saveLibrarySnapshot(
  db: Db,
  steamid: string,
  games: LibraryGame[],
  nowSec: number,
): Promise<void> {
  await db.batch(
    [
      {
        sql: 'INSERT INTO library_snapshots (steamid, taken_at, games_json) VALUES (?, ?, ?)',
        args: [steamid, nowSec, JSON.stringify(games)],
      },
      {
        sql: `DELETE FROM library_snapshots WHERE steamid = ? AND id NOT IN (
                SELECT id FROM library_snapshots WHERE steamid = ?
                ORDER BY taken_at DESC, id DESC LIMIT ${SNAPSHOTS_KEPT}
              )`,
        args: [steamid, steamid],
      },
    ],
    'write',
  )
}

export async function getLatestSnapshot(
  db: Db,
  steamid: string,
): Promise<{ takenAt: number; games: LibraryGame[] } | null> {
  const res = await db.execute({
    sql: 'SELECT taken_at, games_json FROM library_snapshots WHERE steamid = ? ORDER BY taken_at DESC, id DESC LIMIT 1',
    args: [steamid],
  })
  const row = res.rows[0] as unknown as { taken_at: number; games_json: string } | undefined
  if (!row) return null
  return { takenAt: row.taken_at, games: JSON.parse(row.games_json) as LibraryGame[] }
}

/* ---------- каталог игр ---------- */

export async function upsertGameMeta(db: Db, meta: GameMeta, nowSec: number): Promise<void> {
  await db.execute({
    sql: `INSERT INTO games (appid, name, tags_json, genres_json, categories_json, short_description,
            header_image, screenshots_json, is_free, price_final, release_date, median_forever,
            store, store_url, art_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(appid) DO UPDATE SET
            name = excluded.name,
            tags_json = excluded.tags_json,
            genres_json = excluded.genres_json,
            categories_json = excluded.categories_json,
            short_description = excluded.short_description,
            header_image = excluded.header_image,
            screenshots_json = excluded.screenshots_json,
            is_free = excluded.is_free,
            price_final = excluded.price_final,
            release_date = excluded.release_date,
            median_forever = excluded.median_forever,
            store = excluded.store,
            store_url = excluded.store_url,
            art_json = excluded.art_json,
            updated_at = excluded.updated_at`,
    args: [
      meta.appid,
      meta.name,
      JSON.stringify(meta.tags),
      JSON.stringify(meta.genres),
      JSON.stringify(meta.categories),
      meta.shortDescription ?? null,
      meta.headerImage ?? null,
      meta.screenshots ? JSON.stringify(meta.screenshots) : null,
      meta.isFree === undefined ? null : meta.isFree ? 1 : 0,
      meta.priceFinal ?? null,
      meta.releaseDate ?? null,
      meta.medianForever ?? null,
      meta.store ?? null,
      meta.storeUrl ?? null,
      // Пустой объект — это «арт искали и не нашли», и он отличается от NULL,
      // то есть «ещё не искали». Иначе такие игры перезапрашивались бы вечно.
      meta.art ? JSON.stringify(meta.art) : null,
      nowSec,
    ],
  })
}

type GameRow = {
  appid: number
  name: string
  tags_json: string
  genres_json: string
  categories_json: string
  short_description: string | null
  header_image: string | null
  screenshots_json: string | null
  is_free: number | null
  price_final: number | null
  release_date: string | null
  median_forever: number | null
  store: string | null
  store_url: string | null
  art_json: string | null
}

function rowToMeta(row: GameRow): GameMeta {
  const meta: GameMeta = {
    appid: row.appid,
    name: row.name,
    tags: JSON.parse(row.tags_json),
    genres: JSON.parse(row.genres_json),
    categories: JSON.parse(row.categories_json),
  }
  if (row.short_description !== null) meta.shortDescription = row.short_description
  if (row.header_image !== null) meta.headerImage = row.header_image
  if (row.screenshots_json !== null) meta.screenshots = JSON.parse(row.screenshots_json)
  if (row.is_free !== null) meta.isFree = row.is_free === 1
  if (row.price_final !== null) meta.priceFinal = row.price_final
  if (row.release_date !== null) meta.releaseDate = row.release_date
  if (row.median_forever !== null) meta.medianForever = row.median_forever
  if (row.store !== null) meta.store = row.store
  if (row.store_url !== null) meta.storeUrl = row.store_url
  // колонка появилась позже: у старых строк её может не быть вовсе
  if (row.art_json) meta.art = JSON.parse(row.art_json)
  return meta
}

export async function getGameMeta(db: Db, appid: number): Promise<GameMeta | null> {
  const res = await db.execute({ sql: 'SELECT * FROM games WHERE appid = ?', args: [appid] })
  const row = res.rows[0] as unknown as GameRow | undefined
  return row ? rowToMeta(row) : null
}

/** Метаданные пачки игр одним запросом */
export async function getGamesMeta(db: Db, appids: number[]): Promise<Map<number, GameMeta>> {
  if (!appids.length) return new Map()
  const res = await db.execute({
    sql: `SELECT * FROM games WHERE appid IN (${placeholders(appids.length)})`,
    args: appids,
  })
  return new Map(
    (res.rows as unknown as GameRow[]).map((r) => [r.appid, rowToMeta(r)] as const),
  )
}

/** Весь каталог одним запросом — для скоринга рекомендаций */
export async function getAllGamesMeta(db: Db): Promise<Map<number, GameMeta>> {
  const res = await db.execute('SELECT * FROM games')
  return new Map(
    (res.rows as unknown as GameRow[]).map((r) => [r.appid, rowToMeta(r)] as const),
  )
}

export type GameJsonColumn = 'reviews_summary_json' | 'pros_cons_json'

// имя колонки интерполируется в SQL — рантайм-контроль обязателен
const GAME_JSON_COLUMNS: ReadonlySet<string> = new Set(['reviews_summary_json', 'pros_cons_json'])

function assertGameJsonColumn(column: string): void {
  if (!GAME_JSON_COLUMNS.has(column)) throw new Error(`недопустимая колонка: ${column}`)
}

export async function setGameJson(
  db: Db,
  appid: number,
  column: GameJsonColumn,
  value: unknown,
): Promise<void> {
  assertGameJsonColumn(column)
  await db.execute({
    sql: `UPDATE games SET ${column} = ? WHERE appid = ?`,
    args: [JSON.stringify(value), appid],
  })
}

export async function getGameJson(
  db: Db,
  appid: number,
  column: GameJsonColumn,
): Promise<unknown> {
  assertGameJsonColumn(column)
  const res = await db.execute({
    sql: `SELECT ${column} AS v FROM games WHERE appid = ?`,
    args: [appid],
  })
  const v = res.rows[0]?.v as string | null | undefined
  return v ? JSON.parse(v) : null
}

/** appid'ы, которых нет в кэше или чьи метаданные старше maxAgeSec (один запрос) */
export async function getStaleAppids(
  db: Db,
  appids: number[],
  maxAgeSec: number,
  nowSec: number,
): Promise<number[]> {
  if (!appids.length) return []
  const res = await db.execute({
    sql: `SELECT appid, updated_at, art_json FROM games WHERE appid IN (${placeholders(appids.length)})`,
    args: appids,
  })
  const fresh = new Set<number>()
  for (const r of res.rows as unknown as Array<{
    appid: number
    updated_at: number
    art_json: string | null
  }>) {
    // Строка без резолвленного арта считается протухшей независимо от возраста:
    // иначе игры, прогретые до появления art_json, остались бы с одной мелкой
    // обложкой до истечения TTL
    if (nowSec - r.updated_at <= maxAgeSec && r.art_json) fresh.add(r.appid)
  }
  return appids.filter((appid) => !fresh.has(appid))
}

/* ---------- фидбек ---------- */

export async function logFeedback(
  db: Db,
  entry: {
    steamid: string
    appid: number
    action: FeedbackAction
    reason?: SkipReason
    mood?: Mood
  },
  nowSec: number,
): Promise<void> {
  await db.execute({
    sql: 'INSERT INTO feedback (steamid, appid, action, reason, mood_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [
      entry.steamid,
      entry.appid,
      entry.action,
      entry.reason ?? null,
      entry.mood ? JSON.stringify(entry.mood) : null,
      nowSec,
    ],
  })
}

export async function listFeedback(db: Db, steamid: string, limit = 500): Promise<FeedbackRow[]> {
  const res = await db.execute({
    sql: `SELECT steamid, appid, action, reason, mood_json, created_at FROM feedback
          WHERE steamid = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    args: [steamid, limit],
  })
  return (
    res.rows as unknown as Array<{
      steamid: string
      appid: number
      action: FeedbackAction
      reason: SkipReason | null
      mood_json: string | null
      created_at: number
    }>
  ).map((r) => ({
    steamid: r.steamid,
    appid: r.appid,
    action: r.action,
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.mood_json ? { mood: JSON.parse(r.mood_json) as Mood } : {}),
    createdAt: r.created_at,
  }))
}

/** Доля «зашло» среди оценённых показов (liked против skipped) */
export async function feedbackStats(
  db: Db,
  steamid: string,
): Promise<{ liked: number; skipped: number; rate: number | null }> {
  const res = await db.execute({
    sql: `SELECT
            SUM(CASE WHEN action = 'liked' THEN 1 ELSE 0 END) AS liked,
            SUM(CASE WHEN action = 'skipped' THEN 1 ELSE 0 END) AS skipped
          FROM feedback WHERE steamid = ?`,
    args: [steamid],
  })
  const row = res.rows[0] as unknown as { liked: number | null; skipped: number | null } | undefined
  const liked = Number(row?.liked ?? 0)
  const skipped = Number(row?.skipped ?? 0)
  const total = liked + skipped
  return { liked, skipped, rate: total > 0 ? liked / total : null }
}

export async function bannedAppids(db: Db, steamid: string): Promise<Set<number>> {
  const res = await db.execute({
    sql: "SELECT DISTINCT appid FROM feedback WHERE steamid = ? AND action = 'banned'",
    args: [steamid],
  })
  return new Set((res.rows as unknown as Array<{ appid: number }>).map((r) => r.appid))
}
