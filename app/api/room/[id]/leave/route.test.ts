import { beforeEach, describe, expect, test, vi } from 'vitest'
import { castRoomVote, createRoom, getRoom, joinRoom, roomMembers, type Db } from '@/lib/db'
import { memberKey } from '@/lib/roomkey'
import { nowSec, sessionSecret } from '@/lib/server'
import { freshDb, params, post, signIn, signOut } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Выход из пати и рука хоста.
 *
 * Себя убрать может кто угодно, чужого — только хост, и чужого называют
 * ключом из ростера, а не steamid. После ухода матч пересчитывается сразу:
 * иначе оставшиеся, всё отсвайпавшие, ждали бы голоса, которого не будет.
 */

const ROOM = 'ABC234'
const HOST = '76561190000000001'
const DIMA = '76561190000000002'
const SASHA = '76561190000000003'

let db: Db

beforeEach(async () => {
  db = await freshDb()
  const now = nowSec()
  await createRoom(db, { id: ROOM, steamid: HOST }, now)
  for (const s of [HOST, DIMA, SASHA]) await joinRoom(db, ROOM, s, undefined, now)
})

const leave = (body: unknown = {}) => POST(post(`/api/room/${ROOM}/leave`, body), params({ id: ROOM }))
const ids = async () => (await roomMembers(db, ROOM)).map((m) => m.steamid)

describe('/api/room/[id]/leave', () => {
  test('без сессии — 401', async () => {
    signOut()
    expect((await leave()).status).toBe(401)
  })

  test('участник уходит сам', async () => {
    await signIn(db, DIMA)
    const res = await leave()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ removed: true, left: 2 })
    expect(await ids()).not.toContain(DIMA)
  })

  test('чужого убирает только хост, и только по ключу из ростера', async () => {
    await signIn(db, DIMA)
    const sashaKey = memberKey(sessionSecret(), ROOM, SASHA)
    expect((await leave({ memberId: sashaKey })).status).toBe(403)
    expect(await ids()).toContain(SASHA)

    await signIn(db, HOST)
    expect((await leave({ memberId: SASHA })).status).toBe(200) // steamid вместо ключа — не найден
    expect(await ids()).toContain(SASHA)
    const res = await leave({ memberId: sashaKey })
    expect(await res.json()).toMatchObject({ removed: true })
    expect(await ids()).not.toContain(SASHA)
  })

  test('уход последнего несогласного сводит матч сразу', async () => {
    const now = nowSec()
    await castRoomVote(db, ROOM, HOST, 620, 1, now)
    await castRoomVote(db, ROOM, DIMA, 620, 1, now)
    await signIn(db, SASHA)
    const res = await leave()
    expect(await res.json()).toMatchObject({ removed: true, matched: 620 })
    expect((await getRoom(db, ROOM))?.status).toBe('matched')
  })

  test('тело null не роняет роут', async () => {
    await signIn(db, DIMA)
    const res = await POST(post(`/api/room/${ROOM}/leave`, null), params({ id: ROOM }))
    expect(res.status).toBe(200)
  })
})
