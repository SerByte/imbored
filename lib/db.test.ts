import { createClient, type InStatement } from '@libsql/client'
import { describe, expect, test } from 'vitest'
import { isMultiplayerMeta } from './recommend'
import {
  acquireLease,
  advanceRoomDeckRound,
  bannedAppids,
  castRoomVote,
  claimNewsPollBatch,
  countIngest,
  countNewsPollDue,
  DIGEST_LEASE,
  enrollNewsPoll,
  flushPollResults,
  getCatalogMeta,
  getFeedForApps,
  gameDescriptions,
  getGameNews,
  getGameRanks,
  getNewsBlocks,
  getFeedHeadForApps,
  getMajorFeed,
  getMajorFeedHead,
  getUnsummarized,
  pruneNewsForApp,
  releaseLease,
  removeRoomMember,
  reviveGoneNewsPoll,
  setGameDescriptions,
  setNewsDigest,
  STEAM_LEASE,
  upsertNewsItems,
  type Db,
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
  listBanned,
  listFeedback,
  listPublicRooms,
  logFeedback,
  migrateDb,
  myVotedAppids,
  roomMembers,
  roomVoteCounts,
  roomVotes,
  saveLibrarySnapshot,
  setRoomDeckSize,
  setGameJson,
  setRoomMatched,
  setRoomPublic,
  setUserPortrait,
  stalePriceAppids,
  unbanGame,
  updateGamePrices,
  upsertGameMeta,
  upsertUser,
  getDailyPick,
  saveDailyPick,
  sweepDailyPicks,
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

  test('описания: отдаются с текстом, переписываются поштучно, остальное не трогают', async () => {
    const db = await freshDb()
    // reviews_total задаёт порядок выдачи и попадание в ALIVE_POOL
    await upsertGameMeta(db, { ...META, appid: 620, reviewsTotal: 500 }, NOW)
    await upsertGameMeta(
      db,
      { ...META, appid: 570, name: 'Dota 2', shortDescription: 'A MOBA game', reviewsTotal: 900 },
      NOW,
    )

    const all = await gameDescriptions(db, 10)
    expect(all.map((g) => g.appid)).toEqual([570, 620])
    expect(all[0].description).toBe('A MOBA game')

    const n = await setGameDescriptions(db, [{ appid: 570, description: 'Игра про героев' }])
    expect(n).toBe(1)
    const after = await getGameMeta(db, 570)
    expect(after?.shortDescription).toBe('Игра про героев')
    // и ничего кроме описания: доливка перевода не имеет права стереть цену и теги
    expect(after?.name).toBe('Dota 2')
    expect(after?.priceFinal).toBe(META.priceFinal)
    expect(after?.tags).toEqual(META.tags)
    // соседа не трогали
    expect((await getGameMeta(db, 620))?.shortDescription).toBe('Головоломка с порталами')
  })

  test('пустой список описаний не идёт в базу вовсе', async () => {
    const db = await freshDb()
    // db.batch([]) в libsql — ошибка, и вызывающему пришлось бы помнить об этом
    expect(await setGameDescriptions(db, [])).toBe(0)
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

  test('цена и скидка переживают роундтрип — их и теряли в этом месте', async () => {
    // Тот же класс потери, что был у developer, release_year и signals_at:
    // колонка пишется, приезжает в SELECT * и выбрасывается в JS, потому что
    // её нет ни в GameRow, ни в rowToMeta
    const db = await freshDb()
    const onSale: GameMeta = {
      ...META,
      priceFinal: 499,
      priceInitial: 999,
      discountPercent: 50,
      discountEndsAt: NOW + 86_400,
      priceAt: NOW,
    }
    await upsertGameMeta(db, onSale, NOW)
    expect(await getGameMeta(db, 620)).toEqual(onSale)
    expect((await getGamesMeta(db, [620])).get(620)).toEqual(onSale)
  })

  test('кончившаяся распродажа стирается записью, а не остаётся навсегда', async () => {
    // У скидки нет своего события: есть только следующий ответ Steam без
    // полей скидки. COALESCE в ON CONFLICT означал бы «−50%» навсегда.
    const db = await freshDb()
    await upsertGameMeta(
      db,
      { ...META, priceInitial: 999, discountPercent: 50, discountEndsAt: NOW + 10, priceAt: NOW },
      NOW,
    )
    await upsertGameMeta(
      db,
      { ...META, priceFinal: 999, priceInitial: 999, discountPercent: 0, priceAt: NOW + 100 },
      NOW + 100,
    )
    const stored = await getGameMeta(db, 620)
    expect(stored?.discountPercent).toBe(0)
    expect(stored?.discountEndsAt).toBeUndefined()
    expect(stored?.priceAt).toBe(NOW + 100)
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

  test('stalePriceAppids: сперва те, у кого цены не было никогда', async () => {
    // Бюджет одного вызова конечен, а пустая цена заметнее устаревшей
    const db = await freshDb()
    await upsertGameMeta(db, { ...META, appid: 1, priceAt: NOW - 100 }, NOW)
    await upsertGameMeta(db, { ...META, appid: 2 }, NOW)
    await upsertGameMeta(db, { ...META, appid: 3, priceAt: NOW - 5000 }, NOW)

    expect(await stalePriceAppids(db, [1, 2, 3], 10, NOW)).toEqual([2, 3, 1])
  })

  test('stalePriceAppids: свежие, чужие магазины и отсутствующие не спрашиваются', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, { ...META, appid: 620, priceAt: NOW - 10 }, NOW)
    await upsertGameMeta(db, { ...META, appid: -101, store: 'epic' }, NOW)

    // свежая цена — не спрашиваем; отрицательный appid в Steam не найти вовсе;
    // 999 нет в базе, и писать результат было бы некуда
    expect(await stalePriceAppids(db, [620, -101, 999], 3600, NOW)).toEqual([])
  })

  test('stalePriceAppids: лимит режет очередь замера', async () => {
    const db = await freshDb()
    for (let i = 1; i <= 5; i++) await upsertGameMeta(db, { ...META, appid: i }, NOW)
    expect(await stalePriceAppids(db, [1, 2, 3, 4, 5], 3600, NOW, 2)).toHaveLength(2)
  })

  test('updateGamePrices пишет цену, не двигая метаданные и updated_at', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, META, NOW)
    await updateGamePrices(db, [{ appid: 620, priceFinal: 499, priceInitial: 999, discountPercent: 50 }], NOW + 500)

    const stored = await getGameMeta(db, 620)
    expect(stored?.priceFinal).toBe(499)
    expect(stored?.discountPercent).toBe(50)
    expect(stored?.priceAt).toBe(NOW + 500)
    expect(stored?.tags).toEqual(META.tags)
    // updated_at не двинулся: замер цены не должен отменять прогрев метаданных
    const res = await db.execute('SELECT updated_at FROM games WHERE appid = 620')
    expect(Number(res.rows[0].updated_at)).toBe(NOW)
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

  /**
   * Ключ разового бэкфилла из migrateDb. freshDb() уже прогнала миграцию и
   * тем самым его поставила, так что тесту, который проверяет САМ бэкфилл,
   * приходится вернуть базу в состояние «ещё не бэкфилленной».
   */
  const DERIVED_KEY = 'derived_backfilled_v1'

  async function insertLegacyGame(db: Awaited<ReturnType<typeof freshDb>>) {
    await db.execute({
      sql: `INSERT INTO games (appid, name, tags_json, genres_json, categories_json, updated_at)
            VALUES (?, ?, ?, '[]', ?, ?)`,
      args: [777, 'Старая запись', JSON.stringify({ Co_op: 5, Action: 3 }), '[1,9]', NOW],
    })
  }

  test('миграция дозаполняет производные колонки у старых строк', async () => {
    // строки, записанные до появления колонок, иначе не пройдут условие
    // tag_count > 0 и выборка кандидатов вернёт пустоту
    const db = await freshDb()
    await insertLegacyGame(db)
    await db.execute({ sql: 'DELETE FROM catalog_meta WHERE key = ?', args: [DERIVED_KEY] })
    await migrateDb(db)
    const res = await db.execute('SELECT tag_count, is_multiplayer FROM games WHERE appid = 777')
    expect(Number(res.rows[0].tag_count)).toBe(2)
    expect(Number(res.rows[0].is_multiplayer)).toBe(1)
  })

  test('повторная миграция не пересчитывает производные колонки', async () => {
    // Это и есть смысл флага: без него два полнотабличных UPDATE по games
    // выполнялись бы на каждом холодном старте, а Turso считает прочитанные
    // строки. Проверяем именно короткое замыкание, а не результат.
    const db = await freshDb()
    await insertLegacyGame(db)
    await migrateDb(db)
    const res = await db.execute('SELECT tag_count, is_multiplayer FROM games WHERE appid = 777')
    expect(Number(res.rows[0].tag_count)).toBe(0)
    expect(Number(res.rows[0].is_multiplayer)).toBe(0)
  })

  test('миграция ставит флаг бэкфилла', async () => {
    const db = await freshDb()
    const res = await db.execute({
      sql: 'SELECT value FROM catalog_meta WHERE key = ?',
      args: [DERIVED_KEY],
    })
    expect(res.rows.length).toBe(1)
  })

  test('игра дня: запись и чтение переживают сериализацию', async () => {
    const db = await freshDb()
    const payload = {
      pick: { appid: 620, name: 'Portal 2', source: 'backlog', score: 1.5 },
      shelf: [{ appid: 570, name: 'Dota 2', source: 'new', score: 0.9 }],
      hoursPlayed: 42,
    }
    await saveDailyPick(db, 'S1', '2026-08-19', payload, NOW)
    expect(await getDailyPick(db, 'S1', '2026-08-19')).toEqual(payload)
  })

  test('игра дня: чужой день и чужой steamid не читаются', async () => {
    const db = await freshDb()
    await saveDailyPick(db, 'S1', '2026-08-19', { pick: 1 }, NOW)
    expect(await getDailyPick(db, 'S1', '2026-08-20')).toBeNull()
    expect(await getDailyPick(db, 'S2', '2026-08-19')).toBeNull()
  })

  test('игра дня: повторная запись за тот же день перезаписывает', async () => {
    const db = await freshDb()
    await saveDailyPick(db, 'S1', '2026-08-19', { v: 1 }, NOW)
    await saveDailyPick(db, 'S1', '2026-08-19', { v: 2 }, NOW + 10)
    expect(await getDailyPick(db, 'S1', '2026-08-19')).toEqual({ v: 2 })
  })

  test('игра дня: недоступная таблица читается как «записи нет», а не роняет', async () => {
    // Поймано живьём: инстанс, поднятый до появления таблицы, ронял /api/daily
    // пятисоткой — кэш ломал страницу, которую должен был ускорять.
    const broken = {
      execute: () => Promise.reject(new Error('no such table: daily_picks')),
    } as unknown as Awaited<ReturnType<typeof freshDb>>
    expect(await getDailyPick(broken, 'S1', '2026-08-19')).toBeNull()
    // запись тоже не должна бросать наружу
    await expect(saveDailyPick(broken, 'S1', '2026-08-19', { v: 1 }, NOW)).resolves.toBeUndefined()
  })

  test('игра дня: битый JSON читается как «записи нет», а не роняет', async () => {
    const db = await freshDb()
    await db.execute({
      sql: 'INSERT INTO daily_picks (steamid, day, payload_json, created_at) VALUES (?, ?, ?, ?)',
      args: ['S1', '2026-08-19', '{не json', NOW],
    })
    expect(await getDailyPick(db, 'S1', '2026-08-19')).toBeNull()
  })

  test('подметание игр дня убирает прошлые дни и не трогает текущий', async () => {
    const db = await freshDb()
    await saveDailyPick(db, 'S1', '2026-08-17', { v: 'старое' }, NOW)
    await saveDailyPick(db, 'S1', '2026-08-18', { v: 'вчера' }, NOW)
    await saveDailyPick(db, 'S1', '2026-08-19', { v: 'сегодня' }, NOW)
    await sweepDailyPicks(db, '2026-08-18')
    expect(await getDailyPick(db, 'S1', '2026-08-17')).toBeNull()
    expect(await getDailyPick(db, 'S1', '2026-08-18')).toEqual({ v: 'вчера' })
    expect(await getDailyPick(db, 'S1', '2026-08-19')).toEqual({ v: 'сегодня' })
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

  test('roomVoteCounts считает голоса всех участников одним запросом', async () => {
    // Ростер ожидания показывает прогресс каждого, а опрос идёт раз в 2.5с у
    // каждого участника: запрос на человека превращал это в N² чтений строк
    const db = await freshDb()
    await createRoom(db, { id: 'CNT001', steamid: 'a' }, NOW)
    await joinRoom(db, 'CNT001', 'a', 'A', NOW)
    await joinRoom(db, 'CNT001', 'b', 'B', NOW)
    await castRoomVote(db, 'CNT001', 'a', 570, 1, NOW)
    await castRoomVote(db, 'CNT001', 'a', 620, 0, NOW + 1)
    await castRoomVote(db, 'CNT001', 'b', 570, 1, NOW + 2)

    const counts = await roomVoteCounts(db, 'CNT001')
    expect(counts.get('a')).toBe(2)
    expect(counts.get('b')).toBe(1)
  })

  test('roomVoteCounts: переголосование по той же карте не удваивает счёт', async () => {
    const db = await freshDb()
    await createRoom(db, { id: 'CNT002', steamid: 'a' }, NOW)
    await joinRoom(db, 'CNT002', 'a', 'A', NOW)
    await castRoomVote(db, 'CNT002', 'a', 570, 0, NOW)
    await castRoomVote(db, 'CNT002', 'a', 570, 1, NOW + 1)
    expect((await roomVoteCounts(db, 'CNT002')).get('a')).toBe(1)
  })

  test('roomVoteCounts не смешивает комнаты', async () => {
    const db = await freshDb()
    await createRoom(db, { id: 'CNT003', steamid: 'a' }, NOW)
    await createRoom(db, { id: 'CNT004', steamid: 'a' }, NOW)
    await joinRoom(db, 'CNT003', 'a', 'A', NOW)
    await joinRoom(db, 'CNT004', 'a', 'A', NOW)
    await castRoomVote(db, 'CNT003', 'a', 570, 1, NOW)
    await castRoomVote(db, 'CNT004', 'a', 620, 1, NOW)
    await castRoomVote(db, 'CNT004', 'a', 730, 1, NOW)

    expect((await roomVoteCounts(db, 'CNT003')).get('a')).toBe(1)
    expect((await roomVoteCounts(db, 'CNT004')).get('a')).toBe(2)
    expect([...(await roomVoteCounts(db, 'NOSUCH')).keys()]).toEqual([])
  })

  test('roomVotes отдаёт все голоса комнаты одним запросом', async () => {
    const db = await freshDb()
    await createRoom(db, { id: 'VOT001', steamid: 'a' }, NOW)
    await createRoom(db, { id: 'VOT002', steamid: 'a' }, NOW)
    await joinRoom(db, 'VOT001', 'a', 'A', NOW)
    await joinRoom(db, 'VOT001', 'b', 'B', NOW)
    await castRoomVote(db, 'VOT001', 'a', 570, 1, NOW)
    await castRoomVote(db, 'VOT001', 'b', 570, 0, NOW + 1)
    await castRoomVote(db, 'VOT002', 'a', 620, 1, NOW + 2)

    const rows = await roomVotes(db, 'VOT001')
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.steamid === 'a')).toEqual({
      steamid: 'a',
      appid: 570,
      vote: 1,
      createdAt: NOW,
    })
    expect(rows.find((r) => r.steamid === 'b')?.vote).toBe(0)
    // соседняя комната не подмешивается
    expect((await roomVotes(db, 'VOT002')).map((r) => r.appid)).toEqual([620])
  })

  test('размер колоды — свойство комнаты, а не участника', async () => {
    // rotationSlot берёт id комнаты, а не steamid, поэтому колода у всех
    // участников одна и та же: знаменатель «12 из 20» принадлежит комнате
    const db = await freshDb()
    await createRoom(db, { id: 'DCK001', steamid: 'a' }, NOW)
    const fresh = await getRoom(db, 'DCK001')
    expect(fresh?.deckRound).toBe(0)
    expect(fresh?.deckSize).toBeNull()

    await setRoomDeckSize(db, 'DCK001', 18)
    expect((await getRoom(db, 'DCK001'))?.deckSize).toBe(18)
  })

  test('раунд колоды поднимается один раз и работает на всю комнату', async () => {
    // Добор карт не может быть личным делом: findRoomMatch считает единогласие
    // по ВСЕМ участникам, и карта, которую видел только я, не даст матча
    // никогда. Поэтому раунд живёт на комнате.
    const db = await freshDb()
    await createRoom(db, { id: 'RND001', steamid: 'a' }, NOW)
    expect((await getRoom(db, 'RND001'))?.deckRound).toBe(0)

    expect(await advanceRoomDeckRound(db, 'RND001', 1)).toBe(1)
    expect((await getRoom(db, 'RND001'))?.deckRound).toBe(1)
  })

  test('двое нажали «ещё» одновременно — раунд не проскакивает', async () => {
    // Проигравший гонку не поднимает раунд второй раз, а читает ту же партию
    const db = await freshDb()
    await createRoom(db, { id: 'RND002', steamid: 'a' }, NOW)
    await advanceRoomDeckRound(db, 'RND002', 1)
    expect(await advanceRoomDeckRound(db, 'RND002', 1)).toBe(1)
    expect((await getRoom(db, 'RND002'))?.deckRound).toBe(1)
  })

  test('раунд не откатывается назад', async () => {
    const db = await freshDb()
    await createRoom(db, { id: 'RND003', steamid: 'a' }, NOW)
    await advanceRoomDeckRound(db, 'RND003', 2)
    expect(await advanceRoomDeckRound(db, 'RND003', 1)).toBe(2)
  })

  test('миграция: старая таблица rooms получает deck_round и deck_size', async () => {
    // Столбец, добавленный только в SCHEMA, на живой базе не появится:
    // CREATE TABLE IF NOT EXISTS — no-op. Тесты на свежей :memory: этого не
    // видят, поэтому проверяем именно старую форму таблицы
    const db = createClient({ url: ':memory:' })
    await db.executeMultiple(`CREATE TABLE rooms (
      id TEXT PRIMARY KEY,
      created_by TEXT NOT NULL,
      mood_json TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      matched_appid INTEGER,
      created_at INTEGER NOT NULL
    );`)
    await db.execute(
      "INSERT INTO rooms (id, created_by, status, created_at) VALUES ('OLD001', 'a', 'open', 1)",
    )
    const migrated = await migrateDb(db)

    const room = await getRoom(migrated, 'OLD001')
    expect(room?.deckRound).toBe(0)
    expect(room?.deckSize).toBeNull()
    await setRoomDeckSize(migrated, 'OLD001', 20)
    expect((await getRoom(migrated, 'OLD001'))?.deckSize).toBe(20)
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

  test('listBanned отдаёт свежие сверху и по одной строке на игру', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'banned' }, NOW)
    // тот же бан вторым нажатием — logFeedback только добавляет строки
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'banned' }, NOW + 5)
    await logFeedback(db, { steamid: 'u1', appid: 620, action: 'banned' }, NOW + 100)
    await logFeedback(db, { steamid: 'u1', appid: 730, action: 'liked' }, NOW + 200)
    await logFeedback(db, { steamid: 'u2', appid: 999, action: 'banned' }, NOW + 300)

    expect(await listBanned(db, 'u1')).toEqual([
      { appid: 620, at: NOW + 100 },
      { appid: 570, at: NOW + 5 },
    ])
    expect(await listBanned(db, 'nobody')).toEqual([])
  })

  test('listBanned детерминирован, когда баны попали в одну секунду', async () => {
    // На /play бан в одном клике от выдачи — три игры подряд за секунду это
    // норма, а created_at секундный. Без тай-брейка полка тасовалась бы на
    // каждом router.refresh()
    const db = await freshDb()
    for (const appid of [900, 100, 500]) {
      await logFeedback(db, { steamid: 'u1', appid, action: 'banned' }, NOW)
    }
    const once = await listBanned(db, 'u1')
    expect(once.map((b) => b.appid)).toEqual([100, 500, 900])
    expect(await listBanned(db, 'u1')).toEqual(once)
  })

  test('unbanGame снимает запрет и не трогает остальную историю', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'banned' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'banned' }, NOW + 5)
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'liked' }, NOW + 10)
    await logFeedback(db, { steamid: 'u1', appid: 620, action: 'banned' }, NOW + 20)
    await logFeedback(db, { steamid: 'u2', appid: 570, action: 'banned' }, NOW + 30)

    await unbanGame(db, 'u1', 570)

    // ушли ОБЕ строки бана, но лайк на месте — иначе снятие бана переписывало бы
    // вкус, а оно про запрет, а не про вкус
    expect([...(await bannedAppids(db, 'u1'))]).toEqual([620])
    expect((await listFeedback(db, 'u1', 50)).some((f) => f.appid === 570 && f.action === 'liked')).toBe(
      true,
    )
    // чужой бан не задет
    expect([...(await bannedAppids(db, 'u2'))]).toEqual([570])
  })

  test('unbanGame на несуществующем бане молчит', async () => {
    const db = await freshDb()
    await expect(unbanGame(db, 'u1', 12_345)).resolves.toBeUndefined()
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

describe('getNewsBlocks', () => {
  test('отдаёт тело по паре appid+gid', async () => {
    const db = await freshDb()
    await upsertNewsItems(db, [newsItem()], NOW)
    expect(await getNewsBlocks(db, 730, '1')).toEqual(NEWS_BASE.blocks)
  })

  test('чужой gid и чужая игра — это null, а не тело соседа', async () => {
    // Маршрут /api/news публичный, и пара приезжает из адресной строки.
    const db = await freshDb()
    await upsertNewsItems(db, [newsItem()], NOW)
    expect(await getNewsBlocks(db, 730, '2')).toBeNull()
    expect(await getNewsBlocks(db, 570, '1')).toBeNull()
  })

  test('битый блоб читается как «нечего показать», а не роняет ответ', async () => {
    const db = await freshDb()
    await upsertNewsItems(db, [newsItem()], NOW)
    await db.execute({
      sql: 'UPDATE news_items SET blocks_json = ? WHERE appid = 730 AND gid = ?',
      args: ['{не json', '1'],
    })
    expect(await getNewsBlocks(db, 730, '1')).toBeNull()
  })
})

describe('removeRoomMember', () => {
  /** Комната с уже вошедшими участниками: createRoom только заводит строку. */
  async function room(db: Db, id: string, members: string[]) {
    await createRoom(db, { id, steamid: members[0]! }, NOW)
    for (const m of members) await joinRoom(db, id, m, m.toUpperCase(), NOW)
  }

  test('участник уходит вместе со своими голосами', async () => {
    // Голоса обязаны уйти: findRoomMatch считает знаменатель по участникам, а
    // числитель по разным steamid среди голосов. Оставленный голос ушедшего
    // дал бы матч, за который никто из оставшихся не голосовал.
    const db = await freshDb()
    await room(db, 'ROOM01', ['a', 'b'])
    await castRoomVote(db, 'ROOM01', 'a', 10, 1, NOW)
    await castRoomVote(db, 'ROOM01', 'b', 10, 1, NOW)

    expect(await removeRoomMember(db, 'ROOM01', 'b')).toBe(true)
    expect((await roomMembers(db, 'ROOM01')).map((m) => m.steamid)).toEqual(['a'])
    expect((await roomVotes(db, 'ROOM01')).map((v) => v.steamid)).toEqual(['a'])
  })

  test('повторный вызов безобиден', async () => {
    const db = await freshDb()
    await room(db, 'ROOM02', ['a'])
    expect(await removeRoomMember(db, 'ROOM02', 'a')).toBe(true)
    expect(await removeRoomMember(db, 'ROOM02', 'a')).toBe(false)
  })

  test('ушедший перестаёт держать единогласие', async () => {
    // Тот самый случай: третий вошёл, закрыл вкладку и запер комнату.
    const db = await freshDb()
    await room(db, 'ROOM03', ['a', 'b', 'c'])
    await castRoomVote(db, 'ROOM03', 'a', 10, 1, NOW)
    await castRoomVote(db, 'ROOM03', 'b', 10, 1, NOW)

    expect(await findRoomMatch(db, 'ROOM03')).toBeNull()
    await removeRoomMember(db, 'ROOM03', 'c')
    expect(await findRoomMatch(db, 'ROOM03')).toBe(10)
  })

  test('голос, опоздавший к уходу, не подменяет собой живого участника', async () => {
    // Гонка: между проверкой членства в /api/room/[id]/vote и самой вставкой
    // лежит обход Turso, и уборка успевает вклиниться. Голос вставляется уже
    // после неё — в room_votes остаётся строка того, кого в комнате нет.
    //
    // Знаменатель считается по составу, числитель — по голосам. Без JOIN
    // призрак ПОДМЕНЯЕТ живого: комната из двоих получает матч на игре,
    // которую второй отклонил.
    const db = await freshDb()
    await room(db, 'ROOM05', ['a', 'b', 'c'])
    await castRoomVote(db, 'ROOM05', 'a', 100, 1, NOW)
    await castRoomVote(db, 'ROOM05', 'b', 100, 0, NOW) // b против

    await removeRoomMember(db, 'ROOM05', 'c')
    expect(await findRoomMatch(db, 'ROOM05')).toBeNull()

    // Опоздавший голос c уже после уборки
    await castRoomVote(db, 'ROOM05', 'c', 100, 1, NOW + 1)
    expect(await findRoomMatch(db, 'ROOM05')).toBeNull()
  })

  test('осиротевший голос не даёт матча и на карте, которую живой не видел', async () => {
    // Числитель смотрит только на vote = 1, строк «против» не существует для
    // него вовсе. Значит призрак плюс один живой «да» дают матч и там, где
    // второй просто не дошёл до карточки.
    const db = await freshDb()
    await room(db, 'ROOM06', ['a', 'b', 'c'])
    await castRoomVote(db, 'ROOM06', 'a', 200, 1, NOW)
    await removeRoomMember(db, 'ROOM06', 'c')
    await castRoomVote(db, 'ROOM06', 'c', 200, 1, NOW + 1) // опоздавший

    expect(await findRoomMatch(db, 'ROOM06')).toBeNull()
  })

  test('уборка участника идёт одной пачкой — половины не остаётся', async () => {
    const db = await freshDb()
    await room(db, 'ROOM07', ['a', 'b'])
    await castRoomVote(db, 'ROOM07', 'b', 300, 1, NOW)
    expect(await removeRoomMember(db, 'ROOM07', 'b')).toBe(true)
    expect((await roomVotes(db, 'ROOM07')).length).toBe(0)
    expect((await roomMembers(db, 'ROOM07')).length).toBe(1)
  })

  test('матч не переписывается вторым запросом', async () => {
    // Матч терминален: обратного перехода в open нет, а экран останавливает
    // опрос. Подменять людям результат под руками нельзя даже опоздавшему.
    const db = await freshDb()
    await room(db, 'ROOM08', ['a', 'b'])
    await setRoomMatched(db, 'ROOM08', 111)
    await setRoomMatched(db, 'ROOM08', 222)
    expect((await getRoom(db, 'ROOM08'))?.matchedAppid).toBe(111)
  })
  test('матч не собирается из голосов ушедшего', async () => {
    const db = await freshDb()
    await room(db, 'ROOM04', ['a', 'b', 'c'])
    await castRoomVote(db, 'ROOM04', 'a', 10, 1, NOW)
    await castRoomVote(db, 'ROOM04', 'c', 10, 1, NOW)

    // Уходит «c», чей голос и составлял пару с «a». Оставшиеся a и b за эту
    // игру вдвоём не голосовали — матча быть не должно.
    await removeRoomMember(db, 'ROOM04', 'c')
    expect(await findRoomMatch(db, 'ROOM04')).toBeNull()
  })
})
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

  test('rank отражает текущее состояние каталога, а не максимум за историю', async () => {
    // вес считается из games одинаково для любого опроса, поэтому свежее
    // значение всегда вернее: игра, умершая после попадания в ленту, должна
    // из неё выпасть, а не застрять навсегда
    const db = await freshDb()
    await upsertNewsItems(db, [newsItem()], NOW)
    expect((await getGameNews(db, 730))[0].rank).toBe(5000)
    await upsertNewsItems(db, [newsItem({ rank: 0 })], NOW + 1)
    expect((await getGameNews(db, 730))[0].rank).toBe(0)
    expect(await getMajorFeed(db)).toEqual([])
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

  test('порог популярности отсекает мелкие игры, но только когда его просят', async () => {
    const db = await freshDb()
    await upsertNewsItems(
      db,
      [
        newsItem({ appid: 730, title: 'Гигант', rank: 50_000 }),
        newsItem({ appid: 570, title: 'Ровно порог', rank: 10_000, publishedAt: NOW - 10 }),
        newsItem({ appid: 440, title: 'Мелочь', rank: 9_999, publishedAt: NOW - 20 }),
      ],
      NOW,
    )
    expect((await getMajorFeed(db, 30, { minRank: 10_000 })).map((n) => n.title)).toEqual([
      'Гигант',
      'Ровно порог',
    ])
    // Без опций лента прежняя. Это сторож против «а давайте сделаем порог
    // умолчанием»: гостевая лента и вкладка — одно и то же место, но решение о
    // том, кто считается популярным, принимает страница.
    expect(await getMajorFeed(db)).toHaveLength(3)
  })

  test('порог не отбирает у ленты частичный индекс', async () => {
    // Схлопнуть `rank > 0 AND rank >= ?` в одно условие — значит превратить
    // ленту в скан всей таблицы с сортировкой во временном B-дереве: вывести
    // rank > 0 из параметра SQLite не может. Больше этого не поймает никто —
    // noscan смотрит только на FROM games, а LIMIT в запросе на месте.
    const db = await freshDb()
    let issued = ''
    const spy = {
      execute: (q: InStatement) => {
        issued = typeof q === 'string' ? q : q.sql
        return db.execute(q)
      },
    } as unknown as Db

    await getMajorFeed(spy, 30, { minRank: 10_000 })

    const plan = await db.execute({
      sql: `EXPLAIN QUERY PLAN ${issued}`,
      args: [10_000, 2_000_000_000, 120],
    })
    const detail = plan.rows.map((r) => String(r.detail)).join(' | ')
    expect(detail).toContain('idx_news_feed')
    expect(detail).not.toContain('SCAN')
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

  test('gone выпадает из очереди', async () => {
    const db = await freshDb()
    await enrollNewsPoll(db, [730], 1, NOW)
    await flushPollResults(db, [{ appid: 730, status: 'gone', nextAt: NOW, failCount: 3 }], NOW)
    expect(await claimNewsPollBatch(db, NOW + 99999, 10)).toEqual([])
  })

  test('но не насовсем: через месяц похороненная игра возвращается', async () => {
    // три отказа подряд чаще означают закрывшийся от нас Steam, чем мёртвую
    // игру. Причина временная — значит и отметка не может быть вечной
    const db = await freshDb()
    await enrollNewsPoll(db, [730], 1, NOW)
    await flushPollResults(db, [{ appid: 730, status: 'gone', nextAt: NOW, failCount: 3 }], NOW)

    const later = NOW + 31 * 86_400
    expect(await reviveGoneNewsPoll(db, later - 30 * 86_400, later)).toBe(1)

    const batch = await claimNewsPollBatch(db, later + 99999, 10)
    expect(batch.map((t) => t.appid)).toEqual([730])
    // счётчик обнулён, иначе воскресшая игра умрёт с первого же отказа
    expect(batch[0]!.failCount).toBe(0)
  })

  test('свежепохороненную не трогаем — порог по last_at', async () => {
    const db = await freshDb()
    await enrollNewsPoll(db, [730], 1, NOW)
    await claimNewsPollBatch(db, NOW + 4000, 10) // проставляет last_at
    await flushPollResults(db, [{ appid: 730, status: 'gone', nextAt: NOW, failCount: 3 }], NOW)

    const soon = NOW + 5 * 86_400
    expect(await reviveGoneNewsPoll(db, soon - 30 * 86_400, soon)).toBe(0)
    expect(await claimNewsPollBatch(db, soon + 99999, 10)).toEqual([])
  })

  test('живые статусы воскрешение не задевает', async () => {
    const db = await freshDb()
    await enrollNewsPoll(db, [730, 570], 1, NOW)
    await flushPollResults(
      db,
      [{ appid: 730, status: 'error', nextAt: NOW, failCount: 2 }],
      NOW,
    )
    const later = NOW + 90 * 86_400
    expect(await reviveGoneNewsPoll(db, later - 30 * 86_400, later)).toBe(0)
    // и счётчик отказов у живой игры остался нетронутым
    const batch = await claimNewsPollBatch(db, later + 99999, 10)
    expect(batch.find((t) => t.appid === 730)!.failCount).toBe(2)
  })

  /** Три игры, у одной два патча: проверяем и порядок, и схлопывание по играм */
  async function seedFeed(db: Db) {
    await upsertNewsItems(
      db,
      [
        newsItem({ appid: 730, gid: 'свежий', publishedAt: NOW, rank: 50_000 }),
        newsItem({ appid: 730, gid: 'старый', publishedAt: NOW - 100, rank: 50_000 }),
        newsItem({ appid: 570, gid: '1', publishedAt: NOW - 200, rank: 20_000 }),
        newsItem({ appid: 440, gid: '1', publishedAt: NOW - 300, rank: 5_000 }),
      ],
      NOW,
    )
  }

  test('голова ленты отдаёт те же ключи в том же порядке, что и лента', async () => {
    // Краеугольный инвариант всей плашки «N новых»: если голова и лента
    // расходятся хоть на одну строку, число на плашке — вымысел.
    const db = await freshDb()
    await seedFeed(db)
    const full = await getMajorFeed(db, 30)
    expect(full.map((f) => f.gid)).toEqual(['свежий', '1', '1'])
    const head = await getMajorFeedHead(db, 30)
    expect(head.map((h) => `${h.appid}:${h.gid}`)).toEqual(full.map((f) => `${f.appid}:${f.gid}`))
    expect(head.map((h) => h.publishedAt)).toEqual(full.map((f) => f.publishedAt))
  })

  test('голова личной ленты — зеркало getFeedForApps', async () => {
    const db = await freshDb()
    await seedFeed(db)
    const ids = [730, 570, 440]
    const full = await getFeedForApps(db, ids, 30)
    const head = await getFeedHeadForApps(db, ids, 30)
    expect(head.map((h) => `${h.appid}:${h.gid}`)).toEqual(full.map((f) => `${f.appid}:${f.gid}`))
  })

  test('порог популярности действует на голову так же, как на ленту', async () => {
    const db = await freshDb()
    await seedFeed(db)
    const full = await getMajorFeed(db, 30, { minRank: 10_000 })
    const head = await getMajorFeedHead(db, 30, { minRank: 10_000 })
    expect(head.map((h) => h.appid)).toEqual(full.map((f) => f.appid))
  })

  test('голова не таскает тела патчей', async () => {
    // страж от «упрощения» головы обратно до NEWS_COLS: тогда каждый опрос
    // снова начнёт возить тела тридцати патчей на каждую открытую вкладку
    const db = await freshDb()
    await seedFeed(db)
    const head = await getMajorFeedHead(db, 30)
    expect(Object.keys(head[0]!).sort()).toEqual(['appid', 'gid', 'publishedAt'])
  })

  test('пустой список игр — пустая голова', async () => {
    const db = await freshDb()
    expect(await getFeedHeadForApps(db, [], 30)).toEqual([])
    expect(await getFeedHeadForApps(db, [-101], 30)).toEqual([])
  })

  test('аренда Steam: второй претендент не входит, пока первый её держит', async () => {
    const db = await freshDb()
    expect(await acquireLease(db, STEAM_LEASE, 'news:a', 75, NOW)).toBe(true)
    expect(await acquireLease(db, STEAM_LEASE, 'pages:b', 75, NOW)).toBe(false)
  })

  test('пересказы и Steam не мешают друг другу — ключи разные', async () => {
    // Ради этого крон пересказов и отделён: в Steam он не ходит вовсе, и
    // запрещать опросу работать одновременно было бы не за что
    const db = await freshDb()
    expect(await acquireLease(db, STEAM_LEASE, 'news:a', 75, NOW)).toBe(true)
    expect(await acquireLease(db, DIGEST_LEASE, 'digest:b', 75, NOW)).toBe(true)
  })

  test('но две цепочки пересказов друг друга не пускают — иначе платим дважды', async () => {
    // getUnsummarized не резервирует строки: параллельные фазы возьмут одни
    // и те же записи и оплатят их у модели по два раза
    const db = await freshDb()
    expect(await acquireLease(db, DIGEST_LEASE, 'digest:a', 75, NOW)).toBe(true)
    expect(await acquireLease(db, DIGEST_LEASE, 'digest:b', 75, NOW)).toBe(false)
  })

  test('аренда реентерабельна: звено цепочки продлевает свою же', async () => {
    const db = await freshDb()
    await acquireLease(db, STEAM_LEASE, 'news:a', 75, NOW)
    expect(await acquireLease(db, STEAM_LEASE, 'news:a', 75, NOW + 40)).toBe(true)
  })

  test('протухшую аренду забирает следующий — убитый инстанс не держит вечно', async () => {
    const db = await freshDb()
    await acquireLease(db, STEAM_LEASE, 'news:a', 75, NOW)
    expect(await acquireLease(db, STEAM_LEASE, 'pages:b', 75, NOW + 74)).toBe(false)
    expect(await acquireLease(db, STEAM_LEASE, 'pages:b', 75, NOW + 76)).toBe(true)
  })

  test('отданную аренду сразу берёт другой', async () => {
    const db = await freshDb()
    await acquireLease(db, STEAM_LEASE, 'news:a', 75, NOW)
    await releaseLease(db, STEAM_LEASE, 'news:a')
    expect(await acquireLease(db, STEAM_LEASE, 'pages:b', 75, NOW)).toBe(true)
  })

  test('чужую аренду отдать нельзя', async () => {
    const db = await freshDb()
    await acquireLease(db, STEAM_LEASE, 'news:a', 75, NOW)
    await releaseLease(db, STEAM_LEASE, 'pages:b')
    expect(await acquireLease(db, STEAM_LEASE, 'pages:b', 75, NOW)).toBe(false)
  })

  test('каталог не голодает за большой библиотекой', async () => {
    const db = await freshDb()
    // библиотека приезжает целиком и раньше каталога: enrollNewsPoll разносит
    // next_at по appid, поэтому мелкие appid встают в очередь первыми
    await enrollNewsPoll(db, Array.from({ length: 200 }, (_, i) => i + 1), 0, NOW)
    await enrollNewsPoll(db, [900_001, 900_002, 900_003, 900_004, 900_005, 900_006], 1, NOW)

    const batch = await claimNewsPollBatch(db, NOW + 99999, 10)
    expect(batch).toHaveLength(10)
    const fromCatalog = batch.filter((t) => t.tier === 1)
    // доля 0.6 от десяти — шесть мест, и все шесть каталожных игр их занимают
    expect(fromCatalog).toHaveLength(6)
  })

  test('невыбранная доля каталога достаётся библиотеке — пачка не полупустая', async () => {
    const db = await freshDb()
    await enrollNewsPoll(db, Array.from({ length: 50 }, (_, i) => i + 1), 0, NOW)
    await enrollNewsPoll(db, [900_001], 1, NOW)

    const batch = await claimNewsPollBatch(db, NOW + 99999, 10)
    expect(batch).toHaveLength(10)
    expect(batch.filter((t) => t.tier === 1)).toHaveLength(1)
    // и без дублей: добор не должен вернуть то, что уже взято по доле
    expect(new Set(batch.map((t) => t.appid)).size).toBe(10)
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

describe('лента не даёт одной игре себя захватить', () => {
  test('в общей ленте не больше одного патча на игру', async () => {
    // Valve выкатывает движковый апдейт разом во всю линейку, Warhammer
    // патчится через день — без схлопывания лента становится их списком
    const db = await freshDb()
    await upsertNewsItems(
      db,
      [
        ...Array.from({ length: 6 }, (_, i) =>
          newsItem({ appid: 70, gid: `hl${i}`, title: `Half-Life ${i}`, publishedAt: NOW + i, bodyHash: `a${i}` }),
        ),
        newsItem({ appid: 730, gid: 'cs', title: 'CS2', publishedAt: NOW + 1, bodyHash: 'b' }),
      ],
      NOW,
    )
    const feed = await getMajorFeed(db, 10)
    expect(feed).toHaveLength(2)
    expect(new Set(feed.map((n) => n.appid)).size).toBe(2)
    // остаётся самый свежий патч игры
    expect(feed.find((n) => n.appid === 70)?.title).toBe('Half-Life 5')
  })

  test('на странице игры схлопывания нет — там вся история', async () => {
    const db = await freshDb()
    await upsertNewsItems(
      db,
      Array.from({ length: 6 }, (_, i) =>
        newsItem({ appid: 70, gid: `hl${i}`, publishedAt: NOW + i, bodyHash: `a${i}` }),
      ),
      NOW,
    )
    expect(await getGameNews(db, 70, 10)).toHaveLength(6)
  })
})

describe('мёртвые игры и общая лента', () => {
  async function seedGame(db: Awaited<ReturnType<typeof freshDb>>, appid: number, alive: number) {
    await upsertGameMeta(db, { ...META, appid, name: `Игра ${appid}`, reviewsTotal: 50_000 }, NOW)
    await db.execute({
      sql: 'UPDATE games SET alive = ?, tag_count = 3, superseded_by = NULL WHERE appid = ?',
      args: [alive, appid],
    })
  }

  test('вес получают только игры, прошедшие фильтры каталога', async () => {
    // HL2:Deathmatch проект метит alive = 0 и не показывает в рекомендациях —
    // в общей ленте ему тоже не место, хотя отзывов у него десятки тысяч
    const db = await freshDb()
    await seedGame(db, 730, 1)
    await seedGame(db, 320, 0)
    const ranks = await getGameRanks(db, [730, 320])
    expect(ranks.get(730)).toBeGreaterThan(0)
    expect(ranks.get(320)).toBe(0)
  })
})
