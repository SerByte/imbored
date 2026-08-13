import { createClient, type Client } from '@libsql/client'
import type { NewsBlock } from './steamhtml'
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

/**
 * Схема каталога. Отделена от SCHEMA, потому что часть её объектов ссылается
 * на колонки, добавляемые ALTER-циклом, и создаваться должна строго после него.
 *
 * Ключевое разделение: catalog_ingest — карта территории (все игры Steam,
 * ~170 тысяч), games — только то, что реально показываем. Полный каталог
 * в games не влезает по бюджету прочитанных строк Turso.
 */
const SCHEMA_CATALOG = `
CREATE TABLE IF NOT EXISTS catalog_ingest (
  appid INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  tagids_json TEXT NOT NULL DEFAULT '[]',
  release_year INTEGER,
  reviews_total INTEGER,
  reviews_percent INTEGER,
  price_final INTEGER,
  status TEXT NOT NULL DEFAULT 'seen',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ingest_rank ON catalog_ingest (reviews_total DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_status ON catalog_ingest (status, reviews_total DESC);

CREATE TABLE IF NOT EXISTS tags (
  tagid INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  game_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_tags (
  appid INTEGER NOT NULL,
  tag TEXT NOT NULL,
  weight INTEGER NOT NULL,
  PRIMARY KEY (appid, tag)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_game_tags_tag ON game_tags (tag, weight DESC);

CREATE TABLE IF NOT EXISTS catalog_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_pool ON games (reviews_total DESC)
  WHERE alive = 1 AND superseded_by IS NULL AND tag_count > 0;

-- набор игр для опроса новостей по живому онлайну
CREATE INDEX IF NOT EXISTS idx_games_ccu ON games (ccu DESC)
  WHERE alive = 1 AND superseded_by IS NULL AND tag_count > 0;
`

/**
 * Патчноуты игр и очередь их опроса.
 *
 * Отдельные таблицы, а не колонки на games — по трём причинам:
 *   • лента «Что нового» сортируется по дате ПОПЕРЁК игр, а из пер-геймовых
 *     блобов такой запрос собирается только полным сканом games (см. noscan);
 *   • в очередь надо ставить игры из библиотеки пользователя, а строки в games
 *     для них может ещё не быть — ensureMeta доходит не до всех;
 *   • ноль новых колонок на games означает, что upsertGameMeta трогать не надо
 *     вовсе: там ON CONFLICT DO UPDATE SET с перечислением колонок, и всё, чего
 *     в списке нет, и так не переписывается.
 *
 * Ни на одну колонку из ALTER-цикла эти объекты не ссылаются, поэтому схема
 * применяется сразу после SCHEMA, до ALTER-цикла.
 */
const SCHEMA_NEWS = `
CREATE TABLE IF NOT EXISTS news_items (
  appid INTEGER NOT NULL,
  gid TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'news',
  scale TEXT,
  blocks_json TEXT NOT NULL DEFAULT '[]',
  body_hash TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  rank INTEGER NOT NULL DEFAULT 0,
  tldr TEXT,
  tldr_at INTEGER,
  tldr_tries INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (appid, gid)
);
CREATE INDEX IF NOT EXISTS idx_news_app ON news_items (appid, published_at DESC);

-- общая лента: только крупные патчи игр из каталога (rank > 0), а не всё подряд
CREATE INDEX IF NOT EXISTS idx_news_feed ON news_items (published_at DESC)
  WHERE kind = 'patch' AND scale = 'major' AND rank > 0;

-- Очередь на пересказ. Мелочь, которой эвристика уже проставила hotfix
-- (обновления карт из мастерской и подобное), до модели не доезжает вовсе —
-- пересказывать там нечего. Всё остальное идёт за пересказом и уточнением
-- масштаба. tldr_tries отсекает вечно падающие записи.
CREATE INDEX IF NOT EXISTS idx_news_tldr ON news_items (published_at DESC)
  WHERE kind = 'patch' AND tldr IS NULL AND tldr_tries < 3 AND scale IS NOT 'hotfix';

CREATE TABLE IF NOT EXISTS news_poll (
  appid INTEGER PRIMARY KEY,
  tier INTEGER NOT NULL DEFAULT 1,
  next_at INTEGER NOT NULL,
  last_at INTEGER,
  last_pub_at INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  enrolled_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_poll_due ON news_poll (next_at) WHERE status != 'gone';
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

  // новостные таблицы самодостаточны и на ALTER-колонки не ссылаются
  await db.executeMultiple(SCHEMA_NEWS)

  // колонки, добавленные после первых версий схемы
  for (const [table, col] of [
    ['games', 'store TEXT'],
    ['games', 'store_url TEXT'],
    ['games', 'art_json TEXT'],
    ['feedback', 'reason TEXT'],
    ['rooms', 'is_public INTEGER NOT NULL DEFAULT 0'],
    ['users', 'portrait_json TEXT'],
    // сигналы актуальности и производные поля для выборки без полного скана
    ['games', 'release_year INTEGER'],
    ['games', 'developer TEXT'],
    ['games', 'publisher TEXT'],
    ['games', 'reviews_total INTEGER'],
    ['games', 'reviews_percent INTEGER'],
    ['games', 'reviews_30d INTEGER'],
    ['games', 'ccu INTEGER'],
    ['games', 'ccu_at INTEGER'],
    ['games', 'signals_at INTEGER'],
    ['games', 'tag_count INTEGER NOT NULL DEFAULT 0'],
    ['games', 'is_multiplayer INTEGER NOT NULL DEFAULT 0'],
    ['games', 'alive INTEGER NOT NULL DEFAULT 1'],
    ['games', 'dead_reason TEXT'],
    ['games', 'superseded_by INTEGER'],
  ] as const) {
    try {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${col}`)
    } catch {
      // колонка уже есть
    }
  }

  // строго после ALTER-цикла: частичный индекс ссылается на новые колонки
  await db.executeMultiple(SCHEMA_CATALOG)

  // Разовый бэкфилл производных колонок для строк, записанных до их появления.
  // Без него холодный старт выборки кандидатов не увидит ни одной игры:
  // условие tag_count > 0 не выполнится ни для кого.
  await db.execute(`UPDATE games SET tag_count = (
      SELECT COUNT(*) FROM json_each(games.tags_json)
    ) WHERE tag_count = 0 AND tags_json != '{}'`)
  await db.execute(`UPDATE games SET is_multiplayer = 1
    WHERE is_multiplayer = 0 AND EXISTS (
      SELECT 1 FROM json_each(games.categories_json) WHERE value IN (1,9,24,36,38,39,49)
    )`)

  // Разовая починка веса у уже записанных патчей. До неё вес считался по числу
  // отзывов для любой опрошенной игры, и в общую ленту налезли Half-Life 2:
  // Deathmatch с Condition Zero — те самые, что каталог метит alive = 0.
  // Флаг в catalog_meta, потому что иначе это скан news_items на каждом
  // холодном старте, а Turso считает прочитанные строки.
  const rankFixed = await db.execute({
    sql: 'SELECT value FROM catalog_meta WHERE key = ?',
    args: ['news_rank_fixed'],
  })
  if (!rankFixed.rows.length) {
    await db.execute(`UPDATE news_items SET rank = 0
      WHERE rank > 0 AND NOT EXISTS (
        SELECT 1 FROM games g WHERE g.appid = news_items.appid
          AND g.alive = 1 AND g.superseded_by IS NULL AND g.tag_count > 0
      )`)
    await db.execute({
      sql: 'INSERT OR REPLACE INTO catalog_meta (key, value) VALUES (?, ?)',
      args: ['news_rank_fixed', '1'],
    })
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
  // UPSERT, а не UPDATE: без строки в users запись молча терялась, кэш не
  // сохранялся и Claude дёргался заново на каждый рендер публичной страницы
  const now = Math.floor(Date.now() / 1000)
  await db.execute({
    sql: `INSERT INTO users (steamid, portrait_json, created_at, last_seen_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(steamid) DO UPDATE SET portrait_json = excluded.portrait_json`,
    args: [steamid, JSON.stringify(value), now, now],
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
    // Матч — это договорённость, поэтому участников должно быть минимум двое.
    // Без этого условия человек в комнате один получал «Это матч!» от
    // собственного голоса: «проголосовали все» формально выполнялось.
    sql: `SELECT v.appid AS appid FROM room_votes v
          WHERE v.room_id = ? AND v.vote = 1
            AND (SELECT COUNT(*) FROM room_members WHERE room_id = ?) >= 2
          GROUP BY v.appid
          HAVING COUNT(DISTINCT v.steamid) >= (
            SELECT COUNT(*) FROM room_members WHERE room_id = ?
          )
          ORDER BY MAX(v.created_at) ASC
          LIMIT 1`,
    args: [roomId, roomId, roomId],
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

  // Игры библиотеки — в очередь опроса новостей (tier 0, самый частый).
  // Именно отсюда наполняется личная лента «Что нового», и делать это надо
  // здесь: строки в games для части библиотеки может ещё не быть, а appid уже
  // в руках — ни одного лишнего чтения.
  await enrollNewsPoll(
    db,
    [...games].sort((a, b) => b.playtimeForever - a.playtimeForever).map((g) => g.appid),
    0,
    nowSec,
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
            store, store_url, art_json,
            release_year, developer, publisher, reviews_total, reviews_percent, reviews_30d,
            ccu, ccu_at, tag_count, is_multiplayer, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            release_year = excluded.release_year,
            developer = excluded.developer,
            publisher = excluded.publisher,
            reviews_total = excluded.reviews_total,
            reviews_percent = excluded.reviews_percent,
            -- Сигналы актуальности приходят отдельным проходом, поэтому
            -- обычная запись метаданных не должна их обнулять
            reviews_30d = COALESCE(excluded.reviews_30d, games.reviews_30d),
            ccu = COALESCE(excluded.ccu, games.ccu),
            ccu_at = COALESCE(excluded.ccu_at, games.ccu_at),
            tag_count = excluded.tag_count,
            is_multiplayer = excluded.is_multiplayer,
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
      meta.releaseYear ?? null,
      meta.developer ?? null,
      meta.publisher ?? null,
      meta.reviewsTotal ?? null,
      meta.reviewsPercent ?? null,
      meta.reviews30d ?? null,
      meta.ccu ?? null,
      meta.ccuAt ?? null,
      // производные: по ним идёт выборка кандидатов, чтобы не парсить JSON в SQL
      Object.keys(meta.tags).length,
      isMultiplayerCategories(meta.categories) ? 1 : 0,
      nowSec,
    ],
  })
}

/**
 * Категории Steam, означающие совместную игру: 1 Multi-player, 9 Co-op,
 * 24 Shared/Split Screen, 36 Online PvP, 38 Online Co-op, 39 Split Screen PvP, 49 PvP.
 * Дублирует isMultiplayerMeta из lib/recommend, но без импорта: db не должна
 * зависеть от движка рекомендаций. Эквивалентность закреплена тестом.
 */
const MULTIPLAYER_CATEGORY_IDS = new Set([1, 9, 24, 36, 38, 39, 49])

export function isMultiplayerCategories(categories: number[]): boolean {
  return categories.some((c) => MULTIPLAYER_CATEGORY_IDS.has(c))
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
  ccu: number | null
  ccu_at: number | null
  reviews_30d: number | null
  reviews_total: number | null
  reviews_percent: number | null
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
  // сигналы актуальности: без них фильтр живости работает вслепую
  if (row.ccu !== null && row.ccu !== undefined) meta.ccu = row.ccu
  if (row.ccu_at !== null && row.ccu_at !== undefined) meta.ccuAt = row.ccu_at
  if (row.reviews_30d !== null && row.reviews_30d !== undefined) meta.reviews30d = row.reviews_30d
  if (row.reviews_total !== null && row.reviews_total !== undefined) {
    meta.reviewsTotal = row.reviews_total
  }
  if (row.reviews_percent !== null && row.reviews_percent !== undefined) {
    meta.reviewsPercent = row.reviews_percent
  }
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

/*
 * Здесь была getAllGamesMeta — «весь каталог одним запросом». Удалена намеренно,
 * а не помечена устаревшей: на каталоге в сотню тысяч игр это полный скан на
 * каждый запрос пользователя, и оставленная функция вернулась бы в код при
 * первом же рефакторинге. Вместо неё — getGamesMeta по списку appid для
 * библиотечных сценариев и fetchDiscoveryPool из lib/pool для открытий.
 * Возврат полного скана ловит тест lib/noscan.test.ts.
 */

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

/* ---------- большой каталог ---------- */

export type IngestRow = {
  appid: number
  name: string
  tagids: number[]
  releaseYear?: number
  reviewsTotal?: number
  reviewsPercent?: number
  priceFinal?: number
}

/** Карта территории: все игры Steam. Батчами, чтобы не упереться в лимиты. */
export async function upsertIngestRows(db: Db, rows: IngestRow[], nowSec: number): Promise<void> {
  if (!rows.length) return
  const CHUNK = 250
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.batch(
      rows.slice(i, i + CHUNK).map((r) => ({
        sql: `INSERT INTO catalog_ingest
                (appid, name, tagids_json, release_year, reviews_total, reviews_percent, price_final, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(appid) DO UPDATE SET
                name = excluded.name,
                tagids_json = excluded.tagids_json,
                release_year = excluded.release_year,
                reviews_total = excluded.reviews_total,
                reviews_percent = excluded.reviews_percent,
                price_final = excluded.price_final,
                updated_at = excluded.updated_at
              WHERE catalog_ingest.name IS NOT excluded.name
                 OR catalog_ingest.tagids_json IS NOT excluded.tagids_json
                 OR catalog_ingest.reviews_total IS NOT excluded.reviews_total`,
        args: [
          r.appid,
          r.name,
          JSON.stringify(r.tagids),
          r.releaseYear ?? null,
          r.reviewsTotal ?? null,
          r.reviewsPercent ?? null,
          r.priceFinal ?? null,
          nowSec,
        ],
      })),
      'write',
    )
  }
}

/** Сколько игр в карте территории */
export async function countIngest(db: Db): Promise<number> {
  const res = await db.execute('SELECT COUNT(*) AS n FROM catalog_ingest')
  return Number(res.rows[0]?.n ?? 0)
}

/** Кандидаты на глубокую загрузку: самые обсуждаемые из ещё не обработанных */
export async function nextIngestBatch(
  db: Db,
  status: string,
  limit: number,
): Promise<IngestRow[]> {
  const res = await db.execute({
    sql: `SELECT appid, name, tagids_json, release_year, reviews_total, reviews_percent, price_final
          FROM catalog_ingest WHERE status = ? ORDER BY reviews_total DESC LIMIT ?`,
    args: [status, limit],
  })
  return (
    res.rows as unknown as Array<{
      appid: number
      name: string
      tagids_json: string
      release_year: number | null
      reviews_total: number | null
      reviews_percent: number | null
      price_final: number | null
    }>
  ).map((r) => ({
    appid: r.appid,
    name: r.name,
    tagids: JSON.parse(r.tagids_json) as number[],
    ...(r.release_year !== null ? { releaseYear: r.release_year } : {}),
    ...(r.reviews_total !== null ? { reviewsTotal: r.reviews_total } : {}),
    ...(r.reviews_percent !== null ? { reviewsPercent: r.reviews_percent } : {}),
    ...(r.price_final !== null ? { priceFinal: r.price_final } : {}),
  }))
}

export async function setIngestStatus(db: Db, appids: number[], status: string): Promise<void> {
  if (!appids.length) return
  const CHUNK = 500
  for (let i = 0; i < appids.length; i += CHUNK) {
    const part = appids.slice(i, i + CHUNK)
    await db.execute({
      sql: `UPDATE catalog_ingest SET status = ? WHERE appid IN (${placeholders(part.length)})`,
      args: [status, ...part],
    })
  }
}

/** Курсоры фаз сида: чтобы прогон возобновлялся с места обрыва */
export async function setCatalogMeta(db: Db, key: string, value: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO catalog_meta (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, value],
  })
}

export async function getCatalogMeta(db: Db, key: string): Promise<string | null> {
  const res = await db.execute({ sql: 'SELECT value FROM catalog_meta WHERE key = ?', args: [key] })
  return (res.rows[0]?.value as string | undefined) ?? null
}

/** Словарь тегов Steam: tagid -> имя */
export async function saveTagDictionary(db: Db, tags: Map<number, string>): Promise<void> {
  const rows = [...tags.entries()]
  const CHUNK = 250
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.batch(
      rows.slice(i, i + CHUNK).map(([tagid, name]) => ({
        sql: `INSERT INTO tags (tagid, name) VALUES (?, ?)
              ON CONFLICT(tagid) DO UPDATE SET name = excluded.name`,
        args: [tagid, name],
      })),
      'write',
    )
  }
}

export async function loadTagDictionary(db: Db): Promise<Map<number, string>> {
  const res = await db.execute('SELECT tagid, name FROM tags')
  const out = new Map<number, string>()
  for (const r of res.rows as unknown as Array<{ tagid: number; name: string }>) {
    out.set(r.tagid, r.name)
  }
  return out
}

/**
 * Проекция тегов допустимых игр. Хранится только топ-N тегов на игру, и только
 * для игр, прошедших фильтры актуальности — так «топ по тегу» не возвращает
 * мертвецов, которые потом отсеются в JS и оставят пустую выдачу.
 */
export async function replaceGameTags(
  db: Db,
  appid: number,
  tags: Array<{ tag: string; weight: number }>,
): Promise<void> {
  await db.execute({ sql: 'DELETE FROM game_tags WHERE appid = ?', args: [appid] })
  if (!tags.length) return
  await db.batch(
    tags.map((t) => ({
      sql: 'INSERT OR REPLACE INTO game_tags (appid, tag, weight) VALUES (?, ?, ?)',
      args: [appid, t.tag, t.weight],
    })),
    'write',
  )
}

/** Частотность тега по каталогу — из неё считаются авто-стоп-слова */
export async function rebuildTagStats(db: Db): Promise<void> {
  await db.execute(`UPDATE tags SET game_count = (
    SELECT COUNT(*) FROM game_tags WHERE game_tags.tag = tags.name
  )`)
}

export async function loadTagStats(db: Db): Promise<Map<string, number>> {
  const res = await db.execute('SELECT name, game_count FROM tags WHERE game_count > 0')
  const out = new Map<string, number>()
  for (const r of res.rows as unknown as Array<{ name: string; game_count: number }>) {
    out.set(r.name, r.game_count)
  }
  return out
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

/* ---------- патчноуты ---------- */

export type NewsKind = 'patch' | 'news'
export type NewsScale = 'major' | 'hotfix'

export type StoredNews = {
  appid: number
  gid: string
  title: string
  url: string
  publishedAt: number
  kind: NewsKind
  scale: NewsScale | null
  blocks: NewsBlock[]
  bodyHash: string
  imageUrl?: string
  rank: number
  tldr?: string
}

/** Статусы опроса: gone — игра без ленты, mismatch — фид отдаёт чужие appid */
export type PollStatus = 'new' | 'ok' | 'empty' | 'error' | 'gone' | 'mismatch'

type NewsRow = {
  appid: number
  gid: string
  title: string
  url: string
  published_at: number
  kind: string
  scale: string | null
  blocks_json: string
  body_hash: string
  image_url: string | null
  rank: number
  tldr: string | null
}

function rowToNews(r: NewsRow): StoredNews {
  let blocks: NewsBlock[] = []
  try {
    const parsed = JSON.parse(r.blocks_json)
    if (Array.isArray(parsed)) blocks = parsed as NewsBlock[]
  } catch {
    // битый блоб не должен ронять страницу игры
  }
  return {
    appid: r.appid,
    gid: r.gid,
    title: r.title,
    url: r.url,
    publishedAt: r.published_at,
    kind: r.kind === 'patch' ? 'patch' : 'news',
    scale: r.scale === 'major' || r.scale === 'hotfix' ? r.scale : null,
    blocks,
    bodyHash: r.body_hash,
    ...(r.image_url ? { imageUrl: r.image_url } : {}),
    rank: r.rank,
    ...(r.tldr ? { tldr: r.tldr } : {}),
  }
}

const NEWS_COLS =
  'appid, gid, title, url, published_at, kind, scale, blocks_json, body_hash, image_url, rank, tldr'

/**
 * Во сколько раз перебираем строк, чтобы после схлопывания по играм осталось
 * столько, сколько просили. Четырёх хватает: даже Valve, патчащая всю линейку
 * разом, не занимает больше четверти окна.
 */
const OVERFETCH = 4

/**
 * Не больше одного патча на игру в ленте.
 *
 * Без этого лента перестаёт быть лентой: Valve выкатывает движковый апдейт
 * сразу во все свои старые игры, Warhammer патчится через день — и десяток
 * верхних карточек оказывается одной и той же игрой. Показываем самый свежий
 * патч каждой, остальное — на странице игры.
 */
function onePerGame(rows: StoredNews[], limit: number): StoredNews[] {
  const seen = new Set<number>()
  const out: StoredNews[] = []
  for (const r of rows) {
    if (seen.has(r.appid)) continue
    seen.add(r.appid)
    out.push(r)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Записывает посты, не переписывая то, что не изменилось: Turso тарифицирует и
 * записи тоже, а лента перечитывается целиком на каждом опросе.
 *
 * Пересказ Claude сбрасывается ТОЛЬКО когда изменилось тело (body_hash) —
 * иначе за один и тот же патч платили бы каждые сутки.
 */
export async function upsertNewsItems(
  db: Db,
  items: StoredNews[],
  nowSec: number,
): Promise<number> {
  if (!items.length) return 0
  const stmts = items.map((n) => ({
    sql: `INSERT INTO news_items (${NEWS_COLS}, tldr_at, tldr_tries, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?)
          ON CONFLICT(appid, gid) DO UPDATE SET
            title = excluded.title,
            url = excluded.url,
            published_at = excluded.published_at,
            kind = excluded.kind,
            blocks_json = excluded.blocks_json,
            body_hash = excluded.body_hash,
            image_url = excluded.image_url,
            -- не MAX: вес считается из games одинаково для любого опроса, так
            -- что свежее значение всегда вернее. Иначе игра, умершая после
            -- попадания в ленту, застревала бы в ней навсегда
            rank = excluded.rank,
            updated_at = excluded.updated_at,
            scale = CASE WHEN news_items.body_hash IS excluded.body_hash
                         THEN news_items.scale ELSE excluded.scale END,
            tldr = CASE WHEN news_items.body_hash IS excluded.body_hash
                        THEN news_items.tldr ELSE NULL END,
            tldr_at = CASE WHEN news_items.body_hash IS excluded.body_hash
                           THEN news_items.tldr_at ELSE NULL END,
            tldr_tries = CASE WHEN news_items.body_hash IS excluded.body_hash
                              THEN news_items.tldr_tries ELSE 0 END
          WHERE news_items.body_hash IS NOT excluded.body_hash
             OR news_items.title IS NOT excluded.title
             OR news_items.kind IS NOT excluded.kind
             OR news_items.rank IS NOT excluded.rank`,
    args: [
      n.appid,
      n.gid,
      n.title,
      n.url,
      n.publishedAt,
      n.kind,
      n.scale,
      JSON.stringify(n.blocks),
      n.bodyHash,
      n.imageUrl ?? null,
      n.rank,
      nowSec,
      nowSec,
    ],
  }))
  const res = await db.batch(stmts, 'write')
  return res.reduce((sum, r) => sum + Number(r.rowsAffected ?? 0), 0)
}

/** Страница игры: тут показываем и мелкие патчи тоже */
export async function getGameNews(db: Db, appid: number, limit = 8): Promise<StoredNews[]> {
  if (appid <= 0) return []
  const res = await db.execute({
    sql: `SELECT ${NEWS_COLS} FROM news_items
          WHERE appid = ? AND kind = 'patch'
          ORDER BY published_at DESC LIMIT ?`,
    args: [appid, limit],
  })
  return (res.rows as unknown as NewsRow[]).map(rowToNews)
}

/**
 * Общая лента для гостя. Предикат повторяет idx_news_feed ДОСЛОВНО — иначе
 * SQLite не возьмёт частичный индекс, и это станет сканом всей таблицы,
 * который noscan не поймает (LIMIT-то на месте).
 */
export async function getMajorFeed(db: Db, limit = 30, before?: number): Promise<StoredNews[]> {
  const res = await db.execute({
    sql: `SELECT ${NEWS_COLS} FROM news_items
          WHERE kind = 'patch' AND scale = 'major' AND rank > 0
            AND published_at < ?
          ORDER BY published_at DESC LIMIT ?`,
    args: [before ?? 2_000_000_000, limit * OVERFETCH],
  })
  return onePerGame((res.rows as unknown as NewsRow[]).map(rowToNews), limit)
}

/** Личная лента: крупные патчи по играм библиотеки */
export async function getFeedForApps(
  db: Db,
  appids: number[],
  limit = 30,
  before?: number,
): Promise<StoredNews[]> {
  const ids = appids.filter((a) => a > 0).slice(0, 400)
  if (!ids.length) return []
  const res = await db.execute({
    sql: `SELECT ${NEWS_COLS} FROM news_items
          WHERE appid IN (${placeholders(ids.length)})
            AND kind = 'patch' AND scale = 'major' AND published_at < ?
          ORDER BY published_at DESC LIMIT ?`,
    args: [...ids, before ?? 2_000_000_000, limit * OVERFETCH],
  })
  return onePerGame((res.rows as unknown as NewsRow[]).map(rowToNews), limit)
}

/**
 * Очередь на пересказ. Предикат дословно повторяет idx_news_tldr.
 *
 * scale IS NOT 'hotfix' — ключевое условие: посты, которым эвристика уже
 * сказала «мелочь», до модели не доезжают, иначе Claude переписывал бы
 * «обновлена карта из мастерской» обратно в major и это лезло бы в ленту
 * крупных обновлений.
 */
export async function getUnsummarized(db: Db, limit = 12): Promise<StoredNews[]> {
  const res = await db.execute({
    sql: `SELECT ${NEWS_COLS} FROM news_items
          WHERE kind = 'patch' AND tldr IS NULL AND tldr_tries < 3
            AND scale IS NOT 'hotfix'
          ORDER BY published_at DESC LIMIT ?`,
    args: [limit],
  })
  return (res.rows as unknown as NewsRow[]).map(rowToNews)
}

/**
 * tldr = null засчитывает попытку, но не выжигает запись: три неудачи подряд
 * (нет ключа, отказ модели, битый JSON) — и запись выпадает из очереди.
 */
export async function setNewsDigest(
  db: Db,
  appid: number,
  gid: string,
  digest: { tldr: string; scale: NewsScale } | null,
  nowSec: number,
): Promise<void> {
  if (digest) {
    await db.execute({
      sql: `UPDATE news_items SET tldr = ?, scale = ?, tldr_at = ?, tldr_tries = tldr_tries + 1
            WHERE appid = ? AND gid = ?`,
      args: [digest.tldr, digest.scale, nowSec, appid, gid],
    })
    return
  }
  await db.execute({
    sql: 'UPDATE news_items SET tldr_tries = tldr_tries + 1 WHERE appid = ? AND gid = ?',
    args: [appid, gid],
  })
}

/** Ретенция на игру. Держим больше, чем берём из фида, иначе вечный цикл
 *  «выкинули — перекачали — снова выкинули» на каждом опросе. */
export async function pruneNewsForApp(db: Db, appid: number, keep = 30): Promise<void> {
  await db.execute({
    sql: `DELETE FROM news_items WHERE appid = ? AND gid NOT IN (
            SELECT gid FROM news_items WHERE appid = ? ORDER BY published_at DESC LIMIT ?
          )`,
    args: [appid, appid, keep],
  })
}

/* ---------- очередь опроса новостей ---------- */

/**
 * Ставит игры в очередь. next_at задаётся СРАЗУ и с детерминированным
 * разбросом по appid: иначе вся библиотека станет доступной одной секундой и
 * первый же срез упрётся в темп, а хвост будет голодать.
 */
export async function enrollNewsPoll(
  db: Db,
  appids: number[],
  tier: 0 | 1,
  nowSec: number,
  jitterSec = 3600,
): Promise<void> {
  const ids = [...new Set(appids.filter((a) => Number.isInteger(a) && a > 0))].slice(0, 1200)
  if (!ids.length) return
  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    await db.batch(
      ids.slice(i, i + CHUNK).map((appid) => ({
        sql: `INSERT INTO news_poll (appid, tier, next_at, enrolled_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(appid) DO UPDATE SET tier = MIN(news_poll.tier, excluded.tier)`,
        args: [appid, tier, nowSec + (jitterSec ? appid % jitterSec : 0), nowSec],
      })),
      'write',
    )
  }
}

/**
 * Забирает пачку и СРАЗУ продлевает аренду. Без этого срез, убитый по времени
 * на третьей игре, вечно перевыбирал бы те же три, а хвост очереди никогда бы
 * не опрашивался — самый простой способ построить неубиваемый цикл запросов
 * к Steam.
 */
export type PollTarget = { appid: number; tier: number; failCount: number; lastPubAt?: number }

export async function claimNewsPollBatch(
  db: Db,
  nowSec: number,
  limit = 20,
  leaseSec = 900,
): Promise<PollTarget[]> {
  const res = await db.execute({
    sql: `SELECT appid, tier, fail_count, last_pub_at FROM news_poll
          WHERE next_at <= ? AND status != 'gone'
          ORDER BY next_at LIMIT ?`,
    args: [nowSec, limit],
  })
  const rows = res.rows as unknown as Array<{
    appid: number
    tier: number
    fail_count: number
    last_pub_at: number | null
  }>
  if (!rows.length) return []
  await db.batch(
    rows.map((r) => ({
      sql: 'UPDATE news_poll SET next_at = ?, last_at = ? WHERE appid = ?',
      args: [nowSec + leaseSec, nowSec, r.appid],
    })),
    'write',
  )
  return rows.map((r) => ({
    appid: r.appid,
    tier: r.tier,
    failCount: r.fail_count,
    ...(r.last_pub_at ? { lastPubAt: r.last_pub_at } : {}),
  }))
}

export type PollOutcome = {
  appid: number
  status: PollStatus
  nextAt: number
  failCount: number
  lastPubAt?: number
}

/** Один batch на весь срез вместо двадцати round-trip'ов по 30-80 мс */
export async function flushPollResults(
  db: Db,
  outcomes: PollOutcome[],
  nowSec: number,
): Promise<void> {
  if (!outcomes.length) return
  await db.batch(
    outcomes.map((o) => ({
      sql: `UPDATE news_poll
            SET status = ?, next_at = ?, fail_count = ?, last_at = ?,
                last_pub_at = COALESCE(?, last_pub_at)
            WHERE appid = ?`,
      args: [o.status, o.nextAt, o.failCount, nowSec, o.lastPubAt ?? null, o.appid],
    })),
    'write',
  )
}

/**
 * Набор каталога для общей ленты: топ по живому онлайну плюс топ по числу
 * отзывов. Онлайн — потому что лента отвечает на «во что играют сейчас»,
 * отзывы — потому что у половины каталога ccu ещё не замерен.
 *
 * Предикаты повторяют idx_games_ccu и idx_games_pool ДОСЛОВНО: иначе SQLite
 * не возьмёт частичный индекс и это станет полным сканом games. Стабы
 * «App {appid}» из /api/prepare отсекаются сами — у них tag_count = 0.
 */
export async function topCatalogAppids(db: Db, per = 200): Promise<number[]> {
  const alive = 'alive = 1 AND superseded_by IS NULL AND tag_count > 0'
  const [byCcu, byReviews] = await Promise.all([
    db.execute({
      sql: `SELECT appid FROM games WHERE ${alive} AND appid > 0
            ORDER BY ccu DESC LIMIT ?`,
      args: [per],
    }),
    db.execute({
      sql: `SELECT appid FROM games WHERE ${alive} AND appid > 0
            ORDER BY reviews_total DESC LIMIT ?`,
      args: [per],
    }),
  ])
  const ids = [...byCcu.rows, ...byReviews.rows].map(
    (r) => (r as unknown as { appid: number }).appid,
  )
  return [...new Set(ids)]
}

/**
 * Вес игры для денормализованного rank у постов: он решает, пускать ли её в
 * ОБЩУЮ ленту. Личной ленты это не касается — там игры и так свои.
 *
 * Вес получают ТОЛЬКО игры, прошедшие фильтры каталога. Иначе выходит вот что:
 * Valve выкатывает движковый апдейт разом во всю старую линейку, и общая лента
 * забивается Half-Life 2: Deathmatch и Condition Zero — теми самыми играми,
 * которые проект сам метит alive = 0 и не показывает в рекомендациях. В личной
 * ленте они по-прежнему видны: это твои игры, и патч к ним тебе интересен.
 *
 * Внутри — максимум из числа отзывов и онлайна: у свежих игр мало отзывов, у
 * старых не замерен ccu, и любой сигнал по отдельности обнулял бы часть
 * каталога.
 */
export async function getGameRanks(db: Db, appids: number[]): Promise<Map<number, number>> {
  const ids = appids.filter((a) => a > 0)
  if (!ids.length) return new Map()
  const res = await db.execute({
    sql: `SELECT appid,
            CASE WHEN alive = 1 AND superseded_by IS NULL AND tag_count > 0
                 THEN MAX(COALESCE(reviews_total, 0), COALESCE(ccu, 0))
                 ELSE 0 END AS rank
          FROM games WHERE appid IN (${placeholders(ids.length)})`,
    args: ids,
  })
  return new Map(
    (res.rows as unknown as Array<{ appid: number; rank: number | null }>).map(
      (r) => [r.appid, r.rank ?? 0] as const,
    ),
  )
}

export async function countNewsPollDue(db: Db, nowSec: number): Promise<number> {
  const res = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM news_poll WHERE next_at <= ? AND status != 'gone'",
    args: [nowSec],
  })
  return Number((res.rows[0] as unknown as { n: number })?.n ?? 0)
}
