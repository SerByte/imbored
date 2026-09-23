import { beforeEach, describe, expect, test, vi } from 'vitest'
import { hashString } from '@/lib/daily'
import { createRoom, joinRoom, roomMembers, setRoomMatched, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, params, post, signInAs, signOut } from '@/lib/testing/route'
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
