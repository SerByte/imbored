import { createClient } from '@libsql/client'
import { describe, expect, test } from 'vitest'
import {
  bannedAppids,
  castRoomVote,
  createDb,
  createRoom,
  feedbackStats,
  findRoomMatch,
  getAllGamesMeta,
  getGameJson,
  getGameMeta,
  getGamesMeta,
  getLatestSnapshot,
  getRoom,
  getStaleAppids,
  getUserPortrait,
  joinRoom,
  listFeedback,
  listPublicRooms,
  logFeedback,
  migrateDb,
  myVotedAppids,
  roomMembers,
  saveLibrarySnapshot,
  setGameJson,
  setRoomMatched,
  setRoomPublic,
  setUserPortrait,
  upsertGameMeta,
  upsertUser,
} from './db'
import type { GameMeta, LibraryGame } from './types'

const NOW = 1_700_000_000

/** Свежая in-memory база на каждый тест */
function freshDb() {
  return createDb(':memory:')
}

const LIB: LibraryGame[] = [
  { appid: 570, name: 'Dota 2', playtimeForever: 6000, playtime2Weeks: 120, lastPlayed: NOW - 100 },
  { appid: 620, name: 'Portal 2', playtimeForever: 30, playtime2Weeks: 0 },
]

const META: GameMeta = {
  appid: 620,
  name: 'Portal 2',
  tags: { Puzzle: 100, 'Co-op': 80 },
  genres: ['Puzzle'],
  categories: [2, 9, 38],
  shortDescription: 'Головоломка с порталами',
  headerImage: 'https://example/620.jpg',
  screenshots: ['https://example/620-1.jpg'],
  isFree: false,
  priceFinal: 999,
  releaseDate: '2011-04-19',
}

describe('db', () => {
  test('снапшот библиотеки сохраняется и читается, свежий побеждает', async () => {
    const db = await freshDb()
    await saveLibrarySnapshot(db, '765611', LIB, NOW - 100)
    await saveLibrarySnapshot(db, '765611', [LIB[0]], NOW)
    const snap = await getLatestSnapshot(db, '765611')
    expect(snap?.takenAt).toBe(NOW)
    expect(snap?.games).toEqual([LIB[0]])
    expect(await getLatestSnapshot(db, 'unknown')).toBeNull()
  })

  test('метаданные игры: upsert + чтение эквивалентны, повторный upsert обновляет', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, META, NOW)
    expect(await getGameMeta(db, 620)).toEqual(META)
    await upsertGameMeta(db, { ...META, name: 'Portal 2 (upd)', tags: { Puzzle: 200 } }, NOW + 10)
    expect((await getGameMeta(db, 620))?.name).toBe('Portal 2 (upd)')
    expect((await getGameMeta(db, 620))?.tags).toEqual({ Puzzle: 200 })
    expect(await getGameMeta(db, 999)).toBeNull()
  })

  test('игры из других магазинов: store и storeUrl переживают роундтрип', async () => {
    const db = await freshDb()
    const external = {
      ...META,
      appid: -101,
      name: 'Fortnite',
      store: 'epic',
      storeUrl: 'https://store.epicgames.com/p/fortnite',
    }
    await upsertGameMeta(db, external, NOW)
    expect(await getGameMeta(db, -101)).toEqual(external)
  })

  test('хранится не больше трёх последних снапшотов на пользователя', async () => {
    const db = await freshDb()
    for (let i = 0; i < 5; i++) await saveLibrarySnapshot(db, 'u1', [LIB[0]], NOW + i)
    await saveLibrarySnapshot(db, 'u2', [LIB[0]], NOW)
    const res = await db.execute("SELECT COUNT(*) AS n FROM library_snapshots WHERE steamid = 'u1'")
    expect(Number(res.rows[0].n)).toBe(3)
    expect((await getLatestSnapshot(db, 'u1'))?.takenAt).toBe(NOW + 4)
    expect((await getLatestSnapshot(db, 'u2'))?.takenAt).toBe(NOW)
  })

  test('getAllGamesMeta читает весь каталог одним проходом', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, META, NOW)
    await upsertGameMeta(db, { ...META, appid: 730, name: 'CS2' }, NOW)
    const all = await getAllGamesMeta(db)
    expect(all.size).toBe(2)
    expect(all.get(620)?.name).toBe('Portal 2')
    expect(all.get(730)?.name).toBe('CS2')
  })

  test('выборка по списку не упирается в лимит параметров SQLite', async () => {
    // Библиотека на несколько тысяч игр — обычное дело в Steam, а один
    // плейсхолдер на игру упирается в потолок переменных SQLite
    const db = await freshDb()
    const appids = Array.from({ length: 2500 }, (_, i) => 1000 + i)
    await upsertGameMeta(db, { ...META, appid: 1000, name: 'Первая' }, NOW)
    await upsertGameMeta(db, { ...META, appid: 3499, name: 'Последняя' }, NOW)

    const metas = await getGamesMeta(db, appids)
    expect(metas.get(1000)?.name).toBe('Первая')
    expect(metas.get(3499)?.name).toBe('Последняя')
    expect(metas.size).toBe(2)

    const stale = await getStaleAppids(db, appids, 14 * 86_400, NOW)
    expect(stale).toHaveLength(2498)
    expect(stale).not.toContain(1000)
  })

  test('setGameJson с невалидной колонкой бросает, а не строит SQL', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, META, NOW)
    await expect(
      setGameJson(db, 620, 'appid = 0; --' as unknown as Parameters<typeof setGameJson>[2], {}),
    ).rejects.toThrow()
  })

  test('JSON-кэш отзывов/pros-cons сохраняется по колонке и читается', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, META, NOW)
    expect(await getGameJson(db, 620, 'reviews_summary_json')).toBeNull()
    await setGameJson(db, 620, 'reviews_summary_json', { scoreDesc: 'Very Positive' })
    await setGameJson(db, 620, 'pros_cons_json', { pros: ['a'], cons: [] })
    expect(await getGameJson(db, 620, 'reviews_summary_json')).toEqual({
      scoreDesc: 'Very Positive',
    })
    expect(await getGameJson(db, 620, 'pros_cons_json')).toEqual({ pros: ['a'], cons: [] })
    expect(await getGameJson(db, 999, 'pros_cons_json')).toBeNull()
  })

  test('портрет кэшируется в users и читается', async () => {
    const db = await freshDb()
    await upsertUser(db, { steamid: 'u1', personaName: 'A' }, NOW)
    expect(await getUserPortrait(db, 'u1')).toBeNull()
    await setUserPortrait(db, 'u1', { takenAt: NOW, text: 'ты — легенда бэклога' })
    expect(await getUserPortrait(db, 'u1')).toEqual({ takenAt: NOW, text: 'ты — легенда бэклога' })
    expect(await getUserPortrait(db, 'nobody')).toBeNull()
  })

  test('комната: создание, вход, участники', async () => {
    const db = await freshDb()
    await createRoom(
      db,
      { id: 'ABC123', steamid: 'host', mood: { time: 'long', vibe: 'engaged', social: 'friends' } },
      NOW,
    )
    expect(await joinRoom(db, 'ABC123', 'host', 'Хост', NOW)).toBe(true)
    expect(await joinRoom(db, 'ABC123', 'friend', 'Друг', NOW + 1)).toBe(true)
    expect(await joinRoom(db, 'NOPE00', 'x', 'X', NOW)).toBe(false)
    const room = await getRoom(db, 'ABC123')
    expect(room?.status).toBe('open')
    expect(room?.mood?.social).toBe('friends')
    const members = await roomMembers(db, 'ABC123')
    expect(members.map((m) => m.steamid).sort()).toEqual(['friend', 'host'])
    // повторный вход не дублирует
    await joinRoom(db, 'ABC123', 'host', 'Хост', NOW + 2)
    expect(await roomMembers(db, 'ABC123')).toHaveLength(2)
  })

  test('открытые комнаты: тумблер и доска, закрытые/старые/сматченные не видны', async () => {
    const db = await freshDb()
    await createRoom(db, { id: 'PUB001', steamid: 'a' }, NOW)
    await joinRoom(db, 'PUB001', 'a', 'Аня', NOW)
    await createRoom(db, { id: 'PRV001', steamid: 'b' }, NOW)
    await createRoom(db, { id: 'OLD001', steamid: 'c' }, NOW - 200_000)
    await setRoomPublic(db, 'OLD001', true)
    await createRoom(db, { id: 'MTCHED', steamid: 'd' }, NOW)
    await setRoomPublic(db, 'MTCHED', true)
    await setRoomMatched(db, 'MTCHED', 570)

    expect((await getRoom(db, 'PUB001'))?.isPublic).toBe(false)
    await setRoomPublic(db, 'PUB001', true)
    expect((await getRoom(db, 'PUB001'))?.isPublic).toBe(true)

    const board = await listPublicRooms(db, NOW)
    expect(board.map((r) => r.id)).toEqual(['PUB001'])
    expect(board[0].memberNames).toEqual(['Аня'])

    await setRoomPublic(db, 'PUB001', false)
    expect(await listPublicRooms(db, NOW)).toEqual([])
  })

  test('голоса: матч только когда ВСЕ за одну игру', async () => {
    const db = await freshDb()
    await createRoom(db, { id: 'R00001', steamid: 'a' }, NOW)
    await joinRoom(db, 'R00001', 'a', 'A', NOW)
    await joinRoom(db, 'R00001', 'b', 'B', NOW)
    await castRoomVote(db, 'R00001', 'a', 570, 1, NOW)
    expect(await findRoomMatch(db, 'R00001')).toBeNull()
    await castRoomVote(db, 'R00001', 'b', 570, 0, NOW)
    expect(await findRoomMatch(db, 'R00001')).toBeNull()
    // передумал — переголосование заменяет голос
    await castRoomVote(db, 'R00001', 'b', 570, 1, NOW + 1)
    expect(await findRoomMatch(db, 'R00001')).toBe(570)
    await setRoomMatched(db, 'R00001', 570)
    expect((await getRoom(db, 'R00001'))?.status).toBe('matched')
    expect((await getRoom(db, 'R00001'))?.matchedAppid).toBe(570)
    expect([...(await myVotedAppids(db, 'R00001', 'a'))]).toEqual([570])
  })

  test('скип с причиной и бан сохраняются и читаются', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 620, action: 'skipped', reason: 'genre' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'banned' }, NOW + 1)
    const rows = await listFeedback(db, 'u1')
    expect(rows.find((r) => r.appid === 620)?.reason).toBe('genre')
    expect(rows.find((r) => r.appid === 570)?.action).toBe('banned')
  })

  test('миграция: старая таблица feedback с узким CHECK принимает banned после migrateDb', async () => {
    const db = createClient({ url: ':memory:' })
    await db.executeMultiple(`CREATE TABLE feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      steamid TEXT NOT NULL,
      appid INTEGER NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('liked','skipped','opened')),
      mood_json TEXT,
      created_at INTEGER NOT NULL
    );`)
    await db.execute(
      "INSERT INTO feedback (steamid, appid, action, created_at) VALUES ('u1', 620, 'liked', 1)",
    )
    const migrated = await migrateDb(db)
    await logFeedback(migrated, { steamid: 'u1', appid: 570, action: 'banned' }, NOW)
    const rows = await listFeedback(migrated, 'u1')
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.action).sort()).toEqual(['banned', 'liked'])
  })

  test('listFeedback отдаёт свежие первыми и уважает limit', async () => {
    const db = await freshDb()
    for (let i = 0; i < 5; i++) {
      await logFeedback(db, { steamid: 'u1', appid: 100 + i, action: 'skipped' }, NOW + i)
    }
    const rows = await listFeedback(db, 'u1', 2)
    expect(rows).toHaveLength(2)
    expect(rows[0].appid).toBe(104)
  })

  test('feedbackStats считает долю попаданий', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 1, action: 'liked' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 2, action: 'liked' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 3, action: 'skipped' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 4, action: 'opened' }, NOW) // не влияет
    expect(await feedbackStats(db, 'u1')).toEqual({ liked: 2, skipped: 1, rate: 2 / 3 })
    expect(await feedbackStats(db, 'nobody')).toEqual({ liked: 0, skipped: 0, rate: null })
  })

  test('bannedAppids отдаёт множество забаненного', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'banned' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 620, action: 'liked' }, NOW)
    expect([...(await bannedAppids(db, 'u1'))]).toEqual([570])
  })

  test('фидбек логируется и читается по пользователю', async () => {
    const db = await freshDb()
    await logFeedback(
      db,
      {
        steamid: 'u1',
        appid: 620,
        action: 'liked',
        mood: { time: 'short', vibe: 'chill', social: 'solo' },
      },
      NOW,
    )
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'skipped' }, NOW + 1)
    await logFeedback(db, { steamid: 'u2', appid: 570, action: 'opened' }, NOW + 2)
    const rows = await listFeedback(db, 'u1')
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.action).sort()).toEqual(['liked', 'skipped'])
  })

  test('getStaleAppids: отсутствующие и протухшие попадают в список, свежие — нет', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, META, NOW) // свежая
    await upsertGameMeta(db, { ...META, appid: 730, name: 'CS2' }, NOW - 100_000) // протухшая
    const stale = await getStaleAppids(db, [620, 730, 111], 86_400, NOW)
    expect(stale.sort()).toEqual([111, 730])
  })

  test('upsertUser не плодит дубликатов', async () => {
    const db = await freshDb()
    await upsertUser(db, { steamid: 'u1', personaName: 'A' }, NOW)
    await upsertUser(db, { steamid: 'u1', personaName: 'B' }, NOW + 5)
    const res = await db.execute('SELECT COUNT(*) AS n FROM users')
    expect(Number(res.rows[0].n)).toBe(1)
  })
})
