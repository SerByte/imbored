import { createClient, type InStatement } from '@libsql/client'
import { describe, expect, test, vi } from 'vitest'
import { buildTagProfile, cooldownOf, normalizedTags } from './recommend'
import { checkRate } from './ratelimit'
import {
  acquireLease,
  ADDED_COLUMNS,
  CURRENT_SCHEMA_V,
  destructiveMigrationsAllowed,
  PREVIEW_OWN_DB_ENV,
  advanceRoomDeckRound,
  bannedAppids,
  bannedAppidsOf,
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
  gamesMissingMedia,
  getGameNews,
  getGameRanks,
  getNewsBlocks,
  getNewsPage,
  getGamePatchHeads,
  getFeedHeadForApps,
  getMajorFeed,
  getMajorFeedHead,
  getUnsummarized,
  pruneNewsForApp,
  releaseLease,
  repairGameJson,
  removeRoomMember,
  reviveGoneNewsPoll,
  setGameDescriptions,
  setGamesMedia,
  setNewsDigest,
  sitemapNews,
  STEAM_LEASE,
  upsertNewsItems,
  type Db,
  type StoredNews,
  loadTagDictionary,
  loadTagNamesRu,
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
  getHeroMedia,
  parseIdList,
  parseSemantics,
  parseStrList,
  parseTagMap,
  upsertSemantics,
  getGamesMeta,
  getGamesMetaLite,
  getLatestSnapshot,
  getRoom,
  getStaleAppids,
  getUserPortrait,
  insertMissingGamesMeta,
  joinRoom,
  listBanned,
  listExplore,
  listExploreLiked,
  listLiked,
  countLiked,
  listFeedback,
  listPublicRooms,
  logFeedback,
  migrateDb,
  myVotedAppids,
  roomMembers,
  roomVoteCounts,
  roomVotes,
  saveLibrarySnapshot,
  fillOutcomesFromSnapshot,
  pendingOutcomeAsk,
  recordOutcome,
  recordCompatView,
  createSharedPick,
  findSharedPick,
  getSharedPick,
  listCompatViews,
  COMPAT_VIEW_TTL_SEC,
  setOutcomeVerdict,
  setRoomDeckSize,
  setGameJson,
  setRoomMatched,
  setRoomPublic,
  setUserPortrait,
  stalePriceAppids,
  unbanGame,
  unlikeGame,
  updateGamePrices,
  topCatalogGames,
  topGamesByTags,
  upsertGameMeta,
  upsertGamesMeta,
  upsertUser,
  getDailyPick,
  saveDailyPick,
  sweepDailyPicks,
  forgetDailyPick,
  topCatalogAppids,
  countUserRows,
  createSession,
  FORGET_TABLES,
  forgetUser,
  issueRoomDeck,
  castDeckVote,
  sweepStale,
  getSessionState,
  revokeSession,
  DEMO_TTL_SEC,
  FEEDBACK_CTX_TTL_SEC,
  listEvenings,
} from './db'
import { seedDemo } from './demo'
import { SHARED_PICK_TTL_SEC } from './sharedpick'
import { FEEDBACK_ACTIONS } from './feedbackkinds'
import { OUTCOME_TTL_SEC, OUTCOME_WINDOW_SEC } from './outcome'
import { OTHER_STORE_GAMES } from './otherstores'
import { deriveSemantics } from './semantics'
import { SESSION_TOUCH_AFTER_SEC } from './sessions'
import type { GameMeta, GameSemantics, LibraryGame } from './types'

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

  describe('трейлер и кадры', () => {
    const TRAILER = {
      mp4: 'https://video.akamai.steamstatic.com/store_trailers/620/1/h/2/microtrailer.mp4',
      webm: 'https://video.akamai.steamstatic.com/store_trailers/620/1/h/2/microtrailer.webm',
      poster: 'https://shared.steamstatic.com/store_item_assets/steam/apps/9/movie_full.jpg?t=1',
    }

    test('трейлер пишется апсертом и читается полной выборкой, узкая его не тащит', async () => {
      const db = await freshDb()
      await upsertGameMeta(db, { ...META, trailer: TRAILER }, NOW)
      expect((await getGameMeta(db, 620))?.trailer).toEqual(TRAILER)
      expect((await getGamesMeta(db, [620])).get(620)?.trailer).toEqual(TRAILER)
      expect((await getGamesMetaLite(db, [620])).get(620)).not.toHaveProperty('trailer')
    })

    test('запись без трейлера — прогрев, appdetails — привезённый не стирает', async () => {
      const db = await freshDb()
      await upsertGameMeta(db, { ...META, trailer: TRAILER }, NOW)
      await upsertGameMeta(db, { ...META, name: 'Portal 2 (новое имя)' }, NOW + 1)
      const after = await getGameMeta(db, 620)
      expect(after?.name).toBe('Portal 2 (новое имя)')
      expect(after?.trailer).toEqual(TRAILER)
    })

    test('чужой хост в колонке — трейлера нет, а не <video> с чужой ссылкой', async () => {
      const db = await freshDb()
      await upsertGameMeta(db, META, NOW)
      await db.execute({
        sql: 'UPDATE games SET trailer_json = ? WHERE appid = 620',
        args: [JSON.stringify({ mp4: 'https://evil.example/x.mp4' })],
      })
      expect((await getGameMeta(db, 620))?.trailer).toBeUndefined()
      expect((await getHeroMedia(db, [620])).get(620)).toEqual({ screenshots: META.screenshots })
    })

    test('getHeroMedia: кадры и трейлер героям; игра с одним трейлером тоже герой', async () => {
      const db = await freshDb()
      await upsertGameMeta(db, { ...META, trailer: TRAILER }, NOW)
      await upsertGameMeta(db, { ...META, appid: 730, screenshots: undefined, trailer: TRAILER }, NOW)
      await upsertGameMeta(db, { ...META, appid: 570, screenshots: undefined }, NOW)
      const media = await getHeroMedia(db, [620, 730, 570])
      expect(media.get(620)).toEqual({ screenshots: META.screenshots, trailer: TRAILER })
      expect(media.get(730)).toEqual({ screenshots: [], trailer: TRAILER })
      expect(media.has(570)).toBe(false)
    })

    test('setGamesMedia пишет две колонки, пустое не затирает, updated_at не двигает', async () => {
      const db = await freshDb()
      await upsertGameMeta(db, { ...META, reviewsTotal: 10 }, NOW)
      await upsertGameMeta(db, { ...META, appid: 730, screenshots: undefined, reviewsTotal: 20 }, NOW)
      const shots = ['https://shared.steamstatic.com/store_item_assets/steam/apps/730/ss_a.1920x1080.jpg?t=1']

      const n = await setGamesMedia(db, [
        { appid: 730, screenshots: shots, trailer: TRAILER },
        // у 620 в ответе ничего — строку не трогаем вовсе
        { appid: 620 },
        // игры нет в games — не создаём
        { appid: 999, trailer: TRAILER },
      ])
      expect(n).toBe(1)
      const cs2 = await getGameMeta(db, 730)
      expect(cs2?.screenshots).toEqual(shots)
      expect(cs2?.trailer).toEqual(TRAILER)
      expect(await getGameMeta(db, 999)).toBeNull()

      // второй проход без трейлера и с пустыми кадрами прежнее не стирает
      await setGamesMedia(db, [{ appid: 730, screenshots: [] }])
      expect((await getGameMeta(db, 730))?.trailer).toEqual(TRAILER)
      expect((await getGameMeta(db, 730))?.screenshots).toEqual(shots)

      const r = await db.execute('SELECT updated_at FROM games WHERE appid = 730')
      expect(Number(r.rows[0].updated_at)).toBe(NOW)
      expect(await setGamesMedia(db, [])).toBe(0)
    })

    test('gamesMissingMedia: пул без трейлера или кадров, верх каталога первым', async () => {
      const db = await freshDb()
      await upsertGameMeta(db, { ...META, appid: 1, reviewsTotal: 10, trailer: TRAILER }, NOW)
      await upsertGameMeta(db, { ...META, appid: 2, reviewsTotal: 30 }, NOW)
      await upsertGameMeta(db, { ...META, appid: 3, reviewsTotal: 20, screenshots: [], trailer: TRAILER }, NOW)
      // не пул: без тегов — в выборку не попадает
      await upsertGameMeta(db, { ...META, appid: 4, reviewsTotal: 99, tags: {} }, NOW)
      expect(await gamesMissingMedia(db, 10)).toEqual([2, 3])
      expect(await gamesMissingMedia(db, 1)).toEqual([2])
    })
  })

  test('дважды закодированные теги читаются объектом, а не строкой', async () => {
    // Так лежит Dota 2 в живой базе: в tags_json JSON-строка, а в ней объект.
    // Голый JSON.parse отдавал строку, и профиль вкуса каждого владельца игры
    // становился NaN целиком
    const db = await freshDb()
    const tags = { 'Free to Play': 3010, MOBA: 1019 }
    await upsertGameMeta(db, { ...META, appid: 570, name: 'Dota 2', tags }, NOW)
    await db.execute({
      sql: `UPDATE games SET tags_json = ?, genres_json = ?, categories_json = ?
            WHERE appid = 570`,
      args: [
        JSON.stringify(JSON.stringify(tags)),
        JSON.stringify(JSON.stringify(['Strategy'])),
        JSON.stringify('[1,9]'),
      ],
    })

    for (const read of [getGamesMeta, getGamesMetaLite]) {
      const m = (await read(db, [570])).get(570)
      expect(m?.tags, read.name).toEqual(tags)
      expect(m?.genres, read.name).toEqual(['Strategy'])
      expect(m?.categories, read.name).toEqual([1, 9])
    }
    expect((await getGameMeta(db, 570))?.tags).toEqual(tags)
  })

  test('мусор в JSON-колонках читается пустотой: чтение не падает, профиль не NaN', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, { ...META, appid: 1 }, NOW)
    await upsertGameMeta(db, { ...META, appid: 2 }, NOW)
    await db.batch(
      [
        {
          sql: `UPDATE games SET tags_json = 'не json', genres_json = '{"a":1}',
                  categories_json = 'null', screenshots_json = '"x"' WHERE appid = 1`,
          args: [],
        },
        {
          // 1e400 разбирается в Infinity, строка и минус — не голоса
          sql: `UPDATE games SET tags_json = '{"Puzzle":100,"Str":"5","Neg":-1,"Inf":1e400,"Nil":null}',
                  categories_json = '[2,"9",null,38]' WHERE appid = 2`,
          args: [],
        },
      ],
      'write',
    )

    const metas = await getGamesMeta(db, [1, 2])
    expect(metas.get(1)).toMatchObject({ tags: {}, genres: [], categories: [], screenshots: [] })
    expect(metas.get(2)?.tags).toEqual({ Puzzle: 100 })
    expect(metas.get(2)?.categories).toEqual([2, 38])

    const profile = buildTagProfile(
      [
        { appid: 1, name: 'a', playtimeForever: 600, playtime2Weeks: 0 },
        { appid: 2, name: 'b', playtimeForever: 600, playtime2Weeks: 0 },
      ],
      (id) => metas.get(id),
    )
    expect(profile).toEqual({ Puzzle: normalizedTags(metas.get(2)!).Puzzle * Math.log1p(10) })
  })

  test('parseTagMap и списки: развернуть до объекта, оставить только годное', () => {
    const tags = { Roguelike: 900, Indie: 0 }
    expect(parseTagMap(JSON.stringify(tags))).toEqual(tags)
    expect(parseTagMap(JSON.stringify(JSON.stringify(tags)))).toEqual(tags)
    // тройная упаковка — тоже упаковка
    expect(parseTagMap(JSON.stringify(JSON.stringify(JSON.stringify(tags))))).toEqual(tags)
    for (const junk of ['', 'null', '[1,2]', '42', '"строка"', '{', null, undefined]) {
      expect(parseTagMap(junk), String(junk)).toEqual({})
    }

    expect(parseStrList('["Action",1,null,"RPG"]')).toEqual(['Action', 'RPG'])
    expect(parseStrList(JSON.stringify('["Action"]'))).toEqual(['Action'])
    expect(parseStrList('{"a":1}')).toEqual([])
    expect(parseIdList('[1,"9",9,1e400]')).toEqual([1, 9])
    expect(parseIdList(JSON.stringify('[1,9]'))).toEqual([1, 9])
    expect(parseIdList('битое')).toEqual([])
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

  test('апсерт без слияния не стирает скриншоты, жанры и русское описание', async () => {
    // Так писал в облако promote-catalog: GetItems без скриншотов и жанров,
    // описание английское, а в строке — результат обогащения карточки
    const db = await freshDb()
    await upsertGameMeta(db, META, NOW)
    await upsertGameMeta(
      db,
      {
        ...META,
        name: 'Portal 2 (upd)',
        genres: [],
        screenshots: undefined,
        shortDescription: 'Portal 2 draws from the award-winning formula',
      },
      NOW + 10,
    )
    const stored = await getGameMeta(db, 620)
    expect(stored?.name).toBe('Portal 2 (upd)')
    expect(stored?.genres).toEqual(['Puzzle'])
    expect(stored?.screenshots).toEqual(['https://example/620-1.jpg'])
    expect(stored?.shortDescription).toBe('Головоломка с порталами')

    // пустой список — тоже пустота, а не «кадров больше нет»
    await upsertGameMeta(db, { ...META, screenshots: [] }, NOW + 20)
    expect((await getGameMeta(db, 620))?.screenshots).toEqual(['https://example/620-1.jpg'])
  })

  test('непустое обогащение и русское поверх английского едут как прежде', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, { ...META, shortDescription: 'Portal 2 draws from', screenshots: undefined }, NOW)
    await upsertGameMeta(
      db,
      { ...META, genres: ['Головоломки'], screenshots: ['https://example/620-2.jpg'] },
      NOW + 10,
    )
    const stored = await getGameMeta(db, 620)
    expect(stored?.genres).toEqual(['Головоломки'])
    expect(stored?.screenshots).toEqual(['https://example/620-2.jpg'])
    expect(stored?.shortDescription).toBe('Головоломка с порталами')

    // английское английским — тоже
    await upsertGameMeta(db, { ...META, appid: 621, shortDescription: 'Old English' }, NOW)
    await upsertGameMeta(db, { ...META, appid: 621, shortDescription: 'New English' }, NOW + 10)
    expect((await getGameMeta(db, 621))?.shortDescription).toBe('New English')
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

  test('выборка по списку переживает библиотеку больше 32 766 игр', async () => {
    // Один плейсхолдер на игру упирался в потолок переменных SQLite: на 32 767
    // запрос падал с «too many SQL variables». У коллекционера Steam сорок
    // тысяч игр, и подбор, /library и портрет отвечали бы ему 500.
    const db = await freshDb()
    const appids = Array.from({ length: 40_000 }, (_, i) => 1000 + i)
    const art = { header: 'https://cdn/h.jpg' }
    await upsertGameMeta(db, { ...META, appid: 1000, name: 'Первая', art }, NOW)
    await upsertGameMeta(db, { ...META, appid: 40_999, name: 'Последняя', art }, NOW)

    for (const read of [getGamesMeta, getGamesMetaLite]) {
      const metas = await read(db, appids)
      expect(metas.get(1000)?.name, read.name).toBe('Первая')
      expect(metas.get(40_999)?.name, read.name).toBe('Последняя')
      expect(metas.size, read.name).toBe(2)
    }

    const stale = await getStaleAppids(db, appids, 14 * 86_400, NOW)
    expect(stale).toHaveLength(39_998)
    expect(stale).not.toContain(1000)

    // Цены обеих игр ни разу не мерились: обе в очереди, остальных в базе нет
    expect((await stalePriceAppids(db, appids, 3600, NOW)).sort((a, b) => a - b)).toEqual([
      1000, 40_999,
    ])
    expect((await getHeroMedia(db, appids)).size).toBe(2)
  })

  test('узкая выборка — та же игра без скриншотов, кадры читаются отдельно', async () => {
    const db = await freshDb()
    const full = { ...META, art: { header: 'https://cdn/h.jpg' }, ccu: 1200, ccuAt: NOW }
    await upsertGameMeta(db, full, NOW)
    await upsertGameMeta(db, { ...META, appid: 730, name: 'CS2', screenshots: undefined }, NOW)

    const { screenshots, ...withoutShots } = full
    expect((await getGamesMetaLite(db, [620])).get(620)).toEqual(withoutShots)
    // полная выборка по-прежнему несёт кадры — ими живёт герой игры дня
    expect((await getGamesMeta(db, [620])).get(620)?.screenshots).toEqual(screenshots)

    const shots = await getHeroMedia(db, [620, 730, 999])
    expect(shots.get(620)?.screenshots).toEqual(screenshots)
    // У игры без кадров и у отсутствующей — просто нет записи
    expect(shots.has(730)).toBe(false)
    expect(shots.has(999)).toBe(false)
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

  test('русские имена склеиваются по tagid и не стираются английским словарём', async () => {
    const db = await freshDb()
    await saveTagDictionary(
      db,
      new Map([[1, 'Roguelike'], [2, 'Indie'], [3, 'Dystopian ']]),
      // пробел в хвосте у Steam бывает и в русском имени — подпись без него
      new Map([[1, 'Рогалик'], [3, 'Антиутопия ']]),
    )
    expect(await loadTagNamesRu(db)).toEqual(
      new Map([['Roguelike', 'Рогалик'], ['Dystopian ', 'Антиутопия']]),
    )
    // ключ — английское имя как есть, с тем же пробелом, что в tags_json
    expect((await loadTagDictionary(db)).get(3)).toBe('Dystopian ')

    // промоут перезаписал один английский словарь — подписи остались
    await saveTagDictionary(db, new Map([[1, 'Roguelike'], [2, 'Indie']]))
    expect((await loadTagNamesRu(db)).get('Roguelike')).toBe('Рогалик')
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

  /** Строки, какими их находили в живой базе и какими они могут стать */
  async function insertBrokenJson(db: Db) {
    await upsertGameMeta(db, { ...META, appid: 570, name: 'Dota 2', tags: { MOBA: 3, Strategy: 2 } }, NOW)
    await upsertGameMeta(db, { ...META, appid: 3, name: 'Мусор', categories: [] }, NOW)
    await db.batch(
      [
        {
          // Дважды закодированные теги и жанры; tag_count врёт нарочно —
          // починка обязана пересчитать его, а не поверить
          sql: `UPDATE games SET tags_json = ?, genres_json = ?, tag_count = 99 WHERE appid = 570`,
          args: [
            JSON.stringify(JSON.stringify({ MOBA: 3, Strategy: 2 })),
            JSON.stringify(JSON.stringify(['Strategy'])),
          ],
        },
        {
          // Битый JSON и категории строкой: совместная игра, о которой SQL не знал
          sql: `UPDATE games SET tags_json = 'не json', categories_json = ?, is_multiplayer = 0
                WHERE appid = 3`,
          args: [JSON.stringify('[1,9]')],
        },
      ],
      'write',
    )
  }

  test('починка JSON-колонок: двойное разворачивается, мусор пустеет, производные пересчитаны', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, META, NOW)
    await insertBrokenJson(db)
    const byAppid = (r: { appid: number }[]) => [...r].sort((a, b) => a.appid - b.appid)

    // dryRun только считает: колонка остаётся строкой
    expect(byAppid(await repairGameJson(db, { dryRun: true }))).toEqual([
      { appid: 3, name: 'Мусор', tags: 0 },
      { appid: 570, name: 'Dota 2', tags: 2 },
    ])
    const still = await db.execute(`SELECT json_type(tags_json) t FROM games WHERE appid = 570`)
    expect(still.rows[0].t).toBe('text')

    expect(await repairGameJson(db)).toHaveLength(2)
    const rows = await db.execute(
      `SELECT appid, tags_json, genres_json, categories_json, tag_count, is_multiplayer
         FROM games ORDER BY appid`,
    )
    expect(rows.rows.map((r) => ({ ...r }))).toEqual([
      {
        appid: 3,
        tags_json: '{}',
        genres_json: '["Puzzle"]',
        categories_json: '[1,9]',
        tag_count: 0,
        is_multiplayer: 1,
      },
      {
        appid: 570,
        tags_json: '{"MOBA":3,"Strategy":2}',
        genres_json: '["Strategy"]',
        categories_json: '[2,9,38]',
        tag_count: 2,
        is_multiplayer: 1,
      },
      // Целая строка не тронута вовсе
      {
        appid: 620,
        tags_json: JSON.stringify(META.tags),
        genres_json: JSON.stringify(META.genres),
        categories_json: JSON.stringify(META.categories),
        tag_count: 2,
        is_multiplayer: 1,
      },
    ])
    // Второй проход чинить уже нечего
    expect(await repairGameJson(db)).toEqual([])
  })

  test('миграция чинит JSON-колонки один раз и ставит флаг', async () => {
    const db = await freshDb()
    await insertBrokenJson(db)
    await db.execute("DELETE FROM catalog_meta WHERE key = 'repair_tags_v1'")
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await migrateDb(db)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
        event: 'migrate-repaired',
        step: 'game-json',
        rows: 2,
      })
    } finally {
      warn.mockRestore()
    }
    expect(await getCatalogMeta(db, 'repair_tags_v1')).toBe('1')
    expect(await repairGameJson(db, { dryRun: true })).toEqual([])

    // Флаг стоит — следующий старт полнотабличный проход не повторяет
    await db.execute(`UPDATE games SET tags_json = '"{}"' WHERE appid = 570`)
    await migrateDb(db)
    expect(await repairGameJson(db, { dryRun: true })).toHaveLength(1)
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

  test('игра дня: сброс стирает выбор человека и не трогает чужой', async () => {
    // Бан и «надоела» отбор обязан учесть в тот же день — запись не должна
    // держать убранную игру героем до полуночи
    const db = await freshDb()
    await saveDailyPick(db, 'S1', '2026-08-19', { v: 1 }, NOW)
    await saveDailyPick(db, 'S2', '2026-08-19', { v: 2 }, NOW)
    await forgetDailyPick(db, 'S1')
    expect(await getDailyPick(db, 'S1', '2026-08-19')).toBeNull()
    expect(await getDailyPick(db, 'S2', '2026-08-19')).toEqual({ v: 2 })
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
    expect(await joinRoom(db, 'ABC123', 'host', 'Хост', NOW)).toBe('joined')
    expect(await joinRoom(db, 'ABC123', 'friend', 'Друг', NOW + 1)).toBe('joined')
    expect(await joinRoom(db, 'NOPE00', 'x', 'X', NOW)).toBe('notfound')
    const room = await getRoom(db, 'ABC123')
    expect(room?.status).toBe('open')
    expect(room?.mood?.social).toBe('friends')
    const members = await roomMembers(db, 'ABC123')
    expect(members.map((m) => m.steamid).sort()).toEqual(['friend', 'host'])
    // повторный вход не дублирует
    await joinRoom(db, 'ABC123', 'host', 'Хост', NOW + 2)
    expect(await roomMembers(db, 'ABC123')).toHaveLength(2)
  })

  test('в сматченную комнату новых не пускают, своих — пускают', async () => {
    const db = await freshDb()
    await createRoom(db, { id: 'MTC001', steamid: 'a' }, NOW)
    await joinRoom(db, 'MTC001', 'a', 'A', NOW)
    await joinRoom(db, 'MTC001', 'b', 'B', NOW)
    await setRoomMatched(db, 'MTC001', 570)

    expect(await joinRoom(db, 'MTC001', 'stranger', 'С доски', NOW + 1)).toBe('closed')
    expect(await joinRoom(db, 'MTC001', 'b', 'B', NOW + 1)).toBe('joined')
    expect((await roomMembers(db, 'MTC001')).map((m) => m.steamid)).toEqual(['a', 'b'])
  })

  test('порядок участников определён даже при совпавшей секунде входа', async () => {
    const db = await freshDb()
    await createRoom(db, { id: 'TIE001', steamid: 'zzz' }, NOW)
    // Ссылку прислали в чат разом — все трое вошли в одну и ту же секунду,
    // joined_at их не различает. Тест сторожит КОНТРАКТ, а не регрессию: он
    // проходит и без добивки в ORDER BY, потому что автоиндекс по
    // (room_id, steamid) сегодня отдаёт этот порядок сам (см. докблок
    // roomMembers). Проходить он обязан и после смены плана или ключа.
    for (const id of ['zzz', 'aaa', 'mmm']) await joinRoom(db, 'TIE001', id, undefined, NOW)

    const first = (await roomMembers(db, 'TIE001')).map((m) => m.steamid)
    expect(first).toEqual(['aaa', 'mmm', 'zzz'])
    // и он же при повторном чтении — порядок обязан быть воспроизводимым
    expect((await roomMembers(db, 'TIE001')).map((m) => m.steamid)).toEqual(first)

    // при разных секундах решает по-прежнему время входа, а не steamid
    await joinRoom(db, 'TIE001', 'aab', undefined, NOW + 5)
    expect((await roomMembers(db, 'TIE001')).map((m) => m.steamid)).toEqual([
      'aaa',
      'mmm',
      'zzz',
      'aab',
    ])
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

  test('голос из свайпа пишется только за карту, которую комнате раздавали', async () => {
    const db = await freshDb()
    await createRoom(db, { id: 'DCK001', steamid: 'a' }, NOW)
    await createRoom(db, { id: 'DCK002', steamid: 'a' }, NOW)
    await issueRoomDeck(db, 'DCK001', [570, 620])
    await issueRoomDeck(db, 'DCK002', [730])
    const vote = (roomId: string, appid: number) =>
      castDeckVote(db, { roomId, steamid: 'a', appid, vote: 1, legacy: false }, NOW)

    expect(await vote('DCK001', 620)).toBe(true)
    // произвольный appid — ни строки в room_votes
    expect(await vote('DCK001', 999_999)).toBe(false)
    // карта соседней комнаты — тоже чужая
    expect(await vote('DCK001', 730)).toBe(false)
    expect((await roomVotes(db, 'DCK001')).map((r) => r.appid)).toEqual([620])
    // размер колоды пишется той же пачкой
    expect((await getRoom(db, 'DCK001'))?.deckSize).toBe(2)
  })

  test('колода копится: карта из прежней выдачи остаётся голосуемой', async () => {
    // Колода пересобирается, когда входит новый участник, и карта, которую
    // кто-то уже держит в руке, из новой выдачи может выпасть
    const db = await freshDb()
    await createRoom(db, { id: 'DCK003', steamid: 'a' }, NOW)
    await issueRoomDeck(db, 'DCK003', [570, 620])
    await issueRoomDeck(db, 'DCK003', [620, 730])
    const vote = (appid: number) =>
      castDeckVote(db, { roomId: 'DCK003', steamid: 'a', appid, vote: 0, legacy: false }, NOW)
    expect(await vote(570)).toBe(true)
    expect(await vote(730)).toBe(true)
    // знаменатель — последняя выдача, а не объединение
    expect((await getRoom(db, 'DCK003'))?.deckSize).toBe(2)
  })

  test('переход: комната с колодой от старого кода голосует по-старому, пока нет строк', async () => {
    const db = await freshDb()
    await createRoom(db, { id: 'DCK004', steamid: 'a' }, NOW)
    const vote = (appid: number, legacy: boolean) =>
      castDeckVote(db, { roomId: 'DCK004', steamid: 'a', appid, vote: 1, legacy }, NOW)

    // Колоды не выдавали вовсе — голосовать не за что
    expect(await vote(570, false)).toBe(false)
    // Старый код выставил deck_size, а строк не писал: принимаем как раньше
    expect(await vote(570, true)).toBe(true)
    // Первая же выдача новым кодом переводит комнату на строгое правило
    await issueRoomDeck(db, 'DCK004', [620])
    expect(await vote(730, true)).toBe(false)
    expect(await vote(620, true)).toBe(true)
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

  test('миграция: CHECK без launched пересобирается, id сохраняются, launched принимается', async () => {
    const db = createClient({ url: ':memory:' })
    await db.executeMultiple(`CREATE TABLE feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      steamid TEXT NOT NULL,
      appid INTEGER NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('liked','skipped','opened','banned')),
      reason TEXT,
      mood_json TEXT,
      created_at INTEGER NOT NULL
    );`)
    await db.execute(
      "INSERT INTO feedback (id, steamid, appid, action, reason, created_at) VALUES (7, 'u1', 620, 'skipped', 'notnow', 1)",
    )
    await db.execute(
      "INSERT INTO feedback (id, steamid, appid, action, created_at) VALUES (42, 'u1', 570, 'banned', 2)",
    )
    const migrated = await migrateDb(db)
    await logFeedback(migrated, { steamid: 'u1', appid: 730, action: 'launched' }, NOW)

    const ids = await migrated.execute('SELECT id, action, reason FROM feedback ORDER BY id')
    expect(ids.rows.map((r) => [Number(r.id), r.action, r.reason])).toEqual([
      [7, 'skipped', 'notnow'],
      [42, 'banned', null],
      // AUTOINCREMENT продолжает с максимума, а не с единицы
      [43, 'launched', null],
    ])
    const index = await migrated.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_feedback_steamid'",
    )
    expect(index.rows).toHaveLength(1)
  })

  test('миграция: совсем старая схема без banned тоже принимает launched', async () => {
    const db = createClient({ url: ':memory:' })
    await db.executeMultiple(`CREATE TABLE feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      steamid TEXT NOT NULL,
      appid INTEGER NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('liked','skipped','opened')),
      mood_json TEXT,
      created_at INTEGER NOT NULL
    );`)
    const migrated = await migrateDb(db)
    await logFeedback(migrated, { steamid: 'u1', appid: 570, action: 'launched' }, NOW)
    await logFeedback(migrated, { steamid: 'u1', appid: 620, action: 'banned' }, NOW)
    expect((await listFeedback(migrated, 'u1')).map((r) => r.action).sort()).toEqual([
      'banned',
      'launched',
    ])
  })

  test('миграция фидбека идемпотентна: второй migrateDb ничего не пересобирает', async () => {
    const db = createClient({ url: ':memory:' })
    await db.executeMultiple(`CREATE TABLE feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      steamid TEXT NOT NULL,
      appid INTEGER NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('liked','skipped','opened','banned')),
      reason TEXT,
      mood_json TEXT,
      created_at INTEGER NOT NULL
    );`)
    await db.execute(
      "INSERT INTO feedback (id, steamid, appid, action, created_at) VALUES (5, 'u1', 620, 'liked', 1)",
    )
    const once = await migrateDb(db)
    const sqlOf = async () =>
      (await once.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='feedback'"))
        .rows[0]?.sql
    const firstSql = await sqlOf()
    expect(String(firstSql)).toContain("'launched'")

    // Пересборка создаёт таблицу заново, и её строка в sqlite_master получает
    // новый rowid. Совпавший rowid — доказательство, что второй старт таблицу
    // не трогал, даже если текст схемы вышел бы тем же самым
    const before = await once.execute(
      "SELECT rowid FROM sqlite_master WHERE type='table' AND name='feedback'",
    )
    await migrateDb(once)
    const after = await once.execute(
      "SELECT rowid FROM sqlite_master WHERE type='table' AND name='feedback'",
    )
    expect(await sqlOf()).toBe(firstSql)
    expect(after.rows[0]?.rowid).toBe(before.rows[0]?.rowid)
    expect((await listFeedback(once, 'u1')).map((r) => r.appid)).toEqual([620])
  })

  test('миграция: CHECK без любого действия списка пересобирается, а не только без launched', async () => {
    // Условие пересборки раньше искало литерал 'launched'. Следующее действие,
    // добавленное в список, до живой базы бы не доехало: 'launched' там уже
    // есть, пересборки нет, и каждый INSERT нового действия падал бы на CHECK.
    // Каждое по очереди — и последнее, и из середины
    for (const missing of FEEDBACK_ACTIONS) {
      const narrow = FEEDBACK_ACTIONS.filter((a) => a !== missing)
        .map((a) => `'${a}'`)
        .join(',')
      const db = createClient({ url: ':memory:' })
      await db.executeMultiple(`CREATE TABLE feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        steamid TEXT NOT NULL,
        appid INTEGER NOT NULL,
        action TEXT NOT NULL CHECK (action IN (${narrow})),
        reason TEXT,
        mood_json TEXT,
        created_at INTEGER NOT NULL
      );`)
      // Старая строка — любым действием, которое эта схема пускает
      const kept = FEEDBACK_ACTIONS.find((a) => a !== missing)!
      await db.execute({
        sql: "INSERT INTO feedback (id, steamid, appid, action, reason, created_at) VALUES (9, 'u1', 620, ?, 'notnow', 1)",
        args: [kept],
      })
      const migrated = await migrateDb(db)
      const sql = String(
        (await migrated.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='feedback'"))
          .rows[0]?.sql,
      )
      for (const a of FEEDBACK_ACTIONS) expect(sql, `${missing}: ${a}`).toContain(`'${a}'`)
      await migrated.execute({
        sql: "INSERT INTO feedback (steamid, appid, action, created_at) VALUES ('u1', 730, ?, ?)",
        args: [missing, NOW],
      })
      const rows = await migrated.execute('SELECT id, action, reason FROM feedback ORDER BY id')
      expect(
        rows.rows.map((r) => [Number(r.id), r.action, r.reason]),
        missing,
      ).toEqual([
        [9, kept, 'notnow'],
        [10, missing, null],
      ])
    }
  })

  test('свежая база сразу принимает launched и не пересобирается', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'launched' }, NOW)
    expect((await listFeedback(db, 'u1'))[0]?.action).toBe('launched')
  })

  test('«зашло» и запуск за сутки схлопываются в одну строку, за разные дни — нет', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'liked' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'liked' }, NOW + 60)
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'liked' }, NOW + 86_000)
    // запуск — отдельное действие, свой дедуп
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'launched' }, NOW + 10)
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'launched' }, NOW + 20)
    // чужой лайк той же игры не мешает
    await logFeedback(db, { steamid: 'u2', appid: 570, action: 'liked' }, NOW + 30)
    const count = async (steamid: string, action: string) =>
      (await listFeedback(db, steamid, 50)).filter((r) => r.action === action).length
    expect(await count('u1', 'liked')).toBe(1)
    expect(await count('u1', 'launched')).toBe(1)
    expect(await count('u2', 'liked')).toBe(1)

    // через сутки после ПОСЛЕДНЕЙ записанной строки — уже новое событие
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'liked' }, NOW + 86_401)
    expect(await count('u1', 'liked')).toBe(2)
  })

  test('запуск после скипа пишется, даже если за сутки уже был: он снимает паузу', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'launched' }, NOW)
    // «Не зацепило?» → «Не сейчас» через двадцать минут
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'skipped', reason: 'notnow' }, NOW + 1200)
    // Передумал и запустил снова — это новый ответ, а не повтор первого
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'launched' }, NOW + 3600)
    const rows = await listFeedback(db, 'u1', 50)
    expect(rows.filter((r) => r.action === 'launched')).toHaveLength(2)
    expect(cooldownOf(rows, NOW + 3800).has(570)).toBe(false)

    // Повтор уже ПОСЛЕ ответа снова схлопывается
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'launched' }, NOW + 3900)
    expect((await listFeedback(db, 'u1', 50)).filter((r) => r.action === 'launched')).toHaveLength(2)
  })

  test('«Крутить ещё» между запусками дедуп не ломает: это не ответ про игру', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'launched' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'skipped', reason: 'spin' }, NOW + 60)
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'launched' }, NOW + 120)
    expect((await listFeedback(db, 'u1', 50)).filter((r) => r.action === 'launched')).toHaveLength(1)
  })

  test('скипы и баны не схлопываются: у них своя история', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'skipped', reason: 'notnow' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'skipped', reason: 'notnow' }, NOW + 5)
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'opened' }, NOW + 6)
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'opened' }, NOW + 7)
    expect(await listFeedback(db, 'u1')).toHaveLength(4)
  })

  test('feedbackStats: запуски и «Крутить ещё» не в счёт, «зашло» — по играм', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 1, action: 'liked' }, NOW)
    // та же игра на следующей неделе — всё ещё одно попадание
    await logFeedback(db, { steamid: 'u1', appid: 1, action: 'liked' }, NOW + 7 * 86_400)
    await logFeedback(db, { steamid: 'u1', appid: 2, action: 'liked' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 3, action: 'launched' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 4, action: 'skipped', reason: 'spin' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 5, action: 'skipped', reason: 'spin' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 6, action: 'skipped', reason: 'notnow' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 7, action: 'skipped' }, NOW)
    expect(await feedbackStats(db, 'u1')).toEqual({ liked: 2, skipped: 2, rate: 0.5 })
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

  test('броски «Крутить ещё» не выталкивают настоящие оценки из окна', async () => {
    // шестьдесят сессий рулетки по пять бросков — ровно окно /api/recommend
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 620, action: 'liked' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'skipped', reason: 'tired' }, NOW + 1)
    for (let i = 0; i < 300; i++) {
      await logFeedback(db, { steamid: 'u1', appid: 1000 + i, action: 'skipped', reason: 'spin' }, NOW + 10 + i)
    }
    const rows = await listFeedback(db, 'u1', 300)
    expect(rows.map((r) => [r.appid, r.action])).toEqual([
      [570, 'skipped'],
      [620, 'liked'],
    ])
    // и «надоела» по-прежнему держит паузу, а не отпускает игру через неделю
    expect(cooldownOf(rows, NOW + 7 * 86_400).get(570)?.kind).toBe('tired')
    // сами броски в базе остались — фильтр только в окне чтения
    const all = await db.execute("SELECT COUNT(*) AS n FROM feedback WHERE reason = 'spin'")
    expect(Number(all.rows[0].n)).toBe(300)
  })

  test('колода исследователя: «Мимо» не в окне вкуса и не в точности подбора', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 1, action: 'liked' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 2, action: 'skipped', reason: 'explore' }, NOW + 1)
    await logFeedback(db, { steamid: 'u1', appid: 3, action: 'opened', reason: 'explore' }, NOW + 2)
    await logFeedback(db, { steamid: 'u1', appid: 4, action: 'skipped' }, NOW + 3)
    expect((await listFeedback(db, 'u1')).map((r) => [r.appid, r.action])).toEqual([
      [4, 'skipped'],
      [3, 'opened'],
      [1, 'liked'],
    ])
    expect(await feedbackStats(db, 'u1')).toEqual({ liked: 1, skipped: 1, rate: 0.5 })
    // сами свайпы в базе — их читает listExplore
    const all = await db.execute("SELECT COUNT(*) AS n FROM feedback WHERE reason = 'explore'")
    expect(Number(all.rows[0].n)).toBe(2)
  })

  test('«Поставить на загрузку» — план, а не оценка: ни в окне вкуса, ни снятием паузы', async () => {
    const db = await freshDb()
    const install = { source: 'play' as const, intent: 'install' as const }
    // Открыл карточку вчера, сегодня поставил на загрузку: схлопывание по
    // (игра, действие) не должно отдать загрузке место настоящего открытия
    await logFeedback(db, { steamid: 'u1', appid: 620, action: 'opened' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 620, action: 'opened', ctx: install }, NOW + 86_400)
    // «Не сейчас», потом загрузка — пауза остаётся: загрузка не «передумал»
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'skipped', reason: 'notnow' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'opened', ctx: install }, NOW + 60)
    // другой снимок у открытия — обычное открытие
    await logFeedback(db, { steamid: 'u1', appid: 440, action: 'opened', ctx: { intent: 'details' } }, NOW)

    const rows = await listFeedback(db, 'u1')
    expect(rows.map((r) => [r.appid, r.action, r.createdAt]).sort()).toEqual(
      [
        [440, 'opened', NOW],
        [570, 'skipped', NOW],
        [620, 'opened', NOW],
      ].sort(),
    )
    expect(cooldownOf(rows, NOW + 120).get(570)?.kind).toBe('notnow')
    // сами строки в базе — отчёт их читает
    const all = await db.execute("SELECT COUNT(*) AS n FROM feedback WHERE ctx_json LIKE '%install%'")
    expect(Number(all.rows[0].n)).toBe(2)
  })

  test('listExplore: последний свайп решает, свежие сверху, бан сильнее полки', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 10, action: 'opened', reason: 'explore' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 10, action: 'skipped', reason: 'explore' }, NOW + 5)
    await logFeedback(db, { steamid: 'u1', appid: 20, action: 'skipped', reason: 'explore' }, NOW + 1)
    await logFeedback(db, { steamid: 'u1', appid: 20, action: 'opened', reason: 'explore' }, NOW + 6)
    await logFeedback(db, { steamid: 'u1', appid: 30, action: 'opened', reason: 'explore' }, NOW + 2)
    await logFeedback(db, { steamid: 'u1', appid: 30, action: 'banned' }, NOW + 3)
    // не свайп колоды — не её дело
    await logFeedback(db, { steamid: 'u1', appid: 40, action: 'opened' }, NOW + 7)
    await logFeedback(db, { steamid: 'u2', appid: 50, action: 'opened', reason: 'explore' }, NOW)
    expect(await listExplore(db, 'u1')).toEqual([
      { appid: 20, at: NOW + 6, liked: true },
      { appid: 10, at: NOW + 5, liked: false },
    ])
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

  test('bannedAppidsOf объединяет баны всех из списка, и только их', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'banned' }, NOW)
    await logFeedback(db, { steamid: 'u2', appid: 620, action: 'banned' }, NOW)
    await logFeedback(db, { steamid: 'u2', appid: 570, action: 'banned' }, NOW)
    await logFeedback(db, { steamid: 'u2', appid: 730, action: 'liked' }, NOW)
    await logFeedback(db, { steamid: 'u3', appid: 440, action: 'banned' }, NOW)
    expect([...(await bannedAppidsOf(db, ['u1', 'u2']))].sort()).toEqual([570, 620])
    expect(await bannedAppidsOf(db, [])).toEqual(new Set())
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
      { appid: 620, at: NOW + 100, done: false },
      { appid: 570, at: NOW + 5, done: false },
    ])
    expect(await listBanned(db, 'nobody')).toEqual([])
  })

  test('listBanned отличает пройденное от скрытого по последнему нажатию', async () => {
    // «Уже прошёл» — тот же бан с причиной 'done'. На /library пройденное
    // лежит на своей полке, а не среди выгнанного
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'banned', reason: 'done' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 620, action: 'banned' }, NOW + 1)
    // Сначала «прошёл», потом бан без причины — верит последнему
    await logFeedback(db, { steamid: 'u1', appid: 730, action: 'banned', reason: 'done' }, NOW + 2)
    await logFeedback(db, { steamid: 'u1', appid: 730, action: 'banned' }, NOW + 3)
    // И наоборот
    await logFeedback(db, { steamid: 'u1', appid: 440, action: 'banned' }, NOW + 4)
    await logFeedback(db, { steamid: 'u1', appid: 440, action: 'banned', reason: 'done' }, NOW + 5)

    const got = new Map((await listBanned(db, 'u1')).map((b) => [b.appid, b.done]))
    expect(Object.fromEntries(got)).toEqual({ 570: true, 620: false, 730: false, 440: true })
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

  test('listExploreLiked: только последний свайп «Интересно», без потолка listExplore', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 10, action: 'opened', reason: 'explore' }, NOW)
    // передумал — «Мимо» после «Интересно» снимает с полки
    await logFeedback(db, { steamid: 'u1', appid: 10, action: 'skipped', reason: 'explore' }, NOW + 5)
    await logFeedback(db, { steamid: 'u1', appid: 20, action: 'skipped', reason: 'explore' }, NOW + 1)
    await logFeedback(db, { steamid: 'u1', appid: 20, action: 'opened', reason: 'explore' }, NOW + 6)
    await logFeedback(db, { steamid: 'u1', appid: 30, action: 'opened', reason: 'explore' }, NOW + 2)
    await logFeedback(db, { steamid: 'u1', appid: 30, action: 'banned' }, NOW + 3)
    await logFeedback(db, { steamid: 'u1', appid: 40, action: 'opened' }, NOW + 7)
    await logFeedback(db, { steamid: 'u1', appid: 50, action: 'opened', reason: 'explore' }, NOW + 6)
    await logFeedback(db, { steamid: 'u2', appid: 60, action: 'opened', reason: 'explore' }, NOW)
    expect(await listExploreLiked(db, 'u1', 10)).toEqual([
      { appid: 20, at: NOW + 6 },
      { appid: 50, at: NOW + 6 },
    ])
    expect(await listExploreLiked(db, 'u1', 1)).toEqual([{ appid: 20, at: NOW + 6 }])

    // «Убрать» в ту же секунду, что «Интересно», — всё равно убрано: ничью
    // разбивает порядок вставки
    await logFeedback(db, { steamid: 'u1', appid: 70, action: 'opened', reason: 'explore' }, NOW + 9)
    await logFeedback(db, { steamid: 'u1', appid: 70, action: 'skipped', reason: 'explore' }, NOW + 9)
    expect((await listExploreLiked(db, 'u1', 10)).map((r) => r.appid)).not.toContain(70)

    // Двести свежих «Мимо» не выталкивают старое «Интересно» — это и был
    // скрытый потолок полки, пока её читали из listExplore
    const passes = Array.from({ length: 210 }, (_, i) =>
      logFeedback(db, { steamid: 'u3', appid: 1000 + i, action: 'skipped', reason: 'explore' }, NOW + 100 + i),
    )
    await logFeedback(db, { steamid: 'u3', appid: 7, action: 'opened', reason: 'explore' }, NOW)
    await Promise.all(passes)
    expect((await listExplore(db, 'u3')).some((r) => r.appid === 7)).toBe(false)
    expect(await listExploreLiked(db, 'u3', 120)).toEqual([{ appid: 7, at: NOW }])
  })

  test('listLiked: по строке на игру, свежие сверху, без забаненного и чужого', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'liked' }, NOW)
    // второе «зашло» той же игры через сутки — logFeedback склеивает только в пределах суток
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'liked' }, NOW + 90_000)
    await logFeedback(db, { steamid: 'u1', appid: 620, action: 'liked' }, NOW + 100)
    await logFeedback(db, { steamid: 'u1', appid: 730, action: 'liked' }, NOW + 200)
    await logFeedback(db, { steamid: 'u1', appid: 730, action: 'banned' }, NOW + 300)
    await logFeedback(db, { steamid: 'u1', appid: 440, action: 'skipped' }, NOW + 400)
    await logFeedback(db, { steamid: 'u2', appid: 999, action: 'liked' }, NOW + 500)
    // одна секунда — порядок по appid, а не как ляжет
    await logFeedback(db, { steamid: 'u1', appid: 300, action: 'liked' }, NOW + 100)

    expect(await listLiked(db, 'u1')).toEqual([
      { appid: 570, at: NOW + 90_000 },
      { appid: 300, at: NOW + 100 },
      { appid: 620, at: NOW + 100 },
    ])
    expect(await listLiked(db, 'u1', 1)).toEqual([{ appid: 570, at: NOW + 90_000 }])
    expect(await listLiked(db, 'nobody')).toEqual([])
    // счёт — всех, мимо потолка полки, и по тем же правилам
    expect(await countLiked(db, 'u1')).toBe(3)
    expect(await countLiked(db, 'nobody')).toBe(0)
  })

  test('unlikeGame снимает все «зашло» игры и не трогает остальную историю', async () => {
    const db = await freshDb()
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'liked' }, NOW)
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'liked' }, NOW + 90_000)
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'launched' }, NOW + 10)
    await logFeedback(db, { steamid: 'u1', appid: 570, action: 'skipped', reason: 'tired' }, NOW + 20)
    await logFeedback(db, { steamid: 'u1', appid: 620, action: 'liked' }, NOW + 30)
    await logFeedback(db, { steamid: 'u2', appid: 570, action: 'liked' }, NOW + 40)

    await unlikeGame(db, 'u1', 570)

    expect(await listLiked(db, 'u1')).toEqual([{ appid: 620, at: NOW + 30 }])
    const rest = (await listFeedback(db, 'u1', 50)).filter((f) => f.appid === 570).map((f) => f.action)
    expect(rest.sort()).toEqual(['launched', 'skipped'])
    expect(await listLiked(db, 'u2')).toEqual([{ appid: 570, at: NOW + 40 }])
    await expect(unlikeGame(db, 'u1', 12_345)).resolves.toBeUndefined()
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

describe('страница патча', () => {
  async function liveGame(db: Db, appid: number, alive = 1) {
    await upsertGameMeta(db, { ...META, appid, name: `Игра ${appid}` }, NOW)
    await db.execute({
      sql: 'UPDATE games SET alive = ?, tag_count = 3, superseded_by = NULL WHERE appid = ?',
      args: [alive, appid],
    })
  }

  test('пост с телом и игрой: имя, арт и живость из каталога', async () => {
    const db = await freshDb()
    await liveGame(db, 730)
    await upsertNewsItems(db, [newsItem()], NOW)
    await setNewsDigest(db, 730, '1', { tldr: 'Починили дым', scale: 'major' }, NOW)

    const page = await getNewsPage(db, 730, '1')
    expect(page?.item).toMatchObject({
      appid: 730,
      gid: '1',
      title: 'Обновление',
      kind: 'patch',
      tldr: 'Починили дым',
      blocks: NEWS_BASE.blocks,
    })
    expect(page?.game).toMatchObject({ name: 'Игра 730', listed: true })
  })

  test('мёртвая игра — страница есть, но игра не «в каталоге»', async () => {
    const db = await freshDb()
    await liveGame(db, 730, 0)
    await upsertNewsItems(db, [newsItem()], NOW)
    expect((await getNewsPage(db, 730, '1'))?.game?.listed).toBe(false)
  })

  test('игры нет в каталоге — пост отдаётся без неё', async () => {
    // Пост приехал по игре из чьей-то библиотеки, а каталог до неё не дошёл:
    // страница живёт, просто без имени игры
    const db = await freshDb()
    await upsertNewsItems(db, [newsItem()], NOW)
    const page = await getNewsPage(db, 730, '1')
    expect(page?.item.gid).toBe('1')
    expect(page?.game).toBeNull()
  })

  test('чужой gid, чужая игра и отрицательный appid — null', async () => {
    const db = await freshDb()
    await upsertNewsItems(db, [newsItem()], NOW)
    expect(await getNewsPage(db, 730, '2')).toBeNull()
    expect(await getNewsPage(db, 570, '1')).toBeNull()
    expect(await getNewsPage(db, -730, '1')).toBeNull()
  })

  test('заголовки патчей игры: свежие первыми, только патчи, без тел', async () => {
    const db = await freshDb()
    await upsertNewsItems(
      db,
      [
        newsItem({ gid: 'a', publishedAt: NOW - 300, title: 'Старый' }),
        newsItem({ gid: 'b', publishedAt: NOW - 100, title: 'Свежий', scale: null }),
        newsItem({ gid: 'c', publishedAt: NOW - 200, title: 'Распродажа', kind: 'news' }),
        newsItem({ appid: 570, gid: 'd', publishedAt: NOW, title: 'Чужой' }),
      ],
      NOW,
    )
    const heads = await getGamePatchHeads(db, 730, 5)
    expect(heads).toEqual([
      { gid: 'b', title: 'Свежий', publishedAt: NOW - 100, scale: null },
      { gid: 'a', title: 'Старый', publishedAt: NOW - 300, scale: 'major' },
    ])
    expect(await getGamePatchHeads(db, 730, 1)).toHaveLength(1)
  })

  test('карта сайта: крупные, с пересказом, у игр каталога и не старше окна', async () => {
    const db = await freshDb()
    const DAY = 86_400
    await upsertNewsItems(
      db,
      [
        newsItem({ gid: 'ok', publishedAt: NOW - DAY }),
        newsItem({ gid: 'raw', publishedAt: NOW - DAY }), // без пересказа
        newsItem({ gid: 'small', publishedAt: NOW - DAY, scale: 'hotfix' }),
        newsItem({ gid: 'old', publishedAt: NOW - 100 * DAY }),
        newsItem({ gid: 'norank', publishedAt: NOW - DAY, rank: 0 }), // не игра каталога
        newsItem({ gid: 'fresh', publishedAt: NOW - 10 }),
      ],
      NOW,
    )
    for (const gid of ['ok', 'small', 'old', 'norank', 'fresh']) {
      await setNewsDigest(db, 730, gid, { tldr: 'коротко', scale: gid === 'small' ? 'hotfix' : 'major' }, NOW + 50)
    }
    const got = await sitemapNews(db, NOW - 90 * DAY, 100)
    expect(got.map((n) => n.gid)).toEqual(['fresh', 'ok'])
    // пересказ записан позже тела — страница с тех пор изменилась
    expect(got[0].changedAt).toBe(NOW + 50)
    expect(await sitemapNews(db, NOW - 90 * DAY, 1)).toHaveLength(1)
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
    // Оба запроса обязаны вернуть ЗАПИСАННЫЙ матч, а не свой кандидат:
    // опоздавший, отдав клиенту 222, показал бы ему не ту игру навсегда.
    expect(await setRoomMatched(db, 'ROOM08', 111)).toBe(111)
    expect(await setRoomMatched(db, 'ROOM08', 222)).toBe(111)
    expect((await getRoom(db, 'ROOM08'))?.matchedAppid).toBe(111)
  })

  test('матч несуществующей комнаты — null, а не свой кандидат', async () => {
    const db = await freshDb()
    expect(await setRoomMatched(db, 'NOROOM', 111)).toBeNull()
  })

  test('две игры с единогласием в одну секунду: выбор не зависит от порядка строк', async () => {
    // created_at хранится в секундах, и без второго ключа сортировки два
    // параллельных запроса могли выбрать разные игры из одной и той же пары.
    const db = await freshDb()
    await room(db, 'ROOM09', ['a', 'b'])
    await castRoomVote(db, 'ROOM09', 'a', 900, 1, NOW)
    await castRoomVote(db, 'ROOM09', 'b', 900, 1, NOW)
    await castRoomVote(db, 'ROOM09', 'a', 800, 1, NOW)
    await castRoomVote(db, 'ROOM09', 'b', 800, 1, NOW)
    expect(await findRoomMatch(db, 'ROOM09')).toBe(800)
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
        // Первый запрос — голова, порог живёт в ней. Тела ищутся уже по
        // первичному ключу и порога не видят
        issued ||= typeof q === 'string' ? q : q.sql
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

  test('повтор снапшота ничего не переписывает, а рост приоритета — применяется', async () => {
    // Turso считает записанные строки, и холостой апсерт на каждое обновление
    // снапшота — это до 1200 оплаченных записей при нуле изменений
    const db = await freshDb()
    const ids = Array.from({ length: 250 }, (_, i) => i + 1)
    expect(await enrollNewsPoll(db, ids, 1, NOW)).toBe(250)
    expect(await enrollNewsPoll(db, ids, 1, NOW + 60)).toBe(0)
    // понижение приоритета (0 → 1) — тоже не запись
    expect(await enrollNewsPoll(db, [7], 0, NOW)).toBe(1)
    expect(await enrollNewsPoll(db, [7], 1, NOW)).toBe(0)
    // а повышение (1 → 0) доходит до базы, и только для тех, кому оно нужно
    expect(await enrollNewsPoll(db, [7, 8, 9], 0, NOW)).toBe(2)
    const res = await db.execute(
      'SELECT appid, tier FROM news_poll WHERE appid IN (7, 8, 9, 10) ORDER BY appid',
    )
    expect(res.rows.map((r) => [Number(r.appid), Number(r.tier)])).toEqual([
      [7, 0],
      [8, 0],
      [9, 0],
      [10, 1],
    ])
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

  /** Запоминает пары, для которых лента попросила тела патчей. */
  function bodySpy(db: Db) {
    const asked: unknown[] = []
    const spy = {
      execute: (q: InStatement) => {
        const sql = typeof q === 'string' ? q : q.sql
        if (sql.includes('blocks_json')) {
          asked.push(typeof q === 'string' ? null : JSON.parse(String((q.args as unknown[])[0])))
        }
        return db.execute(q)
      },
    } as unknown as Db
    return { spy, asked }
  }

  /** Шесть патчей одной игры и один чужой: перевыборка есть, в ленту идут двое. */
  async function seedCrowded(db: Db) {
    await upsertNewsItems(
      db,
      [
        ...Array.from({ length: 6 }, (_, i) =>
          newsItem({ appid: 70, gid: `hl${i}`, publishedAt: NOW + i, bodyHash: `a${i}` }),
        ),
        newsItem({ appid: 730, gid: 'cs', publishedAt: NOW + 1, bodyHash: 'b' }),
      ],
      NOW,
    )
  }

  test('тела читаются только у патчей, попавших в ленту', async () => {
    // Одним запросом NEWS_COLS тянулись для всех limit × OVERFETCH строк, и три
    // четверти тел выбрасывал onePerGame, не донеся до страницы. Сторож от
    // возврата к одному запросу: тела просят ровно для строк ленты, один раз
    const db = await freshDb()
    await seedCrowded(db)
    const { spy, asked } = bodySpy(db)
    const feed = await getMajorFeed(spy, 10)
    expect(feed.map((n) => n.gid)).toEqual(['hl5', 'cs'])
    expect(asked).toEqual([
      [
        [70, 'hl5'],
        [730, 'cs'],
      ],
    ])
    // и тела действительно приехали — странице их считать
    expect(feed.every((n) => n.blocks.length === NEWS_BASE.blocks.length)).toBe(true)
  })

  test('личная лента тоже просит тела только для своих строк', async () => {
    const db = await freshDb()
    await seedCrowded(db)
    const { spy, asked } = bodySpy(db)
    const feed = await getFeedForApps(spy, [70, 730], 10)
    expect(feed.map((n) => n.gid)).toEqual(['hl5', 'cs'])
    expect(asked).toEqual([
      [
        [70, 'hl5'],
        [730, 'cs'],
      ],
    ])
  })

  test('пустая голова — без второго запроса', async () => {
    const db = await freshDb()
    const { spy, asked } = bodySpy(db)
    expect(await getMajorFeed(spy)).toEqual([])
    expect(await getFeedForApps(spy, [730])).toEqual([])
    expect(asked).toEqual([])
  })

  test('патч, пропавший между головой и телами, выпадает, а порядок держится', async () => {
    // Ретенция может подрезать хвост игры ровно между двумя фазами — на месте
    // пропавшей строки показать нечего, а соседей это задевать не должно
    const db = await freshDb()
    await seedFeed(db)
    let first = true
    const spy = {
      execute: async (q: InStatement) => {
        const res = await db.execute(q)
        if (first) {
          first = false
          await db.execute('DELETE FROM news_items WHERE appid = 570')
        }
        return res
      },
    } as unknown as Db
    expect((await getMajorFeed(spy, 30)).map((n) => n.appid)).toEqual([730, 440])
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

  test('повторная отдача не бросает — иначе она рвёт finally у крона', async () => {
    const db = await freshDb()
    await acquireLease(db, STEAM_LEASE, 'news:a', 75, NOW)
    await releaseLease(db, STEAM_LEASE, 'news:a')

    /*
     * Отданная аренда хранится пустой строкой, а фильтр отдачи разбирает
     * значение как JSON. json_extract('', ...) в SQLite это ИСКЛЮЧЕНИЕ, а не
     * ложь — соседний acquireLease от этого защищён проверкой value = '' перед
     * разбором, отдача не была.
     *
     * Цена ошибки не в самом исключении, а в том, откуда оно летит: все пять
     * вызовов releaseLease в кронах стоят внутри finally. Исключение там
     * обрывает блок — то есть цепочка не передаётся следующему звену и маркер
     * прогона не пишется. Отказ выглядел бы как молчание.
     */
    await expect(releaseLease(db, STEAM_LEASE, 'news:a')).resolves.toBeUndefined()

    // и отдача ключа, которого не существует вовсе, тоже
    await expect(releaseLease(db, 'нет-такого', 'news:a')).resolves.toBeUndefined()

    // при этом ключ остался свободным, а не залип
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

  /**
   * Полка на 404 — единственное место в продукте, где каталог показывается
   * человеку без всякого входа. Значит попасть туда не должно ничто из того,
   * что каталог уже отбраковал: умершие записи, чужие магазины с
   * отрицательными id и карточки без арта — полка из заглушек полкой не выглядит.
   */
  test('верх каталога: только живые, со своим артом и по числу отзывов', async () => {
    const db = await freshDb()
    const put = async (appid: number, reviews: number, alive: number, header: string | null) => {
      await upsertGameMeta(
        db,
        { ...META, appid, name: `Игра ${appid}`, reviewsTotal: reviews, headerImage: header ?? undefined },
        NOW,
      )
      await db.execute({
        sql: 'UPDATE games SET alive = ?, tag_count = 3, superseded_by = NULL, header_image = ? WHERE appid = ?',
        args: [alive, header, appid],
      })
    }
    await put(10, 100, 1, 'https://example/10.jpg')
    await put(20, 900, 1, 'https://example/20.jpg')
    await put(30, 5000, 0, 'https://example/30.jpg') // мёртвая
    await put(40, 4000, 1, null) // без арта
    await put(-50, 8000, 1, 'https://example/50.jpg') // чужой магазин

    const top = await topCatalogGames(db, 10)
    expect(top.map((g) => g.appid)).toEqual([20, 10])
    expect(top[0].name).toBe('Игра 20')
    expect(top[0].headerImage).toBe('https://example/20.jpg')
  })

  test('верх каталога уважает лимит', async () => {
    const db = await freshDb()
    for (const appid of [1, 2, 3, 4]) {
      await upsertGameMeta(db, { ...META, appid, reviewsTotal: appid * 100 }, NOW)
      await db.execute({
        sql: "UPDATE games SET alive = 1, tag_count = 3, header_image = 'x' WHERE appid = ?",
        args: [appid],
      })
    }
    expect(await topCatalogGames(db, 2)).toHaveLength(2)
  })
})

describe('кандидаты полок хаба', () => {
  async function put(
    db: Awaited<ReturnType<typeof freshDb>>,
    appid: number,
    reviews: number,
    tags: Array<[string, number]>,
    alive = 1,
  ) {
    await upsertGameMeta(db, { ...META, appid, name: `Игра ${appid}`, reviewsTotal: reviews }, NOW)
    await db.execute({
      sql: 'UPDATE games SET alive = ?, tag_count = 3, superseded_by = NULL WHERE appid = ?',
      args: [alive, appid],
    })
    await replaceGameTags(
      db,
      appid,
      tags.map(([tag, weight]) => ({ tag, weight })),
    )
  }

  test('по каждому тегу — верх по отзывам среди тех, у кого тег главный', async () => {
    const db = await freshDb()
    await put(db, 1, 900, [['Roguelike', 1000]])
    await put(db, 2, 5000, [['Roguelike', 600], ['Horror', 1000]])
    await put(db, 3, 9000, [['Roguelike', 300]]) // рогалик хвостом — не на полку
    await put(db, 4, 7000, [['Roguelike', 800]], 0) // мёртвая
    await put(db, -5, 8000, [['Roguelike', 1000]]) // чужой магазин
    await put(db, 6, 100, [['Roguelike', 700]])
    await put(db, 7, 3000, [['Cozy', 1000]]) // тег не спрошен

    const rows = await topGamesByTags(db, ['Roguelike', 'Horror'], { minWeight: 500, perTag: 2 })
    expect(rows.map((r) => [r.tag, r.appid, r.total])).toEqual([
      ['Horror', 2, 1],
      ['Roguelike', 2, 3],
      ['Roguelike', 1, 3],
    ])
    expect(rows[0].name).toBe('Игра 2')
    expect(rows[0]).not.toHaveProperty('tags')
  })

  test('пустой список тегов — ни одного запроса', async () => {
    const db = await freshDb()
    let calls = 0
    const spy = {
      execute: (...a: Parameters<typeof db.execute>) => {
        calls++
        return db.execute(...a)
      },
    } as unknown as typeof db
    expect(await topGamesByTags(spy, [], { minWeight: 500, perTag: 12 })).toEqual([])
    expect(calls).toBe(0)
  })
})


describe('топ каталога: кэш на десять минут', () => {
  async function игра(db: Awaited<ReturnType<typeof createDb>>, appid: number, ccu: number) {
    await db.execute({
      sql: `INSERT INTO games (appid, name, tag_count, alive, ccu, reviews_total, updated_at)
            VALUES (?, ?, 3, 1, ?, ?, 0)`,
      args: [appid, `Игра ${appid}`, ccu, ccu],
    })
  }

  test('повторный вызов не ходит в базу, но новая база кэш не наследует', async () => {
    const первая = await createDb(':memory:')
    await игра(первая, 10, 100)
    expect(await topCatalogAppids(первая, 5)).toEqual([10])

    // добавили строку — и не увидели её: ровно этого мы и хотим десять минут
    await игра(первая, 20, 999)
    expect(await topCatalogAppids(первая, 5)).toEqual([10])

    // другой per — другой вопрос, отвечать на него старым ответом нельзя
    expect(await topCatalogAppids(первая, 50)).toEqual([20, 10])

    // Ключ кэша — сама база. Иначе тесты, открывающие свежую базу в памяти на
    // каждый случай, склеились бы между собой через один общий кэш.
    const вторая = await createDb(':memory:')
    await игра(вторая, 77, 5)
    expect(await topCatalogAppids(вторая, 5)).toEqual([77])
  })
})

describe('forgetUser: удаление по запросу', () => {
  const ME = '76561198000000001'
  const FRIEND = '76561198000000002'
  const THIRD = '76561198000000003'

  /** Игрок, у которого есть строка в каждой таблице, где вообще бывают люди */
  async function populated() {
    const db = await freshDb()
    await upsertUser(db, { steamid: ME, personaName: 'Me', avatarUrl: 'https://a/me.jpg' }, NOW)
    await setUserPortrait(db, ME, { takenAt: NOW, text: 'портрет' })
    await createSession(db, { sid: 'sid-me', steamid: ME, verified: true }, NOW)
    // Два разных года — две годовые отметки. Ровно их политика раньше не
    // упоминала, и ровно их проще всего забыть при удалении руками.
    await saveLibrarySnapshot(db, ME, LIB, NOW - 400 * 86_400)
    await saveLibrarySnapshot(db, ME, LIB, NOW)
    await logFeedback(db, { steamid: ME, appid: 570, action: 'liked' }, NOW)
    await logFeedback(db, { steamid: ME, appid: 620, action: 'banned' }, NOW)
    await saveDailyPick(db, ME, '2023-11-14', { appid: 570 }, NOW)
    await recordOutcome(db, { steamid: ME, appid: 570, source: 'comeback', launched: true }, NOW)
    await checkRate(db, { bucket: 'portrait', id: ME, limit: 10, windowSec: 60, nowSec: NOW })
    // Сравнения в обе стороны: он открыл ссылку друга и друг — его
    await recordCompatView(db, { owner: FRIEND, viewer: ME, percent: 71 }, NOW)
    await recordCompatView(db, { owner: ME, viewer: FRIEND, percent: 71 }, NOW)
    // Выбор, которым он поделился (/pick/<id>)
    await createSharedPick(
      db,
      { id: 'mepick234567', createdBy: ME, appid: 570, source: 'comeback', kind: 'play', reason: 'Вернись.' },
      NOW,
    )

    // Своя комната: друг в ней тоже голосовал
    await createRoom(db, { id: 'MYROOM', steamid: ME }, NOW)
    await joinRoom(db, 'MYROOM', ME, 'Me', NOW)
    await joinRoom(db, 'MYROOM', FRIEND, 'Friend', NOW)
    await issueRoomDeck(db, 'MYROOM', [570, 620])
    await castRoomVote(db, 'MYROOM', ME, 570, 1, NOW)
    await castRoomVote(db, 'MYROOM', FRIEND, 570, 1, NOW)

    // Чужая комната, где он только гость
    await createRoom(db, { id: 'FRROOM', steamid: FRIEND }, NOW)
    await joinRoom(db, 'FRROOM', FRIEND, 'Friend', NOW)
    await joinRoom(db, 'FRROOM', ME, 'Me', NOW)
    await castRoomVote(db, 'FRROOM', ME, 620, 1, NOW)
    await castRoomVote(db, 'FRROOM', FRIEND, 620, 0, NOW)

    // Данные друга, которые удаление трогать не имеет права
    await upsertUser(db, { steamid: FRIEND, personaName: 'Friend' }, NOW)
    await recordCompatView(db, { owner: FRIEND, viewer: THIRD, percent: 40 }, NOW)
    await createSharedPick(
      db,
      { id: 'frpick234567', createdBy: FRIEND, appid: 620, source: 'new', kind: 'daily', reason: 'Попробуй.' },
      NOW,
    )
    await logFeedback(db, { steamid: FRIEND, appid: 570, action: 'liked' }, NOW)
    await saveLibrarySnapshot(db, FRIEND, LIB, NOW)
    return db
  }

  /**
   * Каждая ячейка каждой таблицы, в которой встречается steamid. Сплошной
   * перебор, а не список таблиц: список — это ровно то, что проверяется.
   */
  async function traces(db: Db, steamid: string): Promise<string[]> {
    const tables = await db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    const hits: string[] = []
    for (const t of tables.rows) {
      const table = t.name as string
      const cols = await db.execute(`PRAGMA table_info(${table})`)
      for (const c of cols.rows) {
        const col = c.name as string
        const res = await db.execute({
          sql: `SELECT COUNT(*) AS n FROM ${table} WHERE instr(CAST(${col} AS TEXT), ?) > 0`,
          args: [steamid],
        })
        if (Number(res.rows[0]?.n) > 0) hits.push(`${table}.${col}`)
      }
    }
    return hits.sort()
  }

  test('после удаления steamid не встречается ни в одной ячейке базы', async () => {
    const db = await populated()
    // Сначала — что заготовка действительно покрывает каждую таблицу списка,
    // иначе пустой результат ниже ничего бы не доказывал.
    const before = await traces(db, ME)
    // room_deck — колода комнаты: steamid в её ячейках нет, искать нечего.
    // Что заготовка покрывает и её, проверяет предпросмотр ниже (rows > 0).
    for (const table of FORGET_TABLES.filter((t) => t !== 'room_deck')) {
      expect(before.some((h) => h.startsWith(`${table}.`)), table).toBe(true)
    }

    await forgetUser(db, ME)
    expect(await traces(db, ME)).toEqual([])
  })

  test('чужое остаётся: данные друга и его комната, где удалённый был гостем', async () => {
    const db = await populated()
    await forgetUser(db, ME)

    expect(await getLatestSnapshot(db, FRIEND)).not.toBeNull()
    expect((await listFeedback(db, FRIEND)).length).toBe(1)
    expect(await getRoom(db, 'FRROOM')).not.toBeNull()
    expect((await roomMembers(db, 'FRROOM')).length).toBe(1)
    expect(await roomVotes(db, 'FRROOM')).toEqual([
      { steamid: FRIEND, appid: 620, vote: 0, createdAt: NOW },
    ])
    // Своя комната уходит целиком, вместе с голосом друга в ней и колодой
    expect(await getRoom(db, 'MYROOM')).toBeNull()
    expect(await roomVotes(db, 'MYROOM')).toEqual([])
    const deck = await db.execute("SELECT COUNT(*) AS n FROM room_deck WHERE room_id = 'MYROOM'")
    expect(Number(deck.rows[0]?.n)).toBe(0)
    // Сравнения удалённого ушли в обе стороны, а друга с третьим — остались
    expect((await listCompatViews(db, FRIEND, 0)).map((v) => v.steamid)).toEqual([THIRD])
    expect(await listCompatViews(db, ME, 0)).toEqual([])
    // Его ссылка на выбор перестала открываться, ссылка друга — открывается
    expect(await getSharedPick(db, 'mepick234567', 0)).toBeNull()
    expect(await getSharedPick(db, 'frpick234567', 0)).not.toBeNull()
  })

  test('предпросмотр считает ровно то, что удалится', async () => {
    const db = await populated()
    const preview = await countUserRows(db, ME)
    expect(preview.map((r) => r.table)).toEqual([...FORGET_TABLES])
    expect(preview.every((r) => r.rows > 0)).toBe(true)
    expect(await forgetUser(db, ME)).toEqual(preview)
    expect((await countUserRows(db, ME)).every((r) => r.rows === 0)).toBe(true)
  })

  test('не SteamID64 — отказ, а не удаление по пустой строке', async () => {
    // instr с пустым steamid совпал бы с каждым ключом лимитера
    const db = await populated()
    await expect(forgetUser(db, '')).rejects.toThrow()
    await expect(forgetUser(db, '7656')).rejects.toThrow()
    await expect(countUserRows(db, "1' OR 1=1")).rejects.toThrow()
    expect(await getLatestSnapshot(db, ME)).not.toBeNull()
  })

  test('сторож: каждая таблица с людьми (steamid, created_by, owner, viewer) есть в списке удаления', async () => {
    // Новая таблица с данными людей обязана попасть в forgetUser. Иначе
    // политика обещает «удаляем всё», а удаление молча её пропускает.
    const db = await freshDb()
    const tables = await db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    const personal: string[] = []
    for (const t of tables.rows) {
      const cols = await db.execute(`PRAGMA table_info(${t.name as string})`)
      if (cols.rows.some((c) => ['steamid', 'created_by', 'owner', 'viewer'].includes(c.name as string))) {
        personal.push(t.name as string)
      }
    }
    expect(personal.length).toBeGreaterThan(5)
    for (const table of personal) expect(FORGET_TABLES, table).toContain(table)
  })
})

describe('sweepStale: суточная уборка', () => {
  const DAY = 86_400
  const REAL = '76561198000000001'
  /** Демо-личности: префикс '000', как у demoSteamId в lib/server */
  const OLD_DEMO = '00012345678901231'
  const FRESH_DEMO = '00012345678901241'
  const BUSY_DEMO = '00012345678901251'
  const RENEWED_DEMO = '00012345678901261'

  /** Сколько строк у steamid в каждой таблице, где бывают люди */
  async function rowsOf(db: Db, steamid: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    const tables = [
      'users',
      'sessions',
      'library_snapshots',
      'library_baselines',
      'feedback',
      'daily_picks',
    ]
    for (const table of tables) {
      const res = await db.execute({
        sql: `SELECT COUNT(*) AS n FROM ${table} WHERE steamid = ?`,
        args: [steamid],
      })
      out[table] = Number(res.rows[0]?.n)
    }
    return out
  }

  /** Демо-вход в момент at: то же, что пишут /api/connect и seedDemo */
  async function demo(db: Db, steamid: string, at: number) {
    await upsertUser(db, { steamid, personaName: 'Демо-игрок' }, at)
    await createSession(db, { sid: `sid-${steamid}`, steamid }, at)
    await saveLibrarySnapshot(db, steamid, LIB, at)
    await logFeedback(db, { steamid, appid: 570, action: 'skipped' }, at)
    await saveDailyPick(db, steamid, '2023-11-06', { appid: 570 }, at)
  }

  test('демо, от которого неделю нет вестей, уходит целиком', async () => {
    const db = await freshDb()
    // Последний визит мог быть не позже продления + SESSION_TOUCH_AFTER_SEC,
    // и уже от него — неделя тишины
    await demo(db, OLD_DEMO, NOW - DEMO_TTL_SEC - SESSION_TOUCH_AFTER_SEC - DAY)
    const before = await rowsOf(db, OLD_DEMO)
    // иначе пустой результат ниже ничего бы не доказывал
    expect(Object.values(before).every((n) => n > 0), JSON.stringify(before)).toBe(true)

    const report = await sweepStale(db, NOW)
    expect(Object.values(await rowsOf(db, OLD_DEMO)).every((n) => n === 0)).toBe(true)
    expect(report).toMatchObject({ demos: 1, sessions: 1 })
  })

  test('демо с признаками жизни остаётся: свежий вход, оценка, продлённая сессия', async () => {
    const db = await freshDb()
    await demo(db, FRESH_DEMO, NOW - 2 * DAY)
    // Вошёл давно, но оценивал вчера — это живой человек в демо
    await demo(db, BUSY_DEMO, NOW - 20 * DAY)
    await logFeedback(db, { steamid: BUSY_DEMO, appid: 620, action: 'liked' }, NOW - DAY)
    // Вошёл давно, но кука продлилась позавчера (touchSession)
    await demo(db, RENEWED_DEMO, NOW - 20 * DAY)
    await createSession(db, { sid: `sid-${RENEWED_DEMO}`, steamid: RENEWED_DEMO }, NOW - 2 * DAY)

    expect((await sweepStale(db, NOW)).demos).toBe(0)
    for (const sid of [FRESH_DEMO, BUSY_DEMO, RENEWED_DEMO]) {
      expect((await rowsOf(db, sid)).users, sid).toBe(1)
      expect((await rowsOf(db, sid)).library_snapshots, sid).toBeGreaterThan(0)
    }
  })

  test('кука убранного демо узнаёт, что личности больше нет; настоящий человек без строк — нет', async () => {
    const db = await freshDb()
    await demo(db, OLD_DEMO, NOW - DEMO_TTL_SEC - SESSION_TOUCH_AFTER_SEC - DAY)
    expect((await getSessionState(db, `sid-${OLD_DEMO}`, OLD_DEMO)).gone).toBe(false)
    await sweepStale(db, NOW)
    expect(await getSessionState(db, `sid-${OLD_DEMO}`, OLD_DEMO)).toMatchObject({
      revokedAt: null,
      gone: true,
    })
    // «Строки нет» у настоящего человека по-прежнему ничего не решает:
    // пересозданная база или не записавшийся INSERT не разлогинивают
    expect((await getSessionState(db, 'sid-nobody', REAL)).gone).toBe(false)
  })

  test('демо, в которое заходят каждый день без оценок, уборка не трогает', async () => {
    // Кука и seen_at продлеваются раз в SESSION_TOUCH_AFTER_SEC: всю неделю
    // после входа отметка стоит на месте, хотя человек заходил и вчера.
    // Раньше его сносило прямо посреди пользования.
    const db = await freshDb()
    const DAILY_DEMO = '00012345678901271'
    await demo(db, DAILY_DEMO, NOW - SESSION_TOUCH_AFTER_SEC - DAY)
    expect((await sweepStale(db, NOW)).demos).toBe(0)
    expect(await rowsOf(db, DAILY_DEMO)).toMatchObject({ users: 1, sessions: 1, library_snapshots: 1 })
  })

  test('настоящий человек не демо, сколько бы ни молчал', async () => {
    const db = await freshDb()
    await upsertUser(db, { steamid: REAL, personaName: 'Живой' }, NOW - 300 * DAY)
    await saveLibrarySnapshot(db, REAL, LIB, NOW - 300 * DAY)
    await logFeedback(db, { steamid: REAL, appid: 570, action: 'liked' }, NOW - 300 * DAY)
    await sweepStale(db, NOW)
    expect(await rowsOf(db, REAL)).toMatchObject({ users: 1, library_snapshots: 1, feedback: 1 })
  })

  test('сессия уходит, только когда истекли все её токены, надгробие — тоже', async () => {
    const db = await freshDb()
    const year = 365 * DAY
    // Погашенное устройство: строка обязана пережить сам токен, иначе
    // «строки нет» прочтётся как «вход жив», и отзыв отменится
    await createSession(db, { sid: 'revoked-fresh', steamid: REAL }, NOW - 30 * DAY)
    await revokeSession(db, 'revoked-fresh', NOW - 10 * DAY)
    await createSession(db, { sid: 'revoked-old', steamid: REAL }, NOW - 2 * year)
    await revokeSession(db, 'revoked-old', NOW - 400 * DAY)
    // Вход через Steam без продления: до конца срока строка несёт verified
    await createSession(db, { sid: 'quiet', steamid: REAL, verified: true }, NOW - 380 * DAY)
    await createSession(db, { sid: 'dead', steamid: REAL, verified: true }, NOW - 400 * DAY)

    await sweepStale(db, NOW)
    const left = await db.execute('SELECT sid FROM sessions ORDER BY sid')
    expect(left.rows.map((r) => r.sid)).toEqual(['quiet', 'revoked-fresh'])
    expect((await getSessionState(db, 'revoked-fresh', REAL)).revokedAt).toBe(NOW - 10 * DAY)
  })

  test('комната старше двух недель уходит вместе с участниками, голосами и колодой', async () => {
    const db = await freshDb()
    for (const [id, at] of [
      ['OLD001', NOW - 15 * DAY],
      ['NEW001', NOW - DAY],
    ] as const) {
      await createRoom(db, { id, steamid: REAL }, at)
      await joinRoom(db, id, REAL, 'Живой', at)
      await issueRoomDeck(db, id, [570])
      await castRoomVote(db, id, REAL, 570, 1, at)
    }

    expect((await sweepStale(db, NOW)).rooms).toBe(1)
    expect(await getRoom(db, 'OLD001')).toBeNull()
    for (const table of ['room_members', 'room_votes', 'room_deck']) {
      const res = await db.execute(`SELECT room_id FROM ${table}`)
      expect(res.rows.map((r) => r.room_id), table).toEqual(['NEW001'])
    }
  })

  test('снимок выдачи старше девяноста дней стирается, а сама оценка остаётся', async () => {
    const db = await freshDb()
    const ctx = { source: 'play' as const, slot: 'hero' as const, parts: { taste: 0.5 } }
    const old = NOW - FEEDBACK_CTX_TTL_SEC - DAY
    const fresh = NOW - FEEDBACK_CTX_TTL_SEC + DAY
    await logFeedback(db, { steamid: REAL, appid: 620, action: 'liked', ctx }, old)
    await logFeedback(db, { steamid: REAL, appid: 570, action: 'liked', ctx }, fresh)
    await logFeedback(db, { steamid: REAL, appid: 440, action: 'skipped' }, old)

    expect((await sweepStale(db, NOW)).ctx).toBe(1)
    const rows = await db.execute({
      sql: 'SELECT appid, ctx_json FROM feedback WHERE steamid = ? ORDER BY appid',
      args: [REAL],
    })
    const kept = rows.rows.map((r) => [
      Number(r.appid),
      r.ctx_json === null ? null : JSON.parse(String(r.ctx_json)),
    ])
    expect(kept).toEqual([
      [440, null],
      [570, ctx],
      [620, null],
    ])
    // Повтор — ничего: стёртое выпало из частичного индекса
    expect((await sweepStale(db, NOW)).ctx).toBe(0)
  })
})

/**
 * Версия схемы в catalog_meta.
 *
 * До неё каждый холодный старт гонял в Turso три десятка ALTER, заведомо
 * падавших с «duplicate column name», — по отдельному походу в базу на каждый.
 * Тесты ниже не про результат миграции (его проверяют остальные), а про то,
 * СКОЛЬКО она делает: на живой базе дорог каждый запрос.
 */
describe('версия схемы', () => {
  type Call = { kind: 'execute' | 'multiple' | 'batch'; sql: string; failed?: string }

  /**
   * Обёртка, записывающая каждое обращение к базе. fail позволяет уронить
   * конкретный запрос — так выглядят обрыв связи или отказ сервера.
   */
  function recording(db: Db, fail?: (sql: string) => string | null) {
    const calls: Call[] = []
    const text = (q: InStatement) => (typeof q === 'string' ? q : q.sql)
    const run = async <T>(call: Call, go: () => Promise<T>): Promise<T> => {
      calls.push(call)
      const injected = fail?.(call.sql)
      if (injected) {
        call.failed = injected
        throw new Error(injected)
      }
      try {
        return await go()
      } catch (e) {
        call.failed = e instanceof Error ? e.message : String(e)
        throw e
      }
    }
    const spy = {
      execute: (q: InStatement) => run({ kind: 'execute', sql: text(q) }, () => db.execute(q)),
      executeMultiple: (sql: string) =>
        run({ kind: 'multiple', sql }, () => db.executeMultiple(sql)),
      batch: (qs: InStatement[], mode?: 'write' | 'read' | 'deferred') =>
        run({ kind: 'batch', sql: qs.map(text).join(';\n') }, () => db.batch(qs, mode)),
    } as unknown as Db
    return { spy, calls }
  }

  const isAlter = (c: Call) => /^\s*ALTER TABLE/i.test(c.sql)

  async function columnsOf(db: Db): Promise<Set<string>> {
    const res = await db.execute(
      `SELECT m.name AS tbl, p.name AS col
         FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type = 'table'`,
    )
    return new Set(res.rows.map((r) => `${r.tbl}.${r.col}`))
  }

  /** games и rooms в том виде, в каком они жили до ALTER-списка */
  async function legacyDb(): Promise<Db> {
    const db = createClient({ url: ':memory:' })
    await db.executeMultiple(`
      CREATE TABLE games (
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
      CREATE TABLE rooms (
        id TEXT PRIMARY KEY,
        created_by TEXT NOT NULL,
        mood_json TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        matched_appid INTEGER,
        created_at INTEGER NOT NULL
      );`)
    return db
  }

  test('доведённая база стартует за четыре обращения: ни ALTER, ни UPDATE, ни пересборки', async () => {
    const db = await freshDb()
    const { spy, calls } = recording(db)
    await migrateDb(spy)

    expect(calls.filter(isAlter)).toEqual([])
    expect(calls.filter((c) => /^\s*UPDATE\b/i.test(c.sql))).toEqual([])
    // проверка CHECK у feedback — это чтение sqlite_master, и оно тоже под версией
    expect(calls.filter((c) => c.kind === 'execute' && /sqlite_master/.test(c.sql))).toEqual([])
    // три блока CREATE … IF NOT EXISTS и одно чтение флагов; каждый вызов —
    // отдельный поход в Turso
    expect(calls.map((c) => c.kind)).toEqual(['multiple', 'multiple', 'execute', 'multiple'])
  })

  test('база без версии, но со всеми колонками, обходится без единого ALTER', async () => {
    // Так выглядит прод в первый холодный старт после этой правки
    const db = await freshDb()
    await db.execute("DELETE FROM catalog_meta WHERE key = 'schema_v'")
    const { spy, calls } = recording(db)
    await migrateDb(spy)

    expect(calls.filter(isAlter)).toEqual([])
    expect(await getCatalogMeta(db, 'schema_v')).toBe(String(CURRENT_SCHEMA_V))
  })

  test('старая база получает ровно недостающие колонки, без заведомо падающих ALTER', async () => {
    const db = await legacyDb()
    const { spy, calls } = recording(db)
    await migrateDb(spy)

    const have = await columnsOf(db)
    for (const [table, col] of ADDED_COLUMNS) {
      expect(have.has(`${table}.${col.split(' ')[0]}`), `${table}.${col}`).toBe(true)
    }
    const alters = calls.filter(isAlter)
    expect(alters.filter((c) => c.failed)).toEqual([])
    // store и store_url в старой games уже были — их не трогаем
    expect(alters.some((c) => /ADD COLUMN store(_url)? /.test(c.sql))).toBe(false)
    expect(alters.some((c) => /ALTER TABLE rooms ADD COLUMN deck_round/.test(c.sql))).toBe(true)
  })

  test('старый словарь тегов получает name_ru и не теряет строк', async () => {
    // Таблица tags живёт на проде с первой версии схемы — без name_ru. На
    // свежей :memory: колонка есть сразу, и отсутствие ALTER там не видно
    const db = await legacyDb()
    await db.executeMultiple(`
      CREATE TABLE tags (
        tagid INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        game_count INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO tags (tagid, name, game_count) VALUES (1716, 'Roguelike', 40);`)
    await migrateDb(db)

    expect((await columnsOf(db)).has('tags.name_ru')).toBe(true)
    expect((await loadTagDictionary(db)).get(1716)).toBe('Roguelike')
    await saveTagDictionary(db, new Map([[1716, 'Roguelike']]), new Map([[1716, 'Рогалик']]))
    expect((await loadTagNamesRu(db)).get('Roguelike')).toBe('Рогалик')
  })

  test('без pragma_table_info миграция откатывается к перебору всех колонок', async () => {
    // Табличную функцию может не пустить сервер. Тогда платим прежнюю цену —
    // один раз, потому что версия после этого всё равно записывается.
    const db = await freshDb()
    await db.execute("DELETE FROM catalog_meta WHERE key = 'schema_v'")
    const { spy, calls } = recording(db, (sql) =>
      sql.includes('pragma_table_info') ? 'no such table: pragma_table_info' : null,
    )
    await migrateDb(spy)

    expect(calls.filter(isAlter)).toHaveLength(ADDED_COLUMNS.length)
    expect(await getCatalogMeta(db, 'schema_v')).toBe(String(CURRENT_SCHEMA_V))
  })

  test('оборвавшаяся миграция версию не пишет, и следующий старт её доделывает', async () => {
    const db = await legacyDb()
    const { spy } = recording(db, (sql) =>
      /ADD COLUMN deck_size/.test(sql) ? 'SERVER_ERROR: connection reset' : null,
    )
    await expect(migrateDb(spy)).rejects.toThrow(/connection reset/)
    expect(await getCatalogMeta(db, 'schema_v')).toBeNull()

    await migrateDb(db)
    expect((await columnsOf(db)).has('rooms.deck_size')).toBe(true)
    expect(await getCatalogMeta(db, 'schema_v')).toBe(String(CURRENT_SCHEMA_V))
  })

  test('новая колонка без новой версии схемы не проскочит', () => {
    // На живой базе версия уже записана, и колонка, добавленная без подъёма
    // CURRENT_SCHEMA_V, туда не доедет никогда, а все остальные тесты гоняют
    // свежую :memory:, где версии нет. Поменял ADDED_COLUMNS — подними
    // CURRENT_SCHEMA_V и перепиши здесь обе цифры.
    expect({ version: CURRENT_SCHEMA_V, columns: ADDED_COLUMNS.length }).toEqual({
      version: 5,
      columns: 34,
    })
  })
})

/**
 * Досев заготовленных карточек: кураторский пул других магазинов и демо.
 *
 * Пул досевал POST /api/prepare на каждом вызове прогрева; теперь это делают
 * migrateDb базы приложения (раз на базу, под флагом) и демо-вход. В обоих
 * случаях уже лежащая строка неприкосновенна: у демо настоящие Steam appid.
 */
describe('досев заготовок', () => {
  const otherIds = OTHER_STORE_GAMES.map((m) => m.appid)

  test('insertMissingGamesMeta пишет только отсутствующие, прогретую строку не трогает', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, META, NOW)
    await insertMissingGamesMeta(
      db,
      [{ ...META, name: 'Заготовка', tags: { Puzzle: 1 } }, { ...META, appid: 730, name: 'CS2' }],
      NOW + 100,
    )
    const got = await getGamesMeta(db, [620, 730])
    expect(got.get(620)).toEqual(META)
    expect(got.get(730)?.name).toBe('CS2')
  })

  test('база приложения досевает пул один раз: дальше решает флаг', async () => {
    const client = createClient({ url: ':memory:' })
    await migrateDb(client, {}, { seedContent: true })
    expect([...(await getGamesMeta(client, otherIds)).keys()].sort()).toEqual([...otherIds].sort())

    // Флаг читается тем же запросом, что и остальные флаги миграций, поэтому
    // следующий старт за досев не платит — и удалённую руками строку не
    // воскрешает (для этого флаг снимают, см. migrateDb)
    await client.execute('DELETE FROM games WHERE appid = -101')
    await migrateDb(client, {}, { seedContent: true })
    expect((await getGamesMeta(client, [-101])).size).toBe(0)
  })

  test('без seedContent пул не сеется: скрипты и тесты получают пустую базу', async () => {
    const db = await freshDb()
    expect((await getGamesMeta(db, otherIds)).size).toBe(0)
  })

  test('демо-вход досевает и свои карточки, и пул — не затирая прогретое', async () => {
    const db = await freshDb()
    // Portal 2 есть и в демо-библиотеке: прогретая строка должна пережить вход
    await upsertGameMeta(db, META, NOW)
    await seedDemo(db, '00012345678901231', NOW + 100)

    expect((await getGamesMeta(db, [620])).get(620)).toEqual(META)
    expect((await getGamesMeta(db, otherIds)).size).toBe(otherIds.length)
    const snap = await getLatestSnapshot(db, '00012345678901231')
    const demoIds = snap!.games.map((g) => g.appid)
    expect((await getGamesMeta(db, demoIds)).size).toBe(demoIds.length)
  })
})

describe('превью и продовая база', () => {
  /** feedback в том виде, в каком он жил до 'launched' */
  async function oldFeedbackDb(): Promise<Db> {
    const db = createClient({ url: ':memory:' })
    await db.executeMultiple(`CREATE TABLE feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      steamid TEXT NOT NULL,
      appid INTEGER NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('liked','skipped','opened','banned')),
      reason TEXT,
      mood_json TEXT,
      created_at INTEGER NOT NULL
    );`)
    await db.execute(
      "INSERT INTO feedback (id, steamid, appid, action, created_at) VALUES (9, 'u1', 620, 'banned', 1)",
    )
    return db
  }

  const tableRowid = async (db: Db) =>
    (await db.execute("SELECT rowid, sql FROM sqlite_master WHERE type='table' AND name='feedback'"))
      .rows[0]

  const PREVIEW = { VERCEL_ENV: 'preview' }

  test('пересобирать таблицы нельзя только превью без своей базы', () => {
    expect(destructiveMigrationsAllowed({})).toBe(true) // локально и в скриптах
    expect(destructiveMigrationsAllowed({ VERCEL_ENV: 'production' })).toBe(true)
    expect(destructiveMigrationsAllowed({ VERCEL_ENV: 'development' })).toBe(true)
    expect(destructiveMigrationsAllowed(PREVIEW)).toBe(false)
    expect(destructiveMigrationsAllowed({ ...PREVIEW, [PREVIEW_OWN_DB_ENV]: '1' })).toBe(true)
    // «true» и «yes» — не единица: флаг ставится один раз и ровно так, как в DEPLOY.md
    expect(destructiveMigrationsAllowed({ ...PREVIEW, [PREVIEW_OWN_DB_ENV]: 'true' })).toBe(false)
  })

  test('превью не трогает feedback и не пишет версию, прод потом доводит сам', async () => {
    const db = await oldFeedbackDb()
    const before = await tableRowid(db)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await migrateDb(db, PREVIEW)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
        event: 'migrate-skipped',
        step: 'feedback-check',
      })
    } finally {
      warn.mockRestore()
    }

    // Таблица та же самая (rowid в sqlite_master не сменился), строки на месте.
    // Текст схемы сравнивать нельзя: ALTER ADD COLUMN разрушающим не считается
    // и превью его делает, — но CHECK остался прежним, узким
    const after = await tableRowid(db)
    expect(after?.rowid).toBe(before?.rowid)
    expect(String(after?.sql)).not.toContain("'launched'")
    expect((await listFeedback(db, 'u1')).map((r) => r.action)).toEqual(['banned'])
    // Версии нет: запиши её превью — прод счёл бы схему доведённой навсегда
    expect(await getCatalogMeta(db, 'schema_v')).toBeNull()

    // Первый старт прода после мержа
    await migrateDb(db, { VERCEL_ENV: 'production' })
    expect(String((await tableRowid(db))?.sql)).toContain("'launched'")
    expect(await getCatalogMeta(db, 'schema_v')).toBe(String(CURRENT_SCHEMA_V))
    await logFeedback(db, { steamid: 'u1', appid: 730, action: 'launched' }, NOW)
    expect((await listFeedback(db, 'u1')).map((r) => r.action).sort()).toEqual(['banned', 'launched'])
  })

  test('превью без своей базы JSON-колонки не чинит и флаг не пишет', async () => {
    // Починка переписывает исходные данные, а владелец снимает бэкап перед
    // деплоем прода, не перед пушем ветки
    const db = await freshDb()
    await upsertGameMeta(db, { ...META, appid: 570 }, NOW)
    await db.execute({
      sql: 'UPDATE games SET tags_json = ? WHERE appid = 570',
      args: [JSON.stringify(JSON.stringify(META.tags))],
    })
    await db.execute("DELETE FROM catalog_meta WHERE key = 'repair_tags_v1'")
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await migrateDb(db, PREVIEW)
      // Молча: узнать, есть ли что чинить, стоит того же полного скана
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
    expect(await getCatalogMeta(db, 'repair_tags_v1')).toBeNull()
    expect(await repairGameJson(db, { dryRun: true })).toHaveLength(1)

    // Первый старт прода после мержа
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await migrateDb(db, { VERCEL_ENV: 'production' })
    } finally {
      quiet.mockRestore()
    }
    expect(await getCatalogMeta(db, 'repair_tags_v1')).toBe('1')
    expect(await repairGameJson(db, { dryRun: true })).toEqual([])
  })

  test('превью со своей базой мигрирует целиком', async () => {
    const db = await oldFeedbackDb()
    await migrateDb(db, { ...PREVIEW, [PREVIEW_OWN_DB_ENV]: '1' })
    expect(String((await tableRowid(db))?.sql)).toContain("'launched'")
    expect(await getCatalogMeta(db, 'schema_v')).toBe(String(CURRENT_SCHEMA_V))
  })

  test('если пересобирать нечего, превью версию пишет: пропущенного шага нет', async () => {
    const db = await freshDb()
    await db.execute("DELETE FROM catalog_meta WHERE key = 'schema_v'")
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await migrateDb(db, PREVIEW)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
    expect(await getCatalogMeta(db, 'schema_v')).toBe(String(CURRENT_SCHEMA_V))
  })
})

describe('файловая база', () => {
  test('ждёт чужую блокировку, а не падает сразу на SQLITE_BUSY', async () => {
    // Сборка на копии базы в файле гоняет migrateDb в каждом воркере разом.
    // Без ожидания первый же воркер, попавший на чужую запись, ронял сборку.
    // file::memory: — тот же путь через file:, но без файла на диске.
    const db = await createDb('file::memory:')
    const res = await db.execute('PRAGMA busy_timeout')
    expect(Number(res.rows[0].timeout)).toBe(10_000)
  })
})

describe('семантика игр', () => {
  /** Приор по тегам Portal 2 — basis 'tags' */
  const BY_TAGS = deriveSemantics({ Puzzle: 100, 'Co-op': 80 }, null)
  /** То же, но «по отзывам»: форма и basis — всё, что важно записи */
  const BY_REVIEWS: GameSemantics = { ...BY_TAGS, n: 60, basis: 'tags+reviews', confidence: 0.7 }

  async function stored(db: Db, appid: number) {
    const res = await db.execute({
      sql: 'SELECT v, basis, computed_at, reviews_at, json FROM game_semantics WHERE appid = ?',
      args: [appid],
    })
    const r = res.rows[0]
    return r
      ? {
          v: Number(r.v),
          basis: String(r.basis),
          computedAt: Number(r.computed_at),
          reviewsAt: r.reviews_at === null ? null : Number(r.reviews_at),
          semantics: parseSemantics(r.json),
        }
      : null
  }

  test('приор по тегам не затирает посчитанное по отзывам, даже будучи свежее', async () => {
    // Пересчёт каталога по тегам (semantics:build) занимает секунды и
    // приходит когда угодно — в том числе после крона страниц, который
    // заплатил за отзывы запросами в Steam
    const db = await freshDb()
    await upsertSemantics(db, [{ appid: 620, semantics: BY_REVIEWS, computedAt: NOW, reviewsAt: NOW }])
    await upsertSemantics(db, [{ appid: 620, semantics: BY_TAGS, computedAt: NOW + 3600 }])

    expect(await stored(db, 620)).toEqual({
      v: 1,
      basis: 'tags+reviews',
      computedAt: NOW,
      reviewsAt: NOW,
      semantics: BY_REVIEWS,
    })
  })

  test('посчитанное по отзывам вытесняет приор, даже более свежий', async () => {
    const db = await freshDb()
    await upsertSemantics(db, [{ appid: 620, semantics: BY_TAGS, computedAt: NOW + 3600 }])
    await upsertSemantics(db, [{ appid: 620, semantics: BY_REVIEWS, computedAt: NOW, reviewsAt: NOW }])

    expect((await stored(db, 620))?.basis).toBe('tags+reviews')
  })

  test('при равном basis побеждает свежий, старый не откатывает', async () => {
    const db = await freshDb()
    const fresh = { ...BY_REVIEWS, n: 90 }
    await upsertSemantics(db, [{ appid: 620, semantics: BY_REVIEWS, computedAt: NOW }])
    await upsertSemantics(db, [{ appid: 620, semantics: fresh, computedAt: NOW + 10 }])
    await upsertSemantics(db, [{ appid: 620, semantics: BY_REVIEWS, computedAt: NOW + 5 }])

    expect((await stored(db, 620))?.semantics?.n).toBe(90)
  })

  test('новая версия формата вытесняет старую при любом basis, старая новую — никогда', async () => {
    const db = await freshDb()
    await upsertSemantics(db, [{ appid: 620, semantics: BY_REVIEWS, computedAt: NOW }])
    // так выглядела бы запись v2 кодом после смены формата
    const v2 = { ...BY_TAGS, v: 2 } as unknown as GameSemantics
    await upsertSemantics(db, [{ appid: 620, semantics: v2, computedAt: NOW - 100 }])
    expect(await stored(db, 620)).toMatchObject({ v: 2, basis: 'tags', semantics: undefined })

    // запоздавший инстанс со старым кодом
    await upsertSemantics(db, [{ appid: 620, semantics: BY_REVIEWS, computedAt: NOW + 100 }])
    expect((await stored(db, 620))?.v).toBe(2)
  })

  test('новая версия сбрасывает отметку разбора отзывов: под новый формат их разберут снова', async () => {
    const db = await freshDb()
    await upsertSemantics(db, [{ appid: 620, semantics: BY_REVIEWS, computedAt: NOW, reviewsAt: NOW }])
    const v2 = { ...BY_TAGS, v: 2 } as unknown as GameSemantics
    await upsertSemantics(db, [{ appid: 620, semantics: v2, computedAt: NOW + 10 }])

    expect(await stored(db, 620)).toMatchObject({ v: 2, reviewsAt: null })
  })

  test('запись без отзывов не стирает отметку их разбора', async () => {
    const db = await freshDb()
    await upsertSemantics(db, [{ appid: 620, semantics: BY_TAGS, computedAt: NOW, reviewsAt: NOW }])
    await upsertSemantics(db, [{ appid: 620, semantics: BY_TAGS, computedAt: NOW + 10 }])

    expect(await stored(db, 620)).toMatchObject({ computedAt: NOW + 10, reviewsAt: NOW })
  })

  test('апсерт меты и перезапись колонок games семантику не трогают', async () => {
    // Весь смысл отдельной таблицы: заливка каталога уже стирала обогащение,
    // жившее в колонках games
    const db = await freshDb()
    await upsertGameMeta(db, META, NOW)
    await upsertSemantics(db, [{ appid: 620, semantics: BY_REVIEWS, computedAt: NOW }])
    await upsertGameMeta(db, { ...META, name: 'Portal 2 (перезалит)' }, NOW + 60)
    await db.execute("UPDATE games SET tags_json = '{}', tag_count = 0 WHERE appid = 620")

    expect((await getGamesMetaLite(db, [620])).get(620)?.semantics).toEqual(BY_REVIEWS)
  })

  test('выборки пачкой несут семантику, игра без неё остаётся в выборке', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, META, NOW)
    await upsertGameMeta(db, { ...META, appid: 730, name: 'CS2' }, NOW)
    await upsertSemantics(db, [{ appid: 620, semantics: BY_TAGS, computedAt: NOW }])

    for (const read of [getGamesMeta, getGamesMetaLite]) {
      const metas = await read(db, [620, 730])
      expect(metas.get(620)?.semantics, read.name).toEqual(BY_TAGS)
      const cs2 = metas.get(730)
      expect(cs2?.name, read.name).toBe('CS2')
      expect(cs2 && 'semantics' in cs2, read.name).toBe(false)
    }
  })

  test('мусор в json читается как «семантики нет», а не роняет библиотеку', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, META, NOW)
    await upsertGameMeta(db, { ...META, appid: 730, name: 'CS2' }, NOW)
    await db.batch(
      [
        {
          sql: `INSERT INTO game_semantics (appid, v, json, basis, computed_at)
                VALUES (620, 1, ?, 'tags', ?)`,
          args: ['не json', NOW],
        },
        {
          sql: `INSERT INTO game_semantics (appid, v, json, basis, computed_at)
                VALUES (730, 1, ?, 'tags', ?)`,
          args: [JSON.stringify({ v: 1, axes: { challenge: 'много' } }), NOW],
        },
      ],
      'write',
    )

    const metas = await getGamesMetaLite(db, [620, 730])
    expect(metas.get(620)?.name).toBe('Portal 2')
    expect(metas.get(620)?.semantics).toBeUndefined()
    expect(metas.get(730)?.semantics).toBeUndefined()
  })

  test('parseSemantics: целиком или никак', () => {
    expect(parseSemantics(JSON.stringify(BY_TAGS))).toEqual(BY_TAGS)
    // дважды закодированное разворачивается, как у тегов
    expect(parseSemantics(JSON.stringify(JSON.stringify(BY_TAGS)))).toEqual(BY_TAGS)
    // лишнее из базы дальше не едет
    expect(parseSemantics(JSON.stringify({ ...BY_TAGS, лишнее: 1 }))).toEqual(BY_TAGS)

    const broken: unknown[] = [
      null,
      undefined,
      '',
      '[]',
      JSON.stringify({ ...BY_TAGS, v: 2 }),
      JSON.stringify({ ...BY_TAGS, axes: { ...BY_TAGS.axes, pace: 'быстро' } }),
      JSON.stringify({ ...BY_TAGS, axes: { ...BY_TAGS.axes, challenge: 140 } }),
      JSON.stringify({ ...BY_TAGS, session: { ...BY_TAGS.session, bucket: 'вечность' } }),
      JSON.stringify({ ...BY_TAGS, session: { ...BY_TAGS.session, canStopAnytime: 'да' } }),
      JSON.stringify({ ...BY_TAGS, timeToFun: { bucket: 'slow', hours: -1 } }),
      JSON.stringify({ ...BY_TAGS, confidence: 1.5 }),
      JSON.stringify({ ...BY_TAGS, basis: 'llm' }),
      JSON.stringify({ ...BY_TAGS, timeToFun: null }),
    ]
    for (const raw of broken) expect(parseSemantics(raw), String(raw)).toBeUndefined()
  })
})

/**
 * Исход совета (lib/outcome.ts): запуск пишет минуты до, следующий снапшот —
 * минуты после, и по заметно сыгранному спрашивают «как тебе?».
 */
describe('исход совета', () => {
  const ME = '76561198000000001'
  const DAY = 86_400

  /** Запуск своей заброшенной с /play */
  const launch = (db: Db, appid: number, at: number) =>
    recordOutcome(db, { steamid: ME, appid, source: 'untouched', launched: true }, at)

  async function outcomeRows(db: Db) {
    const res = await db.execute({
      sql: `SELECT appid, source, shown_at, launched_at, minutes_before, minutes_after, owned_after,
                   checked_at, verdict FROM outcomes WHERE steamid = ? ORDER BY appid, shown_at`,
      args: [ME],
    })
    return res.rows.map((r) => ({
      appid: Number(r.appid),
      source: r.source,
      shownAt: Number(r.shown_at),
      launchedAt: r.launched_at === null ? null : Number(r.launched_at),
      before: r.minutes_before === null ? null : Number(r.minutes_before),
      after: r.minutes_after === null ? null : Number(r.minutes_after),
      owned: r.owned_after === null ? null : Number(r.owned_after),
      checkedAt: r.checked_at === null ? null : Number(r.checked_at),
      verdict: r.verdict,
    }))
  }

  test('запуск пишет минуты до из последнего снапшота, у не своей игры их нет', async () => {
    const db = await freshDb()
    await saveLibrarySnapshot(db, ME, LIB, NOW - DAY)
    await recordOutcome(db, { steamid: ME, appid: 620, source: 'untouched', launched: true }, NOW)
    // 6200 — подстрока 620 в тексте снапшота не должна дать минуты Portal 2
    await recordOutcome(db, { steamid: ME, appid: 6200, source: 'new', launched: false }, NOW)
    expect(await outcomeRows(db)).toEqual([
      {
        appid: 620,
        source: 'untouched',
        shownAt: NOW,
        launchedAt: NOW,
        before: 30,
        after: null,
        owned: null,
        checkedAt: null,
        verdict: null,
      },
      {
        appid: 6200,
        source: 'new',
        shownAt: NOW,
        launchedAt: null,
        before: null,
        after: null,
        owned: null,
        checkedAt: null,
        verdict: null,
      },
    ])
  })

  // «Твои вечера» на /library: свои советы за окно, новые первыми
  test('listEvenings — свои за окно, новые первыми, с приростом минут', async () => {
    const db = await freshDb()
    await saveLibrarySnapshot(db, ME, LIB, NOW - 100 * DAY)
    await recordOutcome(db, { steamid: ME, appid: 620, source: 'untouched', launched: true }, NOW - 95 * DAY)
    await saveLibrarySnapshot(db, ME, LIB, NOW - 3 * DAY)
    await launch(db, 620, NOW - 2 * DAY)
    await recordOutcome(db, { steamid: ME, appid: 999, source: 'new', launched: false }, NOW - DAY)
    await recordOutcome(db, { steamid: '76561198000000002', appid: 620, source: 'untouched', launched: true }, NOW)
    await saveLibrarySnapshot(
      db,
      ME,
      LIB.map((g) => (g.appid === 620 ? { ...g, playtimeForever: g.playtimeForever + 50 } : g)),
      NOW,
    )
    const list = await listEvenings(db, ME, NOW - 90 * DAY)
    expect(list.map((e) => [e.appid, e.shownAt])).toEqual([
      [999, NOW - DAY],
      [620, NOW - 2 * DAY],
    ])
    expect(list[1]).toMatchObject({ launched: true, minutes: 50 })
    // игры нет и после снапшота — заглянул и не взял: сверено, сыграно ноль
    expect(list[0]).toMatchObject({ launched: false, minutes: 0, bought: false })
  })

  test('повтор в окне — та же строка; запуск после магазина дописывает время запуска', async () => {
    const db = await freshDb()
    await saveLibrarySnapshot(db, ME, LIB, NOW - DAY)
    await recordOutcome(db, { steamid: ME, appid: 999, source: 'new', launched: false }, NOW)
    await recordOutcome(db, { steamid: ME, appid: 999, source: 'new', launched: true }, NOW + DAY)
    await recordOutcome(db, { steamid: ME, appid: 999, source: 'new', launched: true }, NOW + 2 * DAY)
    const rows = await outcomeRows(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ shownAt: NOW, launchedAt: NOW + DAY })

    // За окном — уже новый совет
    const later = NOW + OUTCOME_WINDOW_SEC + DAY
    await recordOutcome(db, { steamid: ME, appid: 999, source: 'new', launched: true }, later)
    expect(await outcomeRows(db)).toHaveLength(2)
  })

  test('свежий снапшот дописывает минуты после и покупку, строки за окном не трогает', async () => {
    const db = await freshDb()
    await saveLibrarySnapshot(db, ME, LIB, NOW - 20 * DAY)
    await launch(db, 620, NOW - 20 * DAY + 60)
    await saveLibrarySnapshot(db, ME, LIB, NOW - DAY)
    await recordOutcome(db, { steamid: ME, appid: 620, source: 'untouched', launched: true }, NOW - DAY + 60)
    await recordOutcome(db, { steamid: ME, appid: 999, source: 'new', launched: false }, NOW - DAY + 60)
    await recordOutcome(db, { steamid: ME, appid: 888, source: 'new', launched: false }, NOW - DAY + 60)

    const fresh = [
      { ...LIB[1]!, playtimeForever: 150 },
      { appid: 999, name: 'Купленная', playtimeForever: 45, playtime2Weeks: 45 },
      LIB[0]!,
    ]
    // Через saveLibrarySnapshot: сверка идёт на любой дороге, что приносит снапшот
    await saveLibrarySnapshot(db, ME, fresh, NOW)
    const rows = await outcomeRows(db)
    expect(rows.map((r) => [r.appid, r.shownAt, r.before, r.after, r.owned, r.checkedAt])).toEqual([
      // старая строка — за окном, её никто не сверяет
      [620, NOW - 20 * DAY + 60, 30, null, null, null],
      [620, NOW - DAY + 60, 30, 150, 1, NOW],
      [888, NOW - DAY + 60, null, null, 0, NOW],
      [999, NOW - DAY + 60, null, 45, 1, NOW],
    ])
  })

  test('строка моложе снапшота не сверяется: совет ещё ни во что не превратился', async () => {
    const db = await freshDb()
    await recordOutcome(db, { steamid: ME, appid: 620, source: 'untouched', launched: true }, NOW)
    expect(await fillOutcomesFromSnapshot(db, ME, LIB, NOW)).toBe(0)
    expect((await outcomeRows(db))[0]?.checkedAt).toBeNull()
  })

  test('«как тебе?» — по заметно сыгранному, свежий первым, с именем из каталога', async () => {
    const db = await freshDb()
    await upsertGamesMeta(
      db,
      [620, 999, 777].map((appid) => ({ ...META, appid, name: `Игра ${appid}` })),
      NOW,
    )
    await saveLibrarySnapshot(db, ME, LIB, NOW - 3 * DAY)
    await launch(db, 620, NOW - 3 * DAY + 1)
    await recordOutcome(db, { steamid: ME, appid: 999, source: 'new', launched: false }, NOW - 2 * DAY)
    await recordOutcome(db, { steamid: ME, appid: 777, source: 'backlog', launched: true }, NOW - DAY)
    await saveLibrarySnapshot(
      db,
      ME,
      [
        { ...LIB[1]!, playtimeForever: 30 + 90 },
        { appid: 999, name: 'Игра 999', playtimeForever: 200, playtime2Weeks: 200 },
        // 777 сыграна меньше порога — это проба, а не игра
        { appid: 777, name: 'Игра 777', playtimeForever: 5, playtime2Weeks: 5 },
      ],
      NOW,
    )

    expect(await pendingOutcomeAsk(db, ME, NOW)).toEqual({
      appid: 999,
      name: 'Игра 999',
      shownAt: NOW - 2 * DAY,
      minutes: 200,
      bought: true,
    })
    // Ответили — следующий по свежести
    expect(await setOutcomeVerdict(db, ME, 999, NOW - 2 * DAY, 'meh')).toEqual({ changed: true, was: null })
    expect(await pendingOutcomeAsk(db, ME, NOW)).toMatchObject({ appid: 620, minutes: 90, bought: false })
    // Ответ можно поменять («Твои вечера» на /library), а тот же ответ
    // повтором ничего не пишет — роуту это говорит, что «зашло» заводить незачем
    expect(await setOutcomeVerdict(db, ME, 999, NOW - 2 * DAY, 'meh')).toEqual({ changed: false, was: 'meh' })
    expect(await setOutcomeVerdict(db, ME, 999, NOW - 2 * DAY, 'hooked')).toEqual({ changed: true, was: 'meh' })
    // «Закрыть» из забытой всплывашки настоящий ответ не стирает
    expect(await setOutcomeVerdict(db, ME, 999, NOW - 2 * DAY, 'dismissed')).toEqual({
      changed: false,
      was: 'hooked',
    })
    expect((await outcomeRows(db)).find((r) => r.appid === 999)?.verdict).toBe('hooked')
    // Спрашивать об отвеченном по-прежнему незачем
    expect(await pendingOutcomeAsk(db, ME, NOW)).toMatchObject({ appid: 620 })
    expect(await setOutcomeVerdict(db, ME, 620, NOW - 3 * DAY + 1, 'dismissed')).toEqual({
      changed: true,
      was: null,
    })
    // а отказ отвечать ответом переписать можно
    expect(await setOutcomeVerdict(db, ME, 620, NOW - 3 * DAY + 1, 'meh')).toEqual({
      changed: true,
      was: 'dismissed',
    })
    // строки нет — ничего не изменилось
    expect(await setOutcomeVerdict(db, ME, 12_345, NOW, 'hooked')).toEqual({ changed: false, was: null })
    expect(await pendingOutcomeAsk(db, ME, NOW)).toBeNull()
  })

  test('за окном не спрашиваем: вопрос про прошлый месяц — не забота, а слежка', async () => {
    const db = await freshDb()
    await upsertGamesMeta(db, [{ ...META, appid: 620 }], NOW)
    await saveLibrarySnapshot(db, ME, LIB, NOW - 20 * DAY)
    await launch(db, 620, NOW - 20 * DAY + 1)
    await saveLibrarySnapshot(db, ME, [{ ...LIB[1]!, playtimeForever: 500 }], NOW - 19 * DAY)
    expect(await pendingOutcomeAsk(db, ME, NOW - 19 * DAY)).not.toBeNull()
    expect(await pendingOutcomeAsk(db, ME, NOW)).toBeNull()
  })

  test('уборка стирает исходы старше девяноста дней', async () => {
    const db = await freshDb()
    await launch(db, 620, NOW - OUTCOME_TTL_SEC - DAY)
    await launch(db, 570, NOW - OUTCOME_TTL_SEC + DAY)
    expect((await sweepStale(db, NOW)).outcomes).toBe(1)
    expect((await outcomeRows(db)).map((r) => r.appid)).toEqual([570])
  })
})

describe('кто сравнился с тобой', () => {
  const A = '76561198000000011'
  const B = '76561198000000012'
  const C = '76561198000000013'

  test('пишется только пара двух разных живых людей с процентом 0..100', async () => {
    const db = await freshDb()
    await expect(recordCompatView(db, { owner: A, viewer: A, percent: 50 }, NOW)).rejects.toThrow()
    await expect(recordCompatView(db, { owner: A, viewer: '00012345678901234', percent: 50 }, NOW)).rejects.toThrow()
    await expect(recordCompatView(db, { owner: A, viewer: B, percent: 101 }, NOW)).rejects.toThrow()
    await expect(recordCompatView(db, { owner: A, viewer: B, percent: 12.5 }, NOW)).rejects.toThrow()
    expect(await listCompatViews(db, A, 0)).toEqual([])
  })

  test('повтор в те же сутки — без записи, новый процент — обновляет', async () => {
    const db = await freshDb()
    await recordCompatView(db, { owner: A, viewer: B, percent: 60 }, NOW)
    await recordCompatView(db, { owner: A, viewer: B, percent: 60 }, NOW + 3600)
    expect(await listCompatViews(db, A, 0)).toEqual([{ steamid: B, name: null, percent: 60, at: NOW }])
    await recordCompatView(db, { owner: A, viewer: B, percent: 64 }, NOW + 7200)
    expect(await listCompatViews(db, A, 0)).toEqual([{ steamid: B, name: null, percent: 64, at: NOW + 7200 }])
    // через сутки — обновляет и тот же процент: «когда сравнивались» свежеет
    await recordCompatView(db, { owner: A, viewer: B, percent: 64 }, NOW + 7200 + 90_000)
    expect((await listCompatViews(db, A, 0))[0]?.at).toBe(NOW + 7200 + 90_000)
  })

  test('свежие первыми, с ником, старше срока не видны и уходят в уборке', async () => {
    const db = await freshDb()
    await upsertUser(db, { steamid: C, personaName: 'Сэм' }, NOW)
    await recordCompatView(db, { owner: A, viewer: B, percent: 30 }, NOW - COMPAT_VIEW_TTL_SEC - 10)
    await recordCompatView(db, { owner: A, viewer: C, percent: 80 }, NOW)
    expect(await listCompatViews(db, A, NOW - COMPAT_VIEW_TTL_SEC)).toEqual([
      { steamid: C, name: 'Сэм', percent: 80, at: NOW },
    ])
    const report = await sweepStale(db, NOW)
    expect(report.compat).toBe(1)
    expect((await listCompatViews(db, A, 0)).map((v) => v.steamid)).toEqual([C])
  })
})

describe('выбор, которым поделились (/pick/<id>)', () => {
  const A = '76561198000000021'
  const row = (id: string, over: Partial<{ appid: number; reason: string }> = {}) => ({
    id,
    createdBy: A,
    appid: 620,
    source: 'untouched' as const,
    kind: 'play' as const,
    reason: 'Вечер на головоломки.',
    ...over,
  })

  test('публичное чтение — без автора; истёкшее не отдаётся ещё до уборки', async () => {
    const db = await freshDb()
    await createSharedPick(db, row('abcdefghjkmn'), NOW)
    const got = await getSharedPick(db, 'abcdefghjkmn', NOW - SHARED_PICK_TTL_SEC)
    expect(got).toEqual({
      id: 'abcdefghjkmn',
      appid: 620,
      source: 'untouched',
      kind: 'play',
      reason: 'Вечер на головоломки.',
      createdAt: NOW,
    })
    expect(await getSharedPick(db, 'abcdefghjkmn', NOW + 1)).toBeNull()
    expect(await getSharedPick(db, 'nosuchpick23', 0)).toBeNull()
  })

  test('повтор находится по автору, игре, виду и тексту — и только свежий', async () => {
    const db = await freshDb()
    await createSharedPick(db, row('abcdefghjkmn'), NOW)
    const text = 'Вечер на головоломки.'
    expect(await findSharedPick(db, A, 620, 'play', text, NOW - 60)).toBe('abcdefghjkmn')
    expect(await findSharedPick(db, A, 620, 'play', 'Другой текст.', NOW - 60)).toBeNull()
    expect(await findSharedPick(db, A, 570, 'play', text, NOW - 60)).toBeNull()
    expect(await findSharedPick(db, '76561198000000022', 620, 'play', text, NOW - 60)).toBeNull()
    expect(await findSharedPick(db, A, 620, 'play', text, NOW + 1)).toBeNull()
    // тот же текст игрой дня — другая страница с другой подписью
    expect(await findSharedPick(db, A, 620, 'daily', text, NOW - 60)).toBeNull()
  })

  test('тот же id дважды — ошибка ключа: роут пробует другой', async () => {
    const db = await freshDb()
    await createSharedPick(db, row('abcdefghjkmn'), NOW)
    await expect(createSharedPick(db, row('abcdefghjkmn', { appid: 570 }), NOW)).rejects.toThrow(/UNIQUE|PRIMARY/i)
  })

  test('старше срока уходят в суточной уборке', async () => {
    const db = await freshDb()
    await createSharedPick(db, row('oldpick23456'), NOW - SHARED_PICK_TTL_SEC - 10)
    await createSharedPick(db, row('newpick23456', { reason: 'Свежий.' }), NOW)
    expect((await sweepStale(db, NOW)).picks).toBe(1)
    expect(await getSharedPick(db, 'oldpick23456', 0)).toBeNull()
    expect(await getSharedPick(db, 'newpick23456', 0)).not.toBeNull()
  })
})
