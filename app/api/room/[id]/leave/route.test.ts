import { beforeEach, describe, expect, test, vi } from 'vitest'
import { castRoomVote, createRoom, getRoom, joinRoom, roomMembers, type Db } from '@/lib/db'
import { ROOM_KICK_SEC } from '@/lib/room'
import { memberKey } from '@/lib/roomkey'
import { nowSec, sessionSecret } from '@/lib/server'
import { freshDb, params, post, signIn, signOut } from '@/lib/testing/route'
import { POST as join } from '../join/route'
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

    // Хост — через Steam: убрать чужого — управление комнатой, как и доска
    // (см. тест ниже про хоста по ссылке). Раньше здесь стояла сессия по
    // ссылке, и тест держал ровно ту дыру, которую закрывает следующий.
    await signIn(db, HOST, { verified: true })
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

  test('хост по ссылке чужого не убирает — 403 needsteam, Саша на месте', async () => {
    // Сессию на профиль хоста выдаёт /api/connect любому, кто знает его
    // ссылку. Без доказательства владения это не хост, а тот, кто вставил
    // ссылку, — и убирать людей из чужой пати ему нельзя
    await signIn(db, HOST)
    const res = await leave({ memberId: memberKey(sessionSecret(), ROOM, SASHA) })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'needsteam' })
    expect(await ids()).toContain(SASHA)
  })

  test('тело null не роняет роут', async () => {
    await signIn(db, DIMA)
    const res = await POST(post(`/api/room/${ROOM}/leave`, null), params({ id: ROOM }))
    expect(res.status).toBe(200)
  })
})

/**
 * Убранный хостом не возвращается сразу (ROOM_KICK_SEC в lib/room).
 *
 * Без этого «убрать» действовало только на ушедшего в AFK: тролль с доски
 * нажимал «Войти» и снова сидел в знаменателе единогласия с нулём голосов.
 * Навсегда запирать нельзя — кнопка придумана для друга, закрывшего вкладку,
 * и он вправе вернуться, — поэтому на время.
 */
describe('/api/room/[id]/leave: убранный не возвращается сразу', () => {
  const rejoin = () => join(post(`/api/room/${ROOM}/join`), params({ id: ROOM }))

  test('убранный хостом — 409 kicked, пока не выйдет срок', async () => {
    await signIn(db, HOST, { verified: true })
    expect((await leave({ memberId: memberKey(sessionSecret(), ROOM, SASHA) })).status).toBe(200)

    await signIn(db, SASHA)
    const res = await rejoin()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'kicked' })
    expect(await ids()).not.toContain(SASHA)

    // Срок вышел — друг, вернувшийся к компьютеру, снова в пати
    await db.execute({ sql: 'UPDATE room_kicks SET kicked_at = kicked_at - ?', args: [ROOM_KICK_SEC + 1] })
    expect((await rejoin()).status).toBe(200)
    expect(await ids()).toContain(SASHA)
  })

  test('ушедший сам возвращается сразу: уход — не изгнание', async () => {
    await signIn(db, DIMA)
    expect((await leave()).status).toBe(200)
    expect((await rejoin()).status).toBe(200)
    expect(await ids()).toContain(DIMA)
  })
})

/**
 * Хост ушёл — рука хоста переходит к тому, кто вошёл раньше всех.
 *
 * Иначе комната оставалась без единственного способа убрать застрявшего:
 * created_by указывал на ушедшего, ✕ в ростере не рисовался никому, и один
 * закрывший вкладку запирал и матч, и «Берём» навсегда.
 */
describe('/api/room/[id]/leave: хост уходит', () => {
  test('хостом становится первый в ростере — и может убрать застрявшего', async () => {
    await signIn(db, HOST, { verified: true })
    expect((await leave()).status).toBe(200)
    // Вошли в одну секунду — порядок ростера решает steamid (roomMembers)
    expect((await getRoom(db, ROOM))?.createdBy).toBe(DIMA)

    await signIn(db, DIMA, { verified: true })
    const res = await leave({ memberId: memberKey(sessionSecret(), ROOM, SASHA) })
    expect(await res.json()).toMatchObject({ removed: true })
    expect(await ids()).toEqual([DIMA])
  })

  test('хост убирает другого — хозяин комнаты прежний', async () => {
    await signIn(db, HOST, { verified: true })
    await leave({ memberId: memberKey(sessionSecret(), ROOM, DIMA) })
    expect((await getRoom(db, ROOM))?.createdBy).toBe(HOST)
  })

  test('последний вышел — 200, а не ошибка: передавать хоста некому', async () => {
    for (const s of [DIMA, SASHA]) {
      await signIn(db, s)
      await leave()
    }
    await signIn(db, HOST, { verified: true })
    const res = await leave()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ removed: true, left: 0 })
    expect((await getRoom(db, ROOM))?.createdBy).toBe(HOST)
  })
})
