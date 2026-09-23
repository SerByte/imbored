import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createRoom,
  issueRoomDeck,
  joinRoom,
  roomVotes,
  setRoomDeckSize,
  setRoomMatched,
  type Db,
} from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, params, post, signInAs } from '@/lib/testing/route'
import { POST as join } from '../join/route'
import { POST as vote } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

const ROOM = 'ABC234'
const HOST = '76561197960287999'

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

const swipe = (body: unknown) => vote(post(`/api/room/${ROOM}/vote`, body), params({ id: ROOM }))

/** Комната, где вошедший — участник, а колода [570, 620] уже роздана */
async function seated(): Promise<string> {
  await createRoom(db, { id: ROOM, steamid: HOST }, nowSec())
  await issueRoomDeck(db, ROOM, [570, 620])
  const me = await signInAs(db, 'openid')
  await joinRoom(db, ROOM, me, undefined, nowSec())
  return me
}

/**
 * Обратная сторона requireWriter: вход в комнату и голос ОСТАЮТСЯ открыты
 * сессии по ссылке. Голос живёт внутри комнаты и профиль не трогает, а друг,
 * которого позвали в пати, чаще всего подключается именно ссылкой — закрыть
 * ему свайп значило бы сломать пати целиком.
 */
describe('комната для сессии по ссылке', () => {
  test('входит и голосует', async () => {
    await createRoom(db, { id: ROOM, steamid: HOST }, nowSec())
    await issueRoomDeck(db, ROOM, [620])
    await signInAs(db, 'claimed')

    const joined = await join(post(`/api/room/${ROOM}/join`), params({ id: ROOM }))
    expect(joined.status).toBe(200)

    const voted = await swipe({ appid: 620, vote: true })
    expect(voted.status).toBe(200)
  })
})

/**
 * Границы голоса. Лимит частоты держит скорость, но не объём: без этих
 * проверок участник публичной комнаты (вход бесплатный, через демо) писал
 * голоса за любые appid и после матча, без края, а каждый опрос каждого
 * участника перечитывал их все.
 */
describe('/api/room/[id]/vote: что принимается', () => {
  test('сматченная комната — 409 matched с записанной игрой, голос не пишется', async () => {
    await seated()
    await setRoomMatched(db, ROOM, 570)
    const res = await swipe({ appid: 620, vote: true })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'matched', matched: 570 })
    expect(await roomVotes(db, ROOM)).toEqual([])
  })

  test('игра не из колоды — 409 notindeck, голос не пишется', async () => {
    await seated()
    const res = await swipe({ appid: 730, vote: true })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'notindeck' })
    expect(await roomVotes(db, ROOM)).toEqual([])
  })

  test('колоды не раздавали вовсе — голосовать не за что', async () => {
    await createRoom(db, { id: ROOM, steamid: HOST }, nowSec())
    const me = await signInAs(db, 'openid')
    await joinRoom(db, ROOM, me, undefined, nowSec())
    expect((await swipe({ appid: 570, vote: true })).status).toBe(409)
  })

  test('комната с колодой от прежнего кода голосует по-старому', async () => {
    // Колоду выдали до room_deck: размер записан, строк нет. Её участники
    // держат в руках карты, которых в room_deck не будет никогда
    await createRoom(db, { id: ROOM, steamid: HOST }, nowSec())
    await setRoomDeckSize(db, ROOM, 20)
    const me = await signInAs(db, 'openid')
    await joinRoom(db, ROOM, me, undefined, nowSec())
    expect((await swipe({ appid: 730, vote: false })).status).toBe(200)
    expect((await roomVotes(db, ROOM)).map((v) => v.appid)).toEqual([730])
  })

  test('appid вне 32 бит, дробный или не число — 400 badinput', async () => {
    await seated()
    for (const appid of [2 ** 31, -(2 ** 31), 2 ** 53, 570.5, 'x']) {
      const res = await swipe({ appid, vote: true })
      expect(res.status, String(appid)).toBe(400)
    }
    expect(await roomVotes(db, ROOM)).toEqual([])
  })

  test('карта из колоды — 200, голос записан, матча у одного нет', async () => {
    const me = await seated()
    const res = await swipe({ appid: 570, vote: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ matched: null })
    expect((await roomVotes(db, ROOM)).map((v) => [v.steamid, v.appid])).toEqual([[me, 570]])
  })
})
