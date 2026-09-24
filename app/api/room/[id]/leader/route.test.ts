import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  castRoomVote,
  createRoom,
  getRoom,
  issueRoomDeck,
  joinRoom,
  setRoomMatched,
  upsertGameMeta,
  type Db,
} from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, params, post, signInAs, type SessionKind } from '@/lib/testing/route'
import { GET as likes } from '../likes/route'
import { GET as peek } from '../route'
import { POST as take } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * «Берём «X»? 3 из 4 за» целиком: /likes предлагает лидера, только когда все
 * отсвайпали, /leader записывает его матчем, опрос комнаты отдаёт церемонии
 * честный счёт. Роуты настоящие, база в памяти.
 */

const ROOM = 'ABC234'
const DIMA = '76561197960287998'
const SASHA = '76561197960287997'

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

/**
 * Комната на троих с колодой [570, 620]. Смотрящий — участник; голоса дальше
 * расставляет каждый тест сам.
 */
async function trio(kind: SessionKind = 'openid'): Promise<string> {
  const now = nowSec()
  await upsertGameMeta(
    db,
    { appid: 570, name: 'Dota 2', tags: { MOBA: 100 }, genres: [], categories: [1] },
    now,
  )
  await createRoom(db, { id: ROOM, steamid: DIMA }, now)
  await issueRoomDeck(db, ROOM, [570, 620])
  const me = await signInAs(db, kind)
  for (const steamid of [DIMA, SASHA, me]) await joinRoom(db, ROOM, steamid, undefined, now)
  return me
}

/** Все дошли до конца: за 570 — смотрящий и Дима, Саша против всего */
async function allSwiped(me: string) {
  const now = nowSec()
  for (const [steamid, yes] of [
    [me, [570]],
    [DIMA, [570]],
    [SASHA, []],
  ] as const) {
    for (const appid of [570, 620]) {
      const vote = (yes as readonly number[]).includes(appid) ? 1 : 0
      await castRoomVote(db, ROOM, steamid, appid, vote, now)
    }
  }
}

const readLikes = async () =>
  (await (
    await likes(new Request(`http://localhost/api/room/${ROOM}/likes`), params({ id: ROOM }))
  ).json()) as { leader: Record<string, unknown> | null }

type RoomView = { matchedGame: { appid: number; forCount: number | null }; members: unknown[] }

const readRoom = async () =>
  (await (
    await peek(new Request(`http://localhost/api/room/${ROOM}`), params({ id: ROOM }))
  ).json()) as RoomView

const press = (appid: unknown) =>
  take(post(`/api/room/${ROOM}/leader`, { appid }), params({ id: ROOM }))

describe('лидер голосов: /likes', () => {
  test('все отсвайпали — лидер с названием и счётом, без единого steamid', async () => {
    const me = await trio()
    await allSwiped(me)
    const { leader } = await readLikes()
    expect(leader).toMatchObject({ appid: 570, name: 'Dota 2', forCount: 2, memberCount: 3 })
    expect(JSON.stringify(leader)).not.toMatch(/\d{17}/)
  })

  test('пока кто-то свайпает — лидера нет', async () => {
    const me = await trio()
    const now = nowSec()
    await castRoomVote(db, ROOM, me, 570, 1, now)
    await castRoomVote(db, ROOM, DIMA, 570, 1, now)
    expect((await readLikes()).leader).toBeNull()
  })
})

describe('лидер голосов: «Берём»', () => {
  test('записывает матч, и церемония получает честный счёт', async () => {
    const me = await trio()
    await allSwiped(me)
    const res = await press(570)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ matched: 570 })
    expect((await getRoom(db, ROOM))?.matchedAppid).toBe(570)

    const view = await readRoom()
    expect(view.matchedGame).toMatchObject({ appid: 570, forCount: 2 })
    expect(view.members).toHaveLength(3)

    // Чужому, зашедшему по ссылке, счёт голосов комнаты не отдаётся
    await signInAs(db, 'demo')
    expect((await readRoom()).matchedGame.forCount).toBeNull()
  })

  test('сессия по ссылке тоже может: это голос внутри комнаты', async () => {
    const me = await trio('claimed')
    await allSwiped(me)
    expect((await press(570)).status).toBe(200)
  })

  test('не лидер или ещё не все отсвайпали — 409 noleader, комната открыта', async () => {
    const me = await trio()
    await allSwiped(me)
    const wrong = await press(620)
    expect(wrong.status).toBe(409)
    expect(await wrong.json()).toEqual({ error: 'noleader' })

    // Кто-то добрал ещё игр: колода выросла, и «все отсвайпали» уже неправда
    await issueRoomDeck(db, ROOM, [570, 620, 730])
    const early = await press(570)
    expect(early.status).toBe(409)
    expect((await getRoom(db, ROOM))?.status).toBe('open')
  })

  test('сматченная комната — 409 matched с записанной игрой', async () => {
    const me = await trio()
    await allSwiped(me)
    await setRoomMatched(db, ROOM, 620)
    const res = await press(570)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'matched', matched: 620 })
  })

  test('чужой — 403, мусор вместо appid — 400', async () => {
    const me = await trio()
    await allSwiped(me)
    expect((await press('570; DROP')).status).toBe(400)
    expect((await press(2 ** 40)).status).toBe(400)

    await db.execute({ sql: 'DELETE FROM room_members WHERE steamid = ?', args: [me] })
    expect((await press(570)).status).toBe(403)
  })
})

describe('церемония единогласного матча', () => {
  test('счёт равен составу — церемония прежняя', async () => {
    const me = await trio()
    const now = nowSec()
    for (const steamid of [me, DIMA, SASHA]) await castRoomVote(db, ROOM, steamid, 570, 1, now)
    await setRoomMatched(db, ROOM, 570)
    expect((await readRoom()).matchedGame.forCount).toBe(3)
  })
})
