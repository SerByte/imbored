import { createClient } from '@libsql/client'
import { describe, expect, test } from 'vitest'
import { isMultiplayerMeta } from './recommend'
import {
  bannedAppids,
  castRoomVote,
  claimNewsPollBatch,
  countIngest,
  countNewsPollDue,
  enrollNewsPoll,
  flushPollResults,
  getCatalogMeta,
  getFeedForApps,
  getGameNews,
  getMajorFeed,
  getUnsummarized,
  pruneNewsForApp,
  setNewsDigest,
  upsertNewsItems,
  type StoredNews,
  isMultiplayerCategories,
  loadTagDictionary,
  loadTagStats,
  nextIngestBatch,
  rebuildTagStats,
  replaceGameTags,
  saveTagDictionary,
  setCatalogMeta,
  setIngestStatus,
  upsertIngestRows,
  createDb,
  createRoom,
  feedbackStats,
  findRoomMatch,
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

  test('getGamesMeta читает только запрошенные игры', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, META, NOW)
    await upsertGameMeta(db, { ...META, appid: 730, name: 'CS2' }, NOW)
    const some = await getGamesMeta(db, [730])
    expect(some.size).toBe(1)
    expect(some.get(730)?.name).toBe('CS2')
  })

  test('выборка по списку не упирается в лимит параметров SQLite', async () => {
    // Библиотека на несколько тысяч игр — обычное дело в Steam, а один
    // плейсхолдер на игру упирается в потолок переменных SQLite
    const db = await freshDb()
    const appids = Array.from({ length: 2500 }, (_, i) => 1000 + i)
    const art = { header: 'https://cdn/h.jpg' }
    await upsertGameMeta(db, { ...META, appid: 1000, name: 'Первая', art }, NOW)
    await upsertGameMeta(db, { ...META, appid: 3499, name: 'Последняя', art }, NOW)

    const metas = await getGamesMeta(db, appids)
    expect(metas.get(1000)?.name).toBe('Первая')
    expect(metas.get(3499)?.name).toBe('Последняя')
    expect(metas.size).toBe(2)

    const stale = await getStaleAppids(db, appids, 14 * 86_400, NOW)
    expect(stale).toHaveLength(2498)
    expect(stale).not.toContain(1000)
  })

  test('строка без резолвленного арта считается протухшей', async () => {
    const db = await freshDb()
    // прогрета недавно, но арт ещё не резолвили — старая мелкая обложка
    await upsertGameMeta(db, META, NOW)
    expect(await getStaleAppids(db, [620], 14 * 86_400, NOW)).toEqual([620])
  })

  test('пустой арт означает «искали и не нашли» и не зацикливает прогрев', async () => {
    const db = await freshDb()
    // игры вне Steam и снятые с продажи не получат арт никогда —
    // без отметки о попытке они перезапрашивались бы на каждом заходе
    await upsertGameMeta(db, { ...META, appid: -101, art: {} }, NOW)
    expect(await getStaleAppids(db, [-101], 14 * 86_400, NOW)).toEqual([])

    const back = await getGameMeta(db, -101)
    expect(back?.art).toEqual({})
  })

  test('арт всех размеров переживает круг через базу', async () => {
    const db = await freshDb()
    const art = { header: 'https://cdn/h.jpg', hero: 'https://cdn/hero.jpg' }
    await upsertGameMeta(db, { ...META, art }, NOW)
    expect((await getGameMeta(db, 620))?.art).toEqual(art)
  })

  test('карта территории пишется батчем и отдаёт очередь по обсуждаемости', async () => {
    const db = await freshDb()
    await upsertIngestRows(
      db,
      [
        { appid: 10, name: 'Counter-Strike', tagids: [1663], reviewsTotal: 169284 },
        { appid: 730, name: 'Counter-Strike 2', tagids: [1663, 19], reviewsTotal: 9788173 },
        { appid: 42, name: 'Мелочь', tagids: [], reviewsTotal: 3 },
      ],
      NOW,
    )
    expect(await countIngest(db)).toBe(3)

    const batch = await nextIngestBatch(db, 'seen', 2)
    expect(batch.map((r) => r.appid)).toEqual([730, 10])
    expect(batch[0].tagids).toEqual([1663, 19])

    await setIngestStatus(db, [730], 'promoted')
    expect((await nextIngestBatch(db, 'seen', 5)).map((r) => r.appid)).toEqual([10, 42])
  })

  test('повторный прогон карты территории не меняет данные', async () => {
    const db = await freshDb()
    const rows = [{ appid: 10, name: 'CS', tagids: [1], reviewsTotal: 100 }]
    await upsertIngestRows(db, rows, NOW)
    await upsertIngestRows(db, rows, NOW + 999)
    expect(await countIngest(db)).toBe(1)
    expect((await nextIngestBatch(db, 'seen', 1))[0].name).toBe('CS')
  })

  test('курсоры фаз переживают перезапуск', async () => {
    const db = await freshDb()
    expect(await getCatalogMeta(db, 'search_start')).toBeNull()
    await setCatalogMeta(db, 'search_start', '1200')
    await setCatalogMeta(db, 'search_start', '2400')
    expect(await getCatalogMeta(db, 'search_start')).toBe('2400')
  })

  test('теги допустимых игр: проекция, частотность и стоп-слова', async () => {
    const db = await freshDb()
    await saveTagDictionary(db, new Map([[1, 'Roguelike'], [2, 'Indie']]))
    expect((await loadTagDictionary(db)).get(1)).toBe('Roguelike')

    await replaceGameTags(db, 620, [
      { tag: 'Roguelike', weight: 1000 },
      { tag: 'Indie', weight: 400 },
    ])
    await replaceGameTags(db, 730, [{ tag: 'Indie', weight: 900 }])
    await rebuildTagStats(db)

    const stats = await loadTagStats(db)
    expect(stats.get('Indie')).toBe(2)
    expect(stats.get('Roguelike')).toBe(1)
  })

  test('перезапись тегов игры не оставляет хвостов', async () => {
    const db = await freshDb()
    await replaceGameTags(db, 620, [{ tag: 'Puzzle', weight: 1000 }])
    await replaceGameTags(db, 620, [{ tag: 'Co-op', weight: 800 }])
    const res = await db.execute('SELECT tag FROM game_tags WHERE appid = 620')
    expect(res.rows.map((r) => r.tag)).toEqual(['Co-op'])
  })

  test('миграция дозаполняет производные колонки у старых строк', async () => {
    // строки, записанные до появления колонок, иначе не пройдут условие
    // tag_count > 0 и выборка кандидатов вернёт пустоту
    const db = await freshDb()
    await db.execute({
      sql: `INSERT INTO games (appid, name, tags_json, genres_json, categories_json, updated_at)
            VALUES (?, ?, ?, '[]', ?, ?)`,
      args: [777, 'Старая запись', JSON.stringify({ Co_op: 5, Action: 3 }), '[1,9]', NOW],
    })
    await migrateDb(db)
    const res = await db.execute('SELECT tag_count, is_multiplayer FROM games WHERE appid = 777')
    expect(Number(res.rows[0].tag_count)).toBe(2)
    expect(Number(res.rows[0].is_multiplayer)).toBe(1)
  })

  test('производные колонки считаются при записи метаданных', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, { ...META, categories: [2, 9], tags: { A: 1, B: 2 } }, NOW)
    const res = await db.execute('SELECT tag_count, is_multiplayer FROM games WHERE appid = 620')
    expect(Number(res.rows[0].tag_count)).toBe(2)
    expect(Number(res.rows[0].is_multiplayer)).toBe(1)
  })

  test('детектор мультиплеера в SQL-слое совпадает с движком рекомендаций', () => {
    // две реализации одного правила: db не импортирует lib/recommend,
    // поэтому эквивалентность закрепляем тестом
    for (const cats of [[2], [1], [2, 9], [38], [49], [], [3, 4]]) {
      expect(isMultiplayerCategories(cats)).toBe(
        isMultiplayerMeta({ ...META, categories: cats, tags: {} }),
      )
    }
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

  test('матч не срабатывает, пока в комнате один участник', async () => {
    // Согласие с самим собой согласием не является: условие «проголосовали все»
    // при единственном участнике выполнялось его же голосом, и человек получал
    // экран «Это матч!», ни с кем не договорившись
    const db = await freshDb()
    await createRoom(db, { id: 'R00002', steamid: 'a' }, NOW)
    await joinRoom(db, 'R00002', 'a', 'A', NOW)
    await castRoomVote(db, 'R00002', 'a', 570, 1, NOW)
    expect(await findRoomMatch(db, 'R00002')).toBeNull()

    // как только подключился второй и согласился — это уже договорённость
    await joinRoom(db, 'R00002', 'b', 'B', NOW + 1)
    await castRoomVote(db, 'R00002', 'b', 570, 1, NOW + 2)
    expect(await findRoomMatch(db, 'R00002')).toBe(570)
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
    // «свежая» — это ещё и с резолвленным артом, иначе строка догружается
    await upsertGameMeta(db, { ...META, art: { header: 'https://cdn/h.jpg' } }, NOW)
    await upsertGameMeta(
      db,
      { ...META, appid: 730, name: 'CS2', art: { header: 'https://cdn/cs.jpg' } },
      NOW - 100_000,
    ) // протухшая
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

/* ---------- патчноуты ---------- */

const NEWS_BASE = {
  url: 'https://store.steampowered.com/news/app/730/view/1',
  publishedAt: NOW,
  kind: 'patch' as const,
  scale: 'major' as const,
  blocks: [{ kind: 'p' as const, runs: [{ text: 'правки' }] }],
  bodyHash: 'h1',
  rank: 5000,
}

function newsItem(over: Partial<StoredNews> = {}): StoredNews {
  return { appid: 730, gid: '1', title: 'Обновление', ...NEWS_BASE, ...over }
}

describe('upsertNewsItems', () => {
  test('пишет пост и читает его обратно', async () => {
    const db = await freshDb()
    expect(await upsertNewsItems(db, [newsItem()], NOW)).toBe(1)
    const [got] = await getGameNews(db, 730)
    expect(got.title).toBe('Обновление')
    expect(got.blocks).toEqual(NEWS_BASE.blocks)
    expect(got.scale).toBe('major')
  })

  test('повторная запись без изменений не трогает строк', async () => {
    // Turso тарифицирует записи, а лента перечитывается на каждом опросе
    const db = await freshDb()
    await upsertNewsItems(db, [newsItem()], NOW)
    expect(await upsertNewsItems(db, [newsItem()], NOW + 100)).toBe(0)
  })

  test('пересказ переживает повторный опрос, но не переписанное тело', async () => {
    const db = await freshDb()
    await upsertNewsItems(db, [newsItem()], NOW)
    await setNewsDigest(db, 730, '1', { tldr: 'коротко', scale: 'major' }, NOW)

    // тело то же — платить Claude второй раз не за что
    await upsertNewsItems(db, [newsItem({ rank: 9000 })], NOW + 100)
    expect((await getGameNews(db, 730))[0].tldr).toBe('коротко')

    // издатель переписал патчноут — пересказ устарел
    await upsertNewsItems(db, [newsItem({ bodyHash: 'h2' })], NOW + 200)
    expect((await getGameNews(db, 730))[0].tldr).toBeUndefined()
  })

  test('rank только растёт: библиотечная запись не обнуляет каталожную', async () => {
    const db = await freshDb()
    await upsertNewsItems(db, [newsItem()], NOW)
    await upsertNewsItems(db, [newsItem({ rank: 0, bodyHash: 'h9' })], NOW + 1)
    expect((await getGameNews(db, 730))[0].rank).toBe(5000)
  })
})

describe('ленты', () => {
  test('общая лента берёт только крупные патчи игр каталога', async () => {
    const db = await freshDb()
    await upsertNewsItems(
      db,
      [
        newsItem({ gid: '1', title: 'Крупный' }),
        newsItem({ gid: '2', title: 'Хотфикс', scale: 'hotfix', bodyHash: 'h2' }),
        newsItem({ gid: '3', title: 'Не патч', kind: 'news', bodyHash: 'h3' }),
        newsItem({ gid: '4', title: 'Инди без ранга', rank: 0, bodyHash: 'h4' }),
      ],
      NOW,
    )
    expect((await getMajorFeed(db)).map((n) => n.title)).toEqual(['Крупный'])
  })

  test('страница игры показывает и мелкие патчи, но не новости', async () => {
    const db = await freshDb()
    await upsertNewsItems(
      db,
      [
        newsItem({ gid: '1', title: 'Крупный' }),
        newsItem({ gid: '2', title: 'Хотфикс', scale: 'hotfix', bodyHash: 'h2' }),
        newsItem({ gid: '3', title: 'Распродажа', kind: 'news', bodyHash: 'h3' }),
      ],
      NOW,
    )
    const titles = (await getGameNews(db, 730)).map((n) => n.title)
    expect(titles).toEqual(['Крупный', 'Хотфикс'])
  })

  test('личная лента ограничена играми библиотеки', async () => {
    const db = await freshDb()
    await upsertNewsItems(
      db,
      [newsItem({ appid: 730 }), newsItem({ appid: 570, rank: 0, bodyHash: 'h5' })],
      NOW,
    )
    expect((await getFeedForApps(db, [570])).map((n) => n.appid)).toEqual([570])
    expect(await getFeedForApps(db, [])).toEqual([])
    // кураторские отрицательные appid в ленту не просачиваются
    expect(await getFeedForApps(db, [-101])).toEqual([])
  })

  test('очередь пересказа выдыхается после трёх неудач', async () => {
    const db = await freshDb()
    // scale: null — масштаб ещё не решён, значит пост ждёт модель
    await upsertNewsItems(db, [newsItem({ scale: null })], NOW)
    expect(await getUnsummarized(db)).toHaveLength(1)
    for (let i = 0; i < 3; i++) await setNewsDigest(db, 730, '1', null, NOW)
    expect(await getUnsummarized(db)).toHaveLength(0)
  })

  test('ретенция режет хвост, оставляя свежее', async () => {
    const db = await freshDb()
    await upsertNewsItems(
      db,
      Array.from({ length: 8 }, (_, i) =>
        newsItem({ gid: String(i), publishedAt: NOW + i, bodyHash: `h${i}` }),
      ),
      NOW,
    )
    await pruneNewsForApp(db, 730, 3)
    const left = await getGameNews(db, 730, 50)
    expect(left.map((n) => n.gid)).toEqual(['7', '6', '5'])
  })
})

describe('очередь опроса', () => {
  test('библиотека попадает в очередь при сохранении снапшота', async () => {
    const db = await freshDb()
    await saveLibrarySnapshot(db, 'u1', LIB, NOW)
    // курсор проставлен сразу, иначе вся библиотека станет доступной одной секундой
    expect(await countNewsPollDue(db, NOW + 4000)).toBe(2)
    expect(await countNewsPollDue(db, NOW - 1)).toBe(0)
  })

  test('аренда двигает курсор до сети — хвост очереди не голодает', async () => {
    const db = await freshDb()
    await enrollNewsPoll(db, [1, 2, 3], 0, NOW)
    const first = await claimNewsPollBatch(db, NOW + 4000, 2)
    expect(first).toHaveLength(2)
    // повторный вызов сразу же не должен выдать те же игры
    const second = await claimNewsPollBatch(db, NOW + 4000, 2)
    const firstIds = first.map((t) => t.appid)
    expect(second.some((t) => firstIds.includes(t.appid))).toBe(false)
  })

  test('повторная постановка не понижает tier', async () => {
    const db = await freshDb()
    await enrollNewsPoll(db, [42], 0, NOW)
    await enrollNewsPoll(db, [42], 1, NOW)
    const res = await db.execute('SELECT tier FROM news_poll WHERE appid = 42')
    expect(Number(res.rows[0].tier)).toBe(0)
  })

  test('отрицательные appid в очередь не берутся', async () => {
    const db = await freshDb()
    await enrollNewsPoll(db, [-101, 0, 730], 1, NOW)
    expect((await claimNewsPollBatch(db, NOW + 4000, 10)).map((t) => t.appid)).toEqual([730])
  })

  test('gone выпадает из очереди насовсем', async () => {
    const db = await freshDb()
    await enrollNewsPoll(db, [730], 1, NOW)
    await flushPollResults(db, [{ appid: 730, status: 'gone', nextAt: NOW, failCount: 3 }], NOW)
    expect(await claimNewsPollBatch(db, NOW + 99999, 10)).toEqual([])
  })
})

describe('очередь пересказа: экономия на мелочи', () => {
  test('мелочь до модели не доезжает, крупное — доезжает', async () => {
    // «обновлена карта из мастерской» эвристика метит hotfix сразу;
    // отправлять такое в Claude — платить за пересказ трёх слов.
    // Всё прочее идёт за пересказом, даже если масштаб уже угадан эвристикой:
    // без этого лента без ANTHROPIC_API_KEY осталась бы вовсе без текстов
    const db = await freshDb()
    await upsertNewsItems(
      db,
      [
        newsItem({ gid: '1', scale: 'hotfix' }),
        newsItem({ gid: '2', scale: 'major', bodyHash: 'h2' }),
        newsItem({ gid: '3', scale: null, bodyHash: 'h3' }),
      ],
      NOW,
    )
    expect((await getUnsummarized(db)).map((n) => n.gid).sort()).toEqual(['2', '3'])
  })
})
