import { describe, expect, test } from 'vitest'
import {
  claimPageEnrichBatch,
  countPageEnrichDue,
  createDb,
  createRoom,
  createSharedPick,
  findSharedPick,
  freshlyDigestedPatches,
  gameDescriptions,
  getFeedForApps,
  getGameMeta,
  getGameNews,
  getGamePatchHeads,
  getGamesMetaLite,
  getLovedFor,
  getNewsPage,
  getRssFeedForApps,
  getSharedPick,
  getUnsummarized,
  getUnsummarizedEn,
  getUserPortrait,
  joinRoom,
  latestMajorPatchSince,
  listPublicRooms,
  markPageEnriched,
  migrateDb,
  saveLibrarySnapshot,
  setGameDescriptions,
  setGameJson,
  setGamesMedia,
  setNewsDigest,
  setNewsDigestEn,
  setRoomPublic,
  setUserPortrait,
  sitemapNews,
  upsertGameMeta,
  upsertNewsItems,
  type Db,
  type StoredNews,
} from './db'
import type { GameMeta, LibraryGame } from './types'

/*
 * Хранение по языку (docs/i18n.md, v10 схемы): у всего, что лежит в базе для
 * человека, — английский слот рядом с русским. Русский путь обязан остаться
 * прежним до байта, английский — не подменять себя русским.
 */

const NOW = 1_700_000_000
const DAY = 86_400
const freshDb = () => createDb(':memory:')

const LIB: LibraryGame[] = [{ appid: 620, name: 'Portal 2', playtimeForever: 600, playtime2Weeks: 0 }]

function game(appid: number, over: Partial<GameMeta> = {}): GameMeta {
  return {
    appid,
    name: `Game ${appid}`,
    tags: { Puzzle: 100 },
    genres: [],
    categories: [2],
    reviewsTotal: 1000 - appid,
    ...over,
  }
}

function patch(appid: number, gid: string, over: Partial<StoredNews> = {}): StoredNews {
  return {
    appid,
    gid,
    title: 'Обновление 1.2',
    url: `https://store.steampowered.com/news/app/${appid}/view/${gid}`,
    publishedAt: NOW - DAY,
    kind: 'patch',
    scale: 'major',
    blocks: [{ kind: 'p', runs: [{ text: 'Fixed the crash on load.' }] }],
    bodyHash: `h${gid}`,
    rank: 1000,
    ...over,
  }
}

describe('портрет: слот на язык', () => {
  async function withSnapshot(steamid: string): Promise<Db> {
    const db = await freshDb()
    await saveLibrarySnapshot(db, steamid, LIB, NOW)
    return db
  }

  test('английский ложится в en и русского не трогает, русский — наоборот', async () => {
    const db = await withSnapshot('u1')
    await setUserPortrait(db, 'u1', { takenAt: NOW, text: 'ты — легенда бэклога', v: 2 })
    await setUserPortrait(db, 'u1', { takenAt: NOW, text: 'you are a backlog legend', v: 2 }, 'en')

    expect(await getUserPortrait(db, 'u1', 'en')).toEqual({ takenAt: NOW, text: 'you are a backlog legend', v: 2 })
    // Русский — верхний уровень, как раньше; английский слот едет рядом
    expect(await getUserPortrait(db, 'u1')).toEqual({
      takenAt: NOW,
      text: 'ты — легенда бэклога',
      v: 2,
      en: { takenAt: NOW, text: 'you are a backlog legend', v: 2 },
    })

    // Перезапись русского английский слот не стирает
    await setUserPortrait(db, 'u1', { takenAt: NOW, text: 'новый русский текст' })
    expect((await getUserPortrait(db, 'u1'))?.text).toBe('новый русский текст')
    expect((await getUserPortrait(db, 'u1', 'en'))?.text).toBe('you are a backlog legend')
  })

  test('без английского слота русская запись — ровно прежний JSON', async () => {
    const db = await withSnapshot('u2')
    await setUserPortrait(db, 'u2', { takenAt: NOW, text: 'портрет' })
    const raw = await db.execute("SELECT portrait_json FROM users WHERE steamid = 'u2'")
    expect(raw.rows[0]?.portrait_json).toBe(JSON.stringify({ takenAt: NOW, text: 'портрет' }))
    expect(await getUserPortrait(db, 'u2', 'en')).toBeNull()
  })

  test('первый заход с /en: русского текста нет, а не «запись без текста»', async () => {
    const db = await withSnapshot('u3')
    await setUserPortrait(db, 'u3', { takenAt: NOW, text: 'an English-only portrait' }, 'en')
    expect(await getUserPortrait(db, 'u3')).toBeNull()
    expect(await getUserPortrait(db, 'u3', 'en')).toEqual({ takenAt: NOW, text: 'an English-only portrait' })
  })

  test('английский — под тем же условием снимка, что и русский', async () => {
    const db = await withSnapshot('u4')
    await setUserPortrait(db, 'u4', { takenAt: NOW - 60, text: 'not my snapshot' }, 'en')
    expect(await getUserPortrait(db, 'u4', 'en')).toBeNull()
  })

  test('битая строка — нет текста ни на одном языке, а не исключение', async () => {
    const db = await withSnapshot('u5')
    await db.execute("INSERT INTO users (steamid, portrait_json, created_at, last_seen_at) VALUES ('u5', '{oops', 1, 1)")
    expect(await getUserPortrait(db, 'u5')).toBeNull()
    expect(await getUserPortrait(db, 'u5', 'en')).toBeNull()
    // и запись поверх битой строки её чинит, а не падает на json_type
    await setUserPortrait(db, 'u5', { takenAt: NOW, text: 'fixed' }, 'en')
    expect((await getUserPortrait(db, 'u5', 'en'))?.text).toBe('fixed')
  })
})

describe('выбор, которым поделились: язык ссылки', () => {
  const A = '76561198000000021'
  const row = { id: 'abcdefghjkmn', createdBy: A, appid: 620, source: 'untouched' as const, kind: 'play' as const }

  test('английская ссылка помнит язык, русская — по умолчанию', async () => {
    const db = await freshDb()
    await createSharedPick(db, { ...row, reason: 'A puzzle night.', lang: 'en' }, NOW)
    await createSharedPick(db, { ...row, id: 'mnpqrstuvwxy', reason: 'Вечер на головоломки.' }, NOW)
    expect((await getSharedPick(db, 'abcdefghjkmn', 0))?.lang).toBe('en')
    expect((await getSharedPick(db, 'mnpqrstuvwxy', 0))?.lang).toBe('ru')
  })

  test('язык — часть ключа повтора: тот же текст на другом языке — другая ссылка', async () => {
    const db = await freshDb()
    await createSharedPick(db, { ...row, reason: 'Portal 2', lang: 'en' }, NOW)
    expect(await findSharedPick(db, A, 620, 'play', 'Portal 2', NOW - 60, 'en')).toBe('abcdefghjkmn')
    expect(await findSharedPick(db, A, 620, 'play', 'Portal 2', NOW - 60)).toBeNull()
  })
})

describe('описание по-английски', () => {
  const RU = 'Головоломка с порталами и лучший кооператив на свете.'
  const EN = 'The highly anticipated sequel to the puzzle game of the year.'

  test('апсерт пишет английское в свою колонку, пустое его не стирает', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, game(620, { shortDescription: RU, shortDescriptionEn: EN }), NOW)
    expect(await getGameMeta(db, 620)).toMatchObject({ shortDescription: RU, shortDescriptionEn: EN })
    // прогрев без английского поля — английское остаётся
    await upsertGameMeta(db, game(620, { shortDescription: RU }), NOW + 1)
    expect((await getGameMeta(db, 620))?.shortDescriptionEn).toBe(EN)
    // и узкая выборка его везёт: «О чём игра» на /en читается ею
    expect((await getGamesMetaLite(db, [620])).get(620)?.shortDescriptionEn).toBe(EN)
  })

  test('без английского поля мета прежняя: ключа нет вовсе', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, game(620, { shortDescription: RU }), NOW)
    expect(await getGameMeta(db, 620)).not.toHaveProperty('shortDescriptionEn')
  })

  test('узкий UPDATE медиа довозит английское описание и русского не касается', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, game(620, { shortDescription: RU }), NOW)
    expect(await setGamesMedia(db, [{ appid: 620, shortDescriptionEn: EN }])).toBe(1)
    expect(await getGameMeta(db, 620)).toMatchObject({ shortDescription: RU, shortDescriptionEn: EN })
  })

  test('доливка описаний по-английски — своя колонка в обе стороны', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, game(620, { shortDescription: RU }), NOW)
    expect(await gameDescriptions(db, 10, 'en')).toEqual([{ appid: 620, description: null }])
    expect(await setGameDescriptions(db, [{ appid: 620, description: EN }], 'en')).toBe(1)
    expect(await gameDescriptions(db, 10, 'en')).toEqual([{ appid: 620, description: EN }])
    // русская доливка — как была
    expect(await gameDescriptions(db, 10)).toEqual([{ appid: 620, description: RU }])
  })
})

describe('«За что любят» по-английски', () => {
  test('только слот en пересказа модели; без слота строки нет', async () => {
    const db = await freshDb()
    for (const appid of [620, 621]) await upsertGameMeta(db, game(appid), NOW)
    await setGameJson(db, 620, 'pros_cons_json', {
      pros: ['Сюжет'],
      cons: [],
      source: 'claude',
      en: { pros: [' Story ', ''], cons: [] },
    })
    await setGameJson(db, 621, 'pros_cons_json', { pros: ['Юмор'], cons: [], source: 'claude' })
    expect([...(await getLovedFor(db, [620, 621], 'en')).entries()]).toEqual([[620, ['Story']]])
    expect([...(await getLovedFor(db, [620, 621])).entries()]).toEqual([
      [620, ['Сюжет']],
      [621, ['Юмор']],
    ])
  })
})

describe('очередь карточек: пересказ модели без английского слота', () => {
  test('возвращается по сроку пересборки, только когда просят', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, game(10), NOW)
    await upsertGameMeta(db, game(20), NOW)
    // 10 — пересказ модели до английской версии, 20 — уже с английским
    await setGameJson(db, 10, 'pros_cons_json', { pros: ['а'], cons: [], source: 'claude' })
    await setGameJson(db, 20, 'pros_cons_json', { pros: ['а'], cons: [], source: 'claude', en: { pros: ['a'], cons: [] } })
    for (const appid of [10, 20]) await markPageEnriched(db, appid, NOW - 30 * DAY)

    const stale = NOW - 180 * DAY
    expect(await claimPageEnrichBatch(db, stale, 10)).toEqual([])
    const opts = { redoEnglish: true, redoBefore: NOW - 7 * DAY }
    expect(await claimPageEnrichBatch(db, stale, 10, opts)).toEqual([10])
    // счётчик видит ту же очередь, что и выборка
    expect(await countPageEnrichDue(db, stale, 0, opts)).toBe(1)
    // свежая отметка — ждёт срока, как эвристика
    expect(await claimPageEnrichBatch(db, stale, 10, { redoEnglish: true, redoBefore: NOW - 60 * DAY })).toEqual([])
  })
})

describe('пересказ патча: английский слот', () => {
  async function seeded(): Promise<Db> {
    const db = await freshDb()
    await upsertNewsItems(db, [patch(730, '1'), patch(570, '2')], NOW)
    return db
  }

  test('один вызов пишет оба языка и английский заголовок', async () => {
    const db = await seeded()
    await setNewsDigest(
      db,
      730,
      '1',
      { tldr: 'Починили вылет.', scale: 'major', tldrEn: 'Fixed the crash.', titleEn: 'Update 1.2' },
      NOW,
    )
    const [item] = await getGameNews(db, 730)
    expect(item).toMatchObject({ tldr: 'Починили вылет.', tldrEn: 'Fixed the crash.', titleEn: 'Update 1.2' })
    expect(await getGamePatchHeads(db, 730)).toEqual([
      { gid: '1', title: 'Обновление 1.2', publishedAt: NOW - DAY, scale: 'major', titleEn: 'Update 1.2' },
    ])
    expect((await getNewsPage(db, 730, '1'))?.item.tldrEn).toBe('Fixed the crash.')
    expect((await getFeedForApps(db, [730]))[0]?.titleEn).toBe('Update 1.2')
  })

  test('прежний договор модели (без tldrEn) английских колонок не трогает', async () => {
    const db = await seeded()
    await setNewsDigest(db, 730, '1', { tldr: 'Починили вылет.', scale: 'major' }, NOW)
    const r = await db.execute("SELECT tldr_en, tldr_en_tries FROM news_items WHERE appid = 730")
    expect(r.rows[0]).toMatchObject({ tldr_en: null, tldr_en_tries: 0 })
    // и такой патч — в очереди английского догона
    expect((await getUnsummarizedEn(db)).map((n) => n.gid)).toEqual(['1'])
    expect(await getGameNews(db, 730)).toEqual([expect.not.objectContaining({ tldrEn: expect.anything() })])
  })

  test('английский не вышел — попытка в свой счётчик, русский записан', async () => {
    const db = await seeded()
    await setNewsDigest(db, 730, '1', { tldr: 'Починили вылет.', scale: 'major', tldrEn: null, titleEn: null }, NOW)
    const r = await db.execute('SELECT tldr, tldr_en, tldr_en_tries FROM news_items WHERE appid = 730')
    expect(r.rows[0]).toMatchObject({ tldr: 'Починили вылет.', tldr_en: null, tldr_en_tries: 1 })
  })

  test('догон: три неудачи — и запись выходит из очереди; удача пишет только английское', async () => {
    const db = await seeded()
    await setNewsDigest(db, 730, '1', { tldr: 'Починили вылет.', scale: 'major' }, NOW)
    await setNewsDigest(db, 570, '2', { tldr: 'Новый режим.', scale: 'hotfix' }, NOW)
    for (let i = 0; i < 3; i++) await setNewsDigestEn(db, 570, '2', null, NOW)
    expect((await getUnsummarizedEn(db)).map((n) => n.appid)).toEqual([730])

    await setNewsDigestEn(db, 730, '1', { tldrEn: ' Fixed the crash. ', titleEn: null }, NOW + 60)
    expect(await getUnsummarizedEn(db)).toEqual([])
    const [item] = await getGameNews(db, 730)
    // русский пересказ и масштаб — от основного пересказа, нетронутые
    expect(item).toMatchObject({ tldr: 'Починили вылет.', scale: 'major', tldrEn: 'Fixed the crash.' })
    expect(item).not.toHaveProperty('titleEn')
    // русская очередь пустая — догон её не задел
    expect(await getUnsummarized(db)).toEqual([])
  })

  test('новое тело сбрасывает оба языка, новый заголовок — английский заголовок', async () => {
    const db = await seeded()
    await setNewsDigest(
      db,
      730,
      '1',
      { tldr: 'Починили вылет.', scale: 'major', tldrEn: 'Fixed the crash.', titleEn: 'Update 1.2' },
      NOW,
    )
    // тот же текст, другой английский заголовок: пересказы живут, перевод
    // заголовка уходит — /en покажет сам новый заголовок
    await upsertNewsItems(db, [patch(730, '1', { title: 'Update 1.2.1' })], NOW + 60)
    let [item] = await getGameNews(db, 730)
    expect(item).toMatchObject({ tldr: 'Починили вылет.', tldrEn: 'Fixed the crash.' })
    expect(item).not.toHaveProperty('titleEn')

    // другое тело — пересказа другого текста нет ни на каком языке
    await upsertNewsItems(db, [patch(730, '1', { title: 'Обновление 1.2.1', bodyHash: 'other' })], NOW + 120)
    ;[item] = await getGameNews(db, 730)
    expect(item).not.toHaveProperty('tldr')
    expect(item).not.toHaveProperty('tldrEn')
    const r = await db.execute('SELECT tldr_en_at, tldr_en_tries FROM news_items WHERE appid = 730')
    expect(r.rows[0]).toMatchObject({ tldr_en_at: null, tldr_en_tries: 0 })
  })

  test('новый русский заголовок при том же теле — запись снова в очереди догона, русское на месте', async () => {
    // Раньше перевод заголовка уходил навсегда: tldr_en оставался, а очередь
    // догона видит только пустой tldr_en — и пост до конца жизни звался на
    // /en запасным «{Игра} update»
    const db = await seeded()
    await setNewsDigest(
      db,
      730,
      '1',
      { tldr: 'Починили вылет.', scale: 'major', tldrEn: 'Fixed the crash.', titleEn: 'Update 1.2' },
      NOW,
    )
    await setNewsDigest(db, 570, '2', { tldr: 'Новый режим.', scale: 'major', tldrEn: 'New mode.', titleEn: 'Update' }, NOW)
    expect(await getUnsummarizedEn(db)).toEqual([])

    await upsertNewsItems(db, [patch(730, '1', { title: 'Обновление 2' })], NOW + 60)
    const r = await db.execute('SELECT tldr, scale, tldr_en, tldr_en_at, tldr_en_tries, title_en FROM news_items WHERE appid = 730')
    expect(r.rows[0]).toMatchObject({
      tldr: 'Починили вылет.',
      scale: 'major',
      tldr_en: null,
      tldr_en_at: null,
      tldr_en_tries: 0,
      title_en: null,
    })
    expect((await getUnsummarizedEn(db)).map((n) => n.gid)).toEqual(['1'])

    // тот же заголовок и то же тело — слоты не трогаются
    await upsertNewsItems(db, [patch(570, '2')], NOW + 60)
    expect((await getGameNews(db, 570))[0]).toMatchObject({ tldrEn: 'New mode.', titleEn: 'Update' })
  })

  test('карта сайта, IndexNow и факт о патче на /en — только с английским пересказом', async () => {
    const db = await seeded()
    await setNewsDigest(db, 730, '1', { tldr: 'Починили вылет.', scale: 'major', tldrEn: 'Fixed the crash.' }, NOW)
    await setNewsDigest(db, 570, '2', { tldr: 'Новый режим.', scale: 'major' }, NOW)

    expect((await sitemapNews(db, NOW - 90 * DAY, 100)).map((r) => r.appid).sort()).toEqual([570, 730])
    expect((await sitemapNews(db, NOW - 90 * DAY, 100, 'en')).map((r) => r.appid)).toEqual([730])
    expect(await freshlyDigestedPatches(db, NOW - 90 * DAY, NOW - 1, 100, 'en')).toEqual([
      { appid: 730, gid: '1', digestedAt: NOW },
    ])
    const pairs = [[730, NOW - 7 * DAY], [570, NOW - 7 * DAY]] as const
    expect(await latestMajorPatchSince(db, pairs, 'en')).toEqual(new Map([[730, 'Fixed the crash.']]))
    expect(await latestMajorPatchSince(db, pairs)).toEqual(
      new Map([
        [730, 'Починили вылет.'],
        [570, 'Новый режим.'],
      ]),
    )
  })

  test('ридер на /en получает тело, пока нет английского пересказа', async () => {
    const db = await seeded()
    await setNewsDigest(db, 730, '1', { tldr: 'Починили вылет.', scale: 'major' }, NOW)
    const [ru] = await getRssFeedForApps(db, [730])
    const [en] = await getRssFeedForApps(db, [730], 30, undefined, undefined, 'en')
    expect(ru?.blocks).toEqual([])
    expect(en?.blocks).toHaveLength(1)
  })

  test('русский пост без английского пересказа уходит в ридер /en без тела', async () => {
    // Договор п. 7: русского тела на /en нет — ридер даст ссылку на оригинал.
    // Раньше 'untold-en' отдавал тело любому посту без tldr_en, считая
    // оригинал английским, и русский абзац уезжал описанием записи
    const db = await freshDb()
    const ruBody = [{ kind: 'p' as const, runs: [{ text: 'Исправили вылет при загрузке и добавили новый режим.' }] }]
    await upsertNewsItems(db, [patch(730, '1', { blocks: ruBody })], NOW)
    await setNewsDigest(db, 730, '1', { tldr: 'Починили вылет.', scale: 'major' }, NOW)
    const [en] = await getRssFeedForApps(db, [730], 30, undefined, undefined, 'en')
    expect(en).toMatchObject({ title: 'Обновление 1.2', blocks: [] })
    expect(en).not.toHaveProperty('tldrEn')
    // пересказ без английского — русской ленте тело не нужно, как и раньше
    expect((await getRssFeedForApps(db, [730]))[0]?.blocks).toEqual([])
    // а без пересказа вовсе русская лента получает своё русское тело
    const db2 = await freshDb()
    await upsertNewsItems(db2, [patch(730, '1', { blocks: ruBody })], NOW)
    expect((await getRssFeedForApps(db2, [730]))[0]?.blocks).toEqual(ruBody)
    expect((await getRssFeedForApps(db2, [730], 30, undefined, undefined, 'en'))[0]?.blocks).toEqual([])
  })
})

describe('доска пати: язык подписи', () => {
  test('сигнатура с языком не меняет русского ответа', async () => {
    const db = await freshDb()
    expect(await listPublicRooms(db, NOW, 'en')).toEqual(await listPublicRooms(db, NOW))
  })

  /*
   * Подписи участников строит memberLabel (lib/room) — та же, что у ростера
   * самой комнаты: без ника — запасное имя с хешем, у демо-личности — её
   * подпись на языке доски, ник живого человека — как записан.
   */
  test('подписи участников на /en — английские, русская доска — прежняя', async () => {
    const db = await freshDb()
    await createRoom(db, { id: 'PUBEN1', steamid: '76561198000000001' }, NOW)
    await joinRoom(db, 'PUBEN1', '76561198000000001', undefined, NOW)
    await joinRoom(db, 'PUBEN1', '00076561198000002', 'Демо-игрок', NOW + 1)
    await joinRoom(db, 'PUBEN1', '76561198000000003', 'Anya', NOW + 2)
    await setRoomPublic(db, 'PUBEN1', true)

    const [ru] = await listPublicRooms(db, NOW + 10)
    const [en] = await listPublicRooms(db, NOW + 10, 'en')
    expect(ru.memberNames[0]).toMatch(/^Игрок [0-9a-z]{1,4}$/)
    expect(ru.memberNames.slice(1)).toEqual(['Демо-игрок', 'Anya'])
    // тот же хеш — один и тот же человек, просто подписан на языке доски
    expect(en.memberNames).toEqual([`Player ${ru.memberNames[0].slice('Игрок '.length)}`, 'Demo player', 'Anya'])
    expect(en.memberNames.join(' ')).not.toMatch(/[А-Яа-яЁё]/)
  })
})

describe('схема v10 на живой базе v9', () => {
  test('новые колонки доезжают ALTER-ом, старые строки читаются как были', async () => {
    const db = await freshDb()
    await upsertNewsItems(db, [patch(730, '1')], NOW)
    await setNewsDigest(db, 730, '1', { tldr: 'Починили вылет.', scale: 'major' }, NOW)
    await createSharedPick(
      db,
      { id: 'abcdefghjkmn', createdBy: 'a', appid: 620, source: 'owned', kind: 'play', reason: 'Потому что' },
      NOW,
    )
    await db.executeMultiple(`
      DROP INDEX idx_news_en_digest;
      DROP INDEX idx_news_en_major;
      ALTER TABLE news_items DROP COLUMN tldr_en;
      ALTER TABLE news_items DROP COLUMN tldr_en_at;
      ALTER TABLE news_items DROP COLUMN tldr_en_tries;
      ALTER TABLE news_items DROP COLUMN title_en;
      ALTER TABLE news_items DROP COLUMN blocks_en_json;
      ALTER TABLE games DROP COLUMN short_description_en;
      ALTER TABLE shared_picks DROP COLUMN lang;
      UPDATE catalog_meta SET value = '9' WHERE key = 'schema_v';`)
    await migrateDb(db)

    expect((await getGameNews(db, 730))[0]).toMatchObject({ tldr: 'Починили вылет.' })
    expect((await getSharedPick(db, 'abcdefghjkmn', 0))?.lang).toBe('ru')
    expect((await getUnsummarizedEn(db)).map((n) => n.gid)).toEqual(['1'])
  })
})
