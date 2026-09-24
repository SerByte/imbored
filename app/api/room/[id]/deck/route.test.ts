import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createRoom,
  joinRoom,
  logFeedback,
  roomVotes,
  saveLibrarySnapshot,
  upsertGameMeta,
  type Db,
} from '@/lib/db'
import { rotationSlot } from '@/lib/pool'
import { nowSec } from '@/lib/server'
import { freshDb, params, post, signInAs } from '@/lib/testing/route'
import type { GameMeta, LibraryGame, Mood } from '@/lib/types'
import { POST as vote } from '../vote/route'
import { GET as deck } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

// Цены карточек роут освежает походом в Steam — в тесте сети нет и не нужно
vi.mock('@/lib/deals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/deals')>()),
  refreshDealsWithin: async () => 0,
}))

// С какой ротацией и какими банами роут просил пул. Сам пул настоящий —
// только подслушан
const poolAsks = vi.hoisted(() => [] as Array<number | undefined>)
const poolBans = vi.hoisted(() => [] as Array<number[] | undefined>)
vi.mock('@/lib/pool', async (importOriginal) => {
  const pool = await importOriginal<typeof import('@/lib/pool')>()
  return {
    ...pool,
    fetchDiscoveryPool: (...args: Parameters<typeof pool.fetchDiscoveryPool>) => {
      poolAsks.push(args[1].rotation)
      poolBans.push(args[1].bannedAppids)
      return pool.fetchDiscoveryPool(...args)
    },
  }
})

/**
 * Колода и голос — один контракт: голос принимается только за карту, которую
 * комнате раздали. Проверяется настоящими роутами: /deck пишет розданное в
 * room_deck, /vote читает оттуда.
 */

const ROOM = 'ABC234'
const FRIEND = '76561197960287999'

function meta(appid: number, name: string): GameMeta {
  return { appid, name, tags: { Multiplayer: 100, 'Co-op': 80 }, genres: [], categories: [1, 9] }
}

function owned(...games: GameMeta[]): LibraryGame[] {
  return games.map((g) => ({ appid: g.appid, name: g.name, playtimeForever: 600, playtime2Weeks: 0 }))
}

const DOTA = meta(570, 'Dota 2')
const PORTAL = meta(620, 'Portal 2')

let db: Db

beforeEach(async () => {
  db = await freshDb()
  poolAsks.length = 0
  poolBans.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

/** Комната на двоих с общими сетевыми играми; вошедший — участник */
async function party(createdAt = nowSec()): Promise<string> {
  const now = createdAt
  const me = await signInAs(db, 'openid')
  for (const g of [DOTA, PORTAL]) await upsertGameMeta(db, g, now)
  await createRoom(db, { id: ROOM, steamid: me }, now)
  for (const steamid of [me, FRIEND]) {
    await joinRoom(db, ROOM, steamid, undefined, now)
    await saveLibrarySnapshot(db, steamid, owned(DOTA, PORTAL), now)
  }
  return me
}

const get = () => deck(new Request(`http://localhost/api/room/${ROOM}/deck`), params({ id: ROOM }))
const swipe = (appid: number) =>
  vote(post(`/api/room/${ROOM}/vote`, { appid, vote: true }), params({ id: ROOM }))

describe('/api/room/[id]/deck → /vote', () => {
  test('розданная карта голосуется, нерозданная — 409 notindeck и ни строки', async () => {
    const me = await party()
    const res = await get()
    expect(res.status).toBe(200)
    const { cards } = (await res.json()) as { cards: Array<{ appid: number }> }
    expect(cards.map((c) => c.appid).sort()).toEqual([570, 620])

    expect((await swipe(570)).status).toBe(200)

    const stray = await swipe(730)
    expect(stray.status).toBe(409)
    expect(await stray.json()).toEqual({ error: 'notindeck' })
    expect((await roomVotes(db, ROOM)).map((v) => [v.steamid, v.appid])).toEqual([[me, 570]])
  })
})

/**
 * Пул колоды крутится по rotationSlot, а тот меняет слот раз в неделю —
 * в четверг в 00:00 UTC. Слот считался от «сейчас», и пати, начатая в среду
 * в 23:40 по UTC (02:40 по Москве), после полуночи получала другой пул:
 * ещё не проголосовавшие видели другие карты, часть уже показанных не могла
 * дать единогласия, а знаменатель «12 из 20» прыгал.
 */
describe('/api/room/[id]/deck: ротация', () => {
  /** Граница недели: четверг, 24 сентября 2026, 00:00 UTC */
  const THURSDAY = 1_790_208_000

  test('пул не меняется, когда комната переживает границу недели', async () => {
    // Иначе проверка ниже прошла бы и со старым кодом — по совпадению слотов
    expect(rotationSlot(ROOM, THURSDAY - 600)).not.toBe(rotationSlot(ROOM, THURSDAY + 600))

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime((THURSDAY - 1200) * 1000)
    await party(THURSDAY - 1200)

    vi.setSystemTime((THURSDAY - 600) * 1000)
    const before = (await (await get()).json()) as { cards: Array<{ appid: number }> }
    vi.setSystemTime((THURSDAY + 600) * 1000)
    const after = (await (await get()).json()) as { cards: Array<{ appid: number }> }

    expect(poolAsks).toHaveLength(2)
    expect(poolAsks[1]).toBe(poolAsks[0])
    // слот комнаты — от её рождения, а не от часов
    expect(poolAsks[0]).toBe(rotationSlot(ROOM, THURSDAY - 1200))
    expect(after.cards.map((c) => c.appid)).toEqual(before.cards.map((c) => c.appid))
  })
})

/**
 * «Больше не показывать» работало на /play и в «Игре дня», а колода пати его
 * не знала: скрытая игра приезжала в свайп. Колода одна на комнату, поэтому
 * баны всех участников объединяются — своя колода у каждого развалила бы
 * счёт «12 из 20» у соседей.
 */
describe('/api/room/[id]/deck: «Больше не показывать»', () => {
  test('игру, скрытую кем-то из участников, не раздают никому, и голос за неё не принимается', async () => {
    await party()
    await logFeedback(db, { steamid: FRIEND, appid: 620, action: 'banned' }, nowSec())

    const body = (await (await get()).json()) as { cards: Array<{ appid: number }>; total: number }
    expect(body.cards.map((c) => c.appid)).toEqual([570])
    expect(body.total).toBe(1)
    // Пул тоже не тратит места под скрытое
    expect(poolBans[0]).toEqual([620])

    expect((await swipe(620)).status).toBe(409)
  })

  test('свой бан смотрящего работает так же', async () => {
    const me = await party()
    await logFeedback(db, { steamid: me, appid: 570, action: 'banned' }, nowSec())
    const body = (await (await get()).json()) as { cards: Array<{ appid: number }> }
    expect(body.cards.map((c) => c.appid)).toEqual([620])
  })

  test('бан человека не из комнаты колоду не трогает', async () => {
    await party()
    await logFeedback(db, { steamid: '76561197960280000', appid: 620, action: 'banned' }, nowSec())
    const body = (await (await get()).json()) as { cards: Array<{ appid: number }> }
    expect(body.cards.map((c) => c.appid).sort()).toEqual([570, 620])
  })
})

/**
 * Настроение, которое хост выбрал при создании. Лежало в rooms.mood_json с
 * первого дня, а колода его не читала: «пара быстрых каток» и «весь вечер»
 * раздавали одно и то же.
 */
describe('/api/room/[id]/deck: настроение комнаты', () => {
  // Зеркальные общие игры: вкус пати их не различает, различает настроение
  const COZY: GameMeta = {
    ...meta(30, 'Cozy Farm'),
    tags: { 'Co-op': 100, Relaxing: 90, 'Farming Sim': 80 },
  }
  const FRANTIC: GameMeta = {
    ...meta(31, 'Frantic Arena'),
    tags: { 'Co-op': 100, Competitive: 90, 'Fast-Paced': 80 },
  }

  async function roomWith(mood?: Mood) {
    const now = nowSec()
    const me = await signInAs(db, 'openid')
    for (const g of [COZY, FRANTIC]) await upsertGameMeta(db, g, now)
    await createRoom(db, { id: ROOM, steamid: me, ...(mood ? { mood } : {}) }, now)
    for (const steamid of [me, FRIEND]) {
      await joinRoom(db, ROOM, steamid, undefined, now)
      await saveLibrarySnapshot(db, steamid, owned(COZY, FRANTIC), now)
    }
  }

  const order = async () =>
    ((await (await get()).json()) as { cards: Array<{ appid: number }> }).cards.map((c) => c.appid)

  test('уютный вечер — уютное первым', async () => {
    await roomWith({ time: 'long', vibe: 'chill', social: 'friends' })
    expect(await order()).toEqual([30, 31])
  })

  test('пара быстрых каток — быстрое первым', async () => {
    await roomWith({ time: 'short', vibe: 'engaged', social: 'friends' })
    expect(await order()).toEqual([31, 30])
  })

  test('битая строка настроения в базе колоду не роняет', async () => {
    await roomWith()
    await db.execute({
      sql: 'UPDATE rooms SET mood_json = ? WHERE id = ?',
      args: ['{"time":"forever"}', ROOM],
    })
    const res = await get()
    expect(res.status).toBe(200)
    expect((await order()).sort()).toEqual([30, 31])
  })
})
