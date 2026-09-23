import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRoom, joinRoom, roomVotes, saveLibrarySnapshot, upsertGameMeta, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, params, post, signInAs } from '@/lib/testing/route'
import type { GameMeta, LibraryGame } from '@/lib/types'
import { POST as vote } from '../vote/route'
import { GET as deck } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

// Цены карточек роут освежает походом в Steam — в тесте сети нет и не нужно
vi.mock('@/lib/deals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/deals')>()),
  refreshDealsWithin: async () => 0,
}))

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
})

/** Комната на двоих с общими сетевыми играми; вошедший — участник */
async function party(): Promise<string> {
  const now = nowSec()
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
