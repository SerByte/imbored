import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { InStatement } from '@libsql/client'
import { hashString } from '@/lib/daily'
import {
  createRoom,
  joinRoom,
  roomMembers,
  saveLibrarySnapshot,
  setRoomMatched,
  updateGamePrices,
  upsertGameMeta,
  type Db,
} from '@/lib/db'
import { resetSwallowed } from '@/lib/errlog'
import { nowSec } from '@/lib/server'
import { breakDbOn, freshDb, params, post, signIn, signInAs, signOut, STEAMID_OF } from '@/lib/testing/route'
import { POST as join } from './join/route'
import { POST as leave } from './leave/route'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Что комната отдаёт наружу. В открытую комнату с доски «Пати» подсаживаются
 * незнакомые, а код приватной — всего шесть знаков, и опрос комнаты отвечал
 * ростером любому, кто его угадает.
 */

const ROOM = 'ABC234'
const FRIEND = '76561197960287999'

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

type View = { members: Array<{ id: string; name: string; me: boolean }> }

const peek = (room = ROOM, ip = '203.0.113.7') =>
  GET(
    new Request(`http://localhost/api/room/${room}`, { headers: { 'x-forwarded-for': ip } }),
    params({ id: room }),
  )

/** Тот же опрос с английской страницы — язык в адресе, как ставит withLang */
const peekEn = (room = ROOM, ip = '203.0.113.7') =>
  GET(
    new Request(`http://localhost/api/room/${room}?lang=en`, { headers: { 'x-forwarded-for': ip } }),
    params({ id: room }),
  )

const CYRILLIC = /[А-Яа-яЁё]/

/** Комната хоста-через-Steam, в которой сидит ещё и друг */
async function hosted(): Promise<string> {
  const host = await signInAs(db, 'openid')
  await createRoom(db, { id: ROOM, steamid: host }, nowSec())
  await joinRoom(db, ROOM, host, undefined, nowSec())
  await joinRoom(db, ROOM, FRIEND, undefined, nowSec())
  return host
}

describe('/api/room/[id]: ключи участников', () => {
  test('ни steamid, ни хеш, который его выдаёт перебором', async () => {
    const host = await hosted()
    const res = await peek()
    expect(res.status).toBe(200)
    const json = JSON.stringify(await res.json())
    expect(json).not.toMatch(/\d{17}/)
    for (const sid of [host, FRIEND]) {
      // Прежний ключ считался без секрета — hashString(код + steamid) — и
      // любой пересчитывал его для каждого кандидата в SteamID64
      expect(json).not.toContain(`"${hashString(ROOM + sid).toString(36)}"`)
    }
  })

  test('хост убирает участника по ключу из ростера', async () => {
    await hosted()
    const { members } = (await (await peek()).json()) as View
    const friend = members.find((m) => !m.me)!
    const res = await leave(post(`/api/room/${ROOM}/leave`, { memberId: friend.id }), params({ id: ROOM }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ removed: true, left: 1 })
    expect((await roomMembers(db, ROOM)).map((m) => m.steamid)).not.toContain(FRIEND)
  })
})

describe('/api/room/[id]: потолок на взгляд снаружи', () => {
  test('гость без сессии упирается в 429, и промахи считаются вместе с попаданиями', async () => {
    await hosted()
    signOut()
    let last = 200
    for (let i = 0; i < 300; i++) {
      // Половина — перебор несуществующих кодов: 404 тоже тратит потолок
      last = (await peek(i % 2 ? ROOM : 'ZZZ999')).status
      expect([200, 404], String(i)).toContain(last)
    }
    expect((await peek()).status).toBe(429)
    expect((await peek('ZZZ999')).status).toBe(429)
    // другой адрес — свой потолок
    expect((await peek(ROOM, '198.51.100.1')).status).toBe(200)
  })

  test('участника потолок не трогает: его опрос и есть горячий путь', async () => {
    await hosted()
    for (let i = 0; i < 320; i++) expect((await peek()).status, String(i)).toBe(200)
  })
})

describe('/api/room/[id]/join', () => {
  test('в сматченную комнату новому — 409 matched, своему — 200', async () => {
    const host = await hosted()
    await setRoomMatched(db, ROOM, 570)

    await signInAs(db, 'demo')
    const res = await join(post(`/api/room/${ROOM}/join`), params({ id: ROOM }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'matched' })

    await signInAs(db, 'openid')
    expect((await join(post(`/api/room/${ROOM}/join`), params({ id: ROOM }))).status).toBe(200)
    expect((await roomMembers(db, ROOM)).map((m) => m.steamid).sort()).toEqual([FRIEND, host].sort())
  })
})

/**
 * Матч бывает на игре, которой у кого-то нет: колода сознательно берёт и
 * «не у всех». Церемония всем показывала «Запустить», и steam://run у
 * не-владельца открывал окно покупки без цены. Теперь комната говорит
 * каждому своё — владеет ли он игрой и сколько она стоит.
 */
describe('/api/room/[id]: сматченная игра и владение', () => {
  type Matched = {
    matchedGame: {
      ownedByMe: boolean | null
      isFree: boolean
      priceFinal: number | null
      unsold: boolean
    } | null
  }
  const matched = async () => ((await (await peek()).json()) as Matched).matchedGame

  async function matchedOn(appid: number, meta: { isFree?: boolean; priceFinal?: number } = {}) {
    const host = await hosted()
    const now = nowSec()
    await upsertGameMeta(
      db,
      { appid, name: `Игра ${appid}`, tags: { 'Co-op': 100 }, genres: [], categories: [1], ...meta },
      now,
    )
    const game = { appid, name: `Игра ${appid}`, playtimeForever: 60, playtime2Weeks: 0 }
    await saveLibrarySnapshot(db, host, [game], now)
    await saveLibrarySnapshot(db, FRIEND, [{ ...game, appid: 570 }], now)
    await setRoomMatched(db, ROOM, appid)
    return host
  }

  test('владельцу — ownedByMe: true', async () => {
    await matchedOn(1091500, { priceFinal: 5999 })
    expect(await matched()).toMatchObject({ ownedByMe: true })
  })

  test('тому, у кого игры нет, — ownedByMe: false и цена', async () => {
    await matchedOn(1091500, { priceFinal: 5999 })
    await signIn(db, FRIEND)
    expect(await matched()).toMatchObject({ ownedByMe: false, isFree: false, priceFinal: 5999 })
  })

  test('у бесплатной игры цены нет, даже если она лежит в каталоге', async () => {
    // CS2: is_free = 1 и price_final = 1499 — это Prime, а не игра
    await matchedOn(730, { isFree: true, priceFinal: 1499 })
    await signIn(db, FRIEND)
    expect(await matched()).toMatchObject({ ownedByMe: false, isFree: true, priceFinal: null })
  })

  test('бесплатная, которую магазин региона не показывает, — и isFree, и unsold', async () => {
    // Warzone бесплатна в US, в российском Steam visible:false. Взять её там
    // нельзя, и церемония (PriceTag) должна сказать «не продаётся», а не
    // «бесплатно»: признак не гасится бесплатностью, выбирает ценник
    await matchedOn(1962663, { isFree: true })
    // регион по умолчанию: и замер, и чтение — в одном
    await updateGamePrices(db, [{ appid: 1962663, hidden: true }], nowSec())
    await signIn(db, FRIEND)
    expect(await matched()).toMatchObject({ ownedByMe: false, isFree: true, priceFinal: null, unsold: true })
  })

  test('не участнику — «не знаем», а не чужое «есть»', async () => {
    await matchedOn(1091500)
    signOut()
    expect(await matched()).toMatchObject({ ownedByMe: null })
  })

  // Игра другого магазина (пул OTHER_STORE_GAMES) доходит до колоды, а в базе
  // у неё русская страница: «Open in Epic Games» на /en вёл на /ru/ Epic
  test('игра другого магазина — страница на языке смотрящего', async () => {
    const ruUrl = 'https://store.epicgames.com/ru/p/fortnite'
    await hosted()
    await upsertGameMeta(
      db,
      { appid: -101, name: 'Fortnite', tags: { 'Battle Royale': 100 }, genres: [], categories: [1], store: 'epic', storeUrl: ruUrl, isFree: true },
      nowSec(),
    )
    await setRoomMatched(db, ROOM, -101)
    const on = async (res: Response) =>
      ((await res.json()) as { matchedGame: { store: string | null; storeUrl: string | null } }).matchedGame
    expect(await on(await peek())).toMatchObject({ store: 'epic', storeUrl: ruUrl })
    expect(await on(await peekEn())).toMatchObject({
      store: 'epic',
      storeUrl: 'https://store.epicgames.com/en-US/p/fortnite',
    })
  })
})

/**
 * «Нет у: Дима, Саша» — всей комнате, а не только тому, у кого нет.
 *
 * Церемония знала владение одного смотрящего, и о том, что у Димы игры нет,
 * знал только Дима: остальные звали в войс и ждали. Колода уже показывает
 * каждому «Нет у: имя» на каждой карте — экран матча называет тех же людей
 * теми же метками, и больше ничего.
 */
describe('/api/room/[id]: кому не хватает сошедшейся игры', () => {
  const GAME = 1091500
  // steamid больше, чем у друга: вошли одной секундой, и ростер добивает порядок по нему
  const SASHA = '76561197960288001'
  type Missing = { matchedGame: { ownedByMe: boolean | null; missingFor?: string[] | null } | null }
  const matched = async () => ((await (await peek()).json()) as Missing).matchedGame
  // Метка участника без ника — memberLabel: четыре знака хеша, не steamid
  const SASHA_LABEL = `Игрок ${hashString(ROOM + SASHA).toString(36).slice(0, 4)}`

  /**
   * Хост с игрой, друг без неё (ник «Дима»), Саша без ника и без игры. Каждый
   * вошёл со своим снапшотом — кроме тех, кого тест оставит без него.
   */
  async function party(opts: { sashaSnapshot?: boolean } = {}): Promise<string> {
    const now = nowSec()
    const host = await signInAs(db, 'openid')
    await createRoom(db, { id: ROOM, steamid: host }, now)
    await joinRoom(db, ROOM, host, 'Хост', now)
    await joinRoom(db, ROOM, FRIEND, 'Дима', now)
    await joinRoom(db, ROOM, SASHA, undefined, now)
    await upsertGameMeta(
      db,
      { appid: GAME, name: 'Игра', tags: { 'Co-op': 100 }, genres: [], categories: [1], priceFinal: 5999 },
      now,
    )
    const own = (appid: number) => [{ appid, name: `Игра ${appid}`, playtimeForever: 60, playtime2Weeks: 0 }]
    await saveLibrarySnapshot(db, host, own(GAME), now)
    await saveLibrarySnapshot(db, FRIEND, own(570), now)
    if (opts.sashaSnapshot !== false) await saveLibrarySnapshot(db, SASHA, own(570), now)
    await setRoomMatched(db, ROOM, GAME)
    return host
  }

  test('владельцу — те, у кого нет, теми же метками, что в ростере и колоде', async () => {
    await party()
    expect(await matched()).toMatchObject({ ownedByMe: true, missingFor: ['Дима', SASHA_LABEL] })
  })

  test('тому, у кого нет, — свои «нет» отдельно, в списке только остальные', async () => {
    await party()
    await signIn(db, FRIEND)
    expect(await matched()).toMatchObject({ ownedByMe: false, missingFor: [SASHA_LABEL] })
  })

  test('без снапшота библиотеки — «не знаем», а не «нет»: в список не попадает', async () => {
    await party({ sashaSnapshot: false })
    expect(await matched()).toMatchObject({ missingFor: ['Дима'] })
  })

  test('ни steamid, ни их хвостов — только метки', async () => {
    await party()
    const json = JSON.stringify(await matched())
    expect(json).not.toMatch(/\d{17}/)
    for (const sid of [FRIEND, SASHA]) expect(json).not.toContain(sid.slice(-4))
  })

  test('не участнику — ничего: состав чужой пати по ссылке не раздаётся', async () => {
    await party()
    signOut()
    expect((await matched())?.missingFor ?? null).toBeNull()
    await signInAs(db, 'demo')
    expect((await matched())?.missingFor ?? null).toBeNull()
  })
})

/**
 * Экран приглашения говорит то же, что карточка в чате: кто зовёт, во что и
 * кто уже внутри (inviteDoor в lib/roominvite). Только тому, кто ещё не
 * вошёл, и только пока комната открыта: участнику это шапка и ростер, а
 * после матча не-участнику показывают другое — на чём сошлись.
 */
describe('/api/room/[id]: экран приглашения', () => {
  const VALHEIM = 892970
  type Door = {
    invite?: {
      title: string
      here: string | null
      seed: { appid: number; name: string; line: string } | null
    } | null
  }
  const door = async () => ((await (await peek()).json()) as Door).invite ?? null

  // console.warn и execute подменяют тесты на обрыв и на порядок чтений
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Хост «Серёга» позвал в Valheim, «Аня» уже внутри */
  async function seeded(): Promise<string> {
    const now = nowSec()
    const host = await signInAs(db, 'openid')
    await upsertGameMeta(
      db,
      { appid: VALHEIM, name: 'Valheim', tags: { 'Co-op': 100 }, genres: [], categories: [1, 9] },
      now,
    )
    await createRoom(db, { id: ROOM, steamid: host, seedAppid: VALHEIM }, now)
    await joinRoom(db, ROOM, host, 'Серёга', now)
    await joinRoom(db, ROOM, FRIEND, 'Аня', now)
    return host
  }

  test('гостю — кто зовёт, кто здесь и игра, в которую звали', async () => {
    await seeded()
    signOut()
    expect(await door()).toMatchObject({
      title: 'Серёга зовёт выбрать игру на вечер',
      here: 'Уже здесь: Серёга и Аня',
      seed: {
        appid: VALHEIM,
        name: 'Valheim',
        line: 'Первой картой — «Valheim»; не зайдёт — дальше колода из ваших библиотек.',
      },
    })
  })

  test('чужой сессии — то же самое, и ни steamid, ни их хвостов', async () => {
    await seeded()
    await signInAs(db, 'demo')
    const got = await door()
    expect(got?.title).toBe('Серёга зовёт выбрать игру на вечер')
    const json = JSON.stringify(got)
    expect(json).not.toMatch(/\d{17}/)
    expect(json).not.toContain(FRIEND.slice(-4))
  })

  test('без игры — без картинки, остальное на месте', async () => {
    await hosted()
    signOut()
    const got = await door()
    expect(got?.seed).toBeNull()
    // хост без ника — безлично, а в «Уже здесь» оба — метками ростера
    expect(got?.title).toBe('Тебя зовут выбрать игру на вечер')
    expect(got?.here).toMatch(/^Уже здесь: Игрок \w{1,4} и Игрок \w{1,4}$/)
  })

  test('участнику — ничего: у него шапка комнаты и ростер, а опрос прежний до байта', async () => {
    await seeded()
    expect('invite' in ((await (await peek()).json()) as object)).toBe(false)
  })

  /*
   * Сессия по ссылке на профиль, который сидит здесь со входом через Steam
   * (needSteam, lib/roomseat): ей не приглашение, а «войди через Steam и
   * здесь» — и «Серёга зовёт» вышло бы самому Серёге.
   */
  test('свой профиль по ссылке — не приглашение', async () => {
    const now = nowSec()
    await createRoom(db, { id: ROOM, steamid: FRIEND }, now)
    await joinRoom(db, ROOM, FRIEND, 'Серёга', now, { writer: true })
    await signIn(db, FRIEND)
    const json = (await (await peek()).json()) as Door & { needSteam: boolean }
    expect(json.needSteam).toBe(true)
    expect(json.invite ?? null).toBeNull()
  })

  test('после матча — ничего: не-участнику там говорят, на чём сошлись', async () => {
    await seeded()
    await setRoomMatched(db, ROOM, VALHEIM)
    signOut()
    expect(await door()).toBeNull()
  })
  /*
   * Картинка игры на экране — украшение. Упало её чтение — экран без неё,
   * а не 500 на весь опрос: гость видел бы «Связь потеряна» вместо «Серёга
   * зовёт».
   */
  test('обрыв базы на мете игры — экран без картинки, а не 500', async () => {
    await seeded()
    signOut()
    // logSwallowed глушит повтор того же where на минуту: без сброса строка
    // зависела бы от того, не залогировал ли её раньше другой тест файла
    resetSwallowed()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    breakDbOn(db, 'FROM games g')
    const res = await peek()
    expect(res.status).toBe(200)
    expect(((await res.json()) as Door).invite).toMatchObject({
      title: 'Серёга зовёт выбрать игру на вечер',
      here: 'Уже здесь: Серёга и Аня',
      seed: null,
    })
    expect(warn.mock.calls.map((c) => String(c[0])).join(' ')).toContain('room:door-seed')
  })

  /*
   * Опрос не-участника — раз в 2,5 секунды, и каждый последовательный поход
   * в Turso стоит ему десятки-сотни миллисекунд. Мета игры уходит в базу
   * вместе с потолком room-peek: пока потолок не ответил, она уже в пути.
   */
  test('мета игры читается вместе с потолком, а не после него', async () => {
    await seeded()
    signOut()
    const execute = db.execute.bind(db)
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    const issued: string[] = []
    vi.spyOn(db, 'execute').mockImplementation((async (stmt: InStatement) => {
      const sql = typeof stmt === 'string' ? stmt : stmt.sql
      issued.push(sql)
      if (sql.includes('rate_limits')) await held
      return execute(stmt)
    }) as typeof execute)

    const res = peek()
    // потолок держим: мета обязана уйти в базу, не дожидаясь его ответа
    await vi.waitFor(() => expect(issued.some((s) => s.includes('rate_limits'))).toBe(true))
    await vi.waitFor(() => expect(issued.some((s) => s.includes('FROM games g'))).toBe(true))
    release()
    expect(((await (await res).json()) as Door).invite?.seed?.name).toBe('Valheim')
  })

  /*
   * Английская страница опрашивает с ?lang=en: экран приглашения — теми же
   * фразами, что английское превью (inviteDoor), а ник живого человека —
   * как записан, его не переводят.
   */
  test('по-английски — те же факты английскими фразами, ник как есть', async () => {
    await seeded()
    signOut()
    const got = ((await (await peekEn()).json()) as Door).invite
    expect(got).toMatchObject({
      title: "Серёга wants to pick tonight's game",
      here: 'Already here: Серёга and Аня',
      seed: {
        name: 'Valheim',
        line: 'First card: “Valheim”. Not into it? Next up is a deck from your libraries.',
      },
    })
  })

  test('по-английски хост без ника — безлично, а ростер — «Player …»', async () => {
    await hosted()
    signOut()
    const res = (await (await peekEn()).json()) as Door & View
    expect(res.invite?.title).toBe("You're invited to pick tonight's game")
    expect(res.invite?.here).toMatch(/^Already here: Player \w{1,4} and Player \w{1,4}$/)
    expect(res.members.map((m) => m.name).join(' ')).not.toMatch(CYRILLIC)
  })

  /*
   * Демо-хост записан русской подписью («Демо-игрок»), и без признака
   * hostDemo английский экран назвал бы его по-русски — посреди английской
   * фразы. Признак ставит роут по steamid; наружу steamid не уходит.
   */
  test('демо-хост на английском экране — «Demo player», тем же словом, что в «Already here»', async () => {
    const now = nowSec()
    const demo = STEAMID_OF.demo
    await createRoom(db, { id: ROOM, steamid: demo }, now)
    await joinRoom(db, ROOM, demo, 'Демо-игрок', now)
    await joinRoom(db, ROOM, FRIEND, 'Аня', now)
    signOut()
    const en = ((await (await peekEn()).json()) as Door).invite
    expect(en?.title).toBe("Demo player wants to pick tonight's game")
    expect(en?.here).toBe('Already here: Demo player and Аня')
    // русский экран — прежний до байта: ник как записан
    const ru = ((await (await peek(ROOM, '203.0.113.8')).json()) as Door).invite
    expect(ru?.title).toBe('Демо-игрок зовёт выбрать игру на вечер')
    expect(ru?.here).toBe('Уже здесь: Демо-игрок и Аня')
  })
})
