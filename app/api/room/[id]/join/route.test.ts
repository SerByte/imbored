import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRoom, joinRoom, listPublicRooms, roomMembers, setRoomMatched, setRoomPublic, type Db } from '@/lib/db'
import { ROOM_MAX_MEMBERS } from '@/lib/room'
import { nowSec } from '@/lib/server'
import { freshDb, params, post, signIn, signInAs, signOut } from '@/lib/testing/route'
import { POST } from './route'
import { POST as vote } from '../vote/route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Вход в комнату по коду.
 *
 * Держит три обещания: промах по коду стоит столько же, сколько попадание
 * (общий потолок room-peek по адресу), в сошедшуюся комнату новых не пускают,
 * а в полную — никого, кроме своих.
 */

const ROOM = 'ABC234'
const HOST = '76561190000000001'

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

const join = (id = ROOM, ip = '203.0.113.7') =>
  POST(post(`/api/room/${id}/join`, {}, { 'x-forwarded-for': ip }), params({ id }))

describe('/api/room/[id]/join', () => {
  test('без сессии — 401', async () => {
    signOut()
    await createRoom(db, { id: ROOM, steamid: HOST }, nowSec())
    expect((await join()).status).toBe(401)
  })

  test('нет комнаты — 404, есть — участник записан', async () => {
    const me = await signInAs(db, 'openid')
    expect((await join('ZZZ999')).status).toBe(404)
    await createRoom(db, { id: ROOM, steamid: HOST }, nowSec())
    const res = await join()
    expect(res.status).toBe(200)
    expect((await roomMembers(db, ROOM)).map((m) => m.steamid)).toContain(me)
  })

  test('вход по приглашению считается шагом воронки — один раз на человека', async () => {
    await signInAs(db, 'openid')
    await createRoom(db, { id: ROOM, steamid: HOST }, nowSec())
    expect((await join()).status).toBe(200)
    // повторное «Войти» своего — не новый вход
    expect((await join()).status).toBe(200)
    await vi.waitFor(async () => {
      const res = await db.execute("SELECT key, count FROM telemetry_hourly WHERE kind = 'event'")
      expect(res.rows.map((r) => [r.key, Number(r.count)])).toEqual([['invite_join:room', 1]])
    })
  })

  test('перебор кодов упирается в тот же потолок, что просмотр комнаты', async () => {
    await signInAs(db, 'openid')
    let last = 0
    for (let i = 0; i < 301; i++) last = (await join('ZZZ999', '198.51.100.9')).status
    expect(last).toBe(429)
    // соседний адрес не задет
    expect((await join('ZZZ999', '198.51.100.10')).status).toBe(404)
  })

  test('в сошедшуюся комнату новых не пускают', async () => {
    await signInAs(db, 'openid')
    await createRoom(db, { id: ROOM, steamid: HOST }, nowSec())
    await setRoomMatched(db, ROOM, 620)
    const res = await join()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'matched' })
  })

  test('полная комната — 409 full для нового, свой проходит', async () => {
    const me = await signInAs(db, 'openid')
    await createRoom(db, { id: ROOM, steamid: HOST }, nowSec())
    const crowd = Array.from({ length: ROOM_MAX_MEMBERS }, (_, i) => `765611900000${String(100 + i).padStart(5, '0')}`)
    for (const s of crowd) await joinRoom(db, ROOM, s, undefined, nowSec())
    const res = await join()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'full' })
    expect((await roomMembers(db, ROOM)).map((m) => m.steamid)).not.toContain(me)

    // Тот, кто уже внутри, заходит повторно без отказа
    signOut()
    await signIn(db, crowd[0])
    expect((await join()).status).toBe(200)
  })

  test('одновременные входы не пробивают потолок', async () => {
    await createRoom(db, { id: ROOM, steamid: HOST }, nowSec())
    const seated = Array.from({ length: ROOM_MAX_MEMBERS - 1 }, (_, i) => `765611900000${String(200 + i).padStart(5, '0')}`)
    for (const s of seated) await joinRoom(db, ROOM, s, undefined, nowSec())
    const rush = Array.from({ length: 4 }, (_, i) => `765611900000${String(300 + i).padStart(5, '0')}`)
    const results = await Promise.all(rush.map((s) => joinRoom(db, ROOM, s, undefined, nowSec())))
    expect(results.filter((r) => r === 'joined')).toHaveLength(1)
    expect(await roomMembers(db, ROOM)).toHaveLength(ROOM_MAX_MEMBERS)
  })

  test('полная комната пропадает с доски «Пати»', async () => {
    await createRoom(db, { id: ROOM, steamid: HOST }, nowSec())
    await setRoomPublic(db, ROOM, true)
    await joinRoom(db, ROOM, HOST, undefined, nowSec())
    expect((await listPublicRooms(db, nowSec())).map((r) => r.id)).toContain(ROOM)
    const crowd = Array.from({ length: ROOM_MAX_MEMBERS - 1 }, (_, i) => `765611900000${String(400 + i).padStart(5, '0')}`)
    for (const s of crowd) await joinRoom(db, ROOM, s, undefined, nowSec())
    expect((await listPublicRooms(db, nowSec())).map((r) => r.id)).not.toContain(ROOM)
  })

  test('соседние роуты комнаты — тот же потолок для не-участника', async () => {
    await signInAs(db, 'openid')
    await createRoom(db, { id: ROOM, steamid: HOST }, nowSec())
    const ask = (id: string) =>
      vote(post(`/api/room/${id}/vote`, { appid: 570, vote: true }, { 'x-forwarded-for': '198.51.100.20' }), params({ id }))
    let last = 0
    for (let i = 0; i < 301; i++) last = (await ask(i % 2 ? ROOM : 'ZZZ999')).status
    expect(last).toBe(429)
  })
})
