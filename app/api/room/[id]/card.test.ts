import { beforeEach, describe, expect, test, vi } from 'vitest'
import { castRoomVote, createRoom, issueRoomDeck, joinRoom, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, params, post, signIn, signInAs } from '@/lib/testing/route'
import { POST as take } from './leader/route'
import { POST as leave } from './leave/route'
import { POST as vote } from './vote/route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

// Настоящий revalidatePath вне сервера Next бросает — копим адреса
const revalidated: string[] = []
vi.mock('next/cache', () => ({
  revalidatePath: (p: string) => {
    revalidated.push(p)
  },
  revalidateTag: () => {},
}))

/**
 * Карточка комнаты в мессенджере после матча.
 *
 * Картинка /room/<код>/opengraph-image живёт в кэше пять минут (revalidate =
 * 300), и билет «зовёт выбрать игру» успевает лечь туда ещё в лобби — ссылку
 * на комнату кидают в чат первым делом. Пати, сошедшаяся за эти минуты и
 * нажавшая «Поделиться» на экране матча, разворачивала бы приглашение
 * свайпать в комнату, где выбирать уже нечего. Поэтому каждый путь, которым
 * комната сходится, — голос, «Берём», уход несогласного — сбрасывает карточку.
 */

const ROOM = 'ABC234'
const DIMA = '76561197960287998'
const CARD = `/room/${ROOM}/opengraph-image`

let db: Db

beforeEach(async () => {
  db = await freshDb()
  revalidated.length = 0
})

/** Комната на двоих (смотрящий и Дима) с колодой [570, 620] */
async function pair(): Promise<string> {
  const now = nowSec()
  await createRoom(db, { id: ROOM, steamid: DIMA }, now)
  await issueRoomDeck(db, ROOM, [570, 620])
  const me = await signInAs(db, 'openid')
  for (const s of [DIMA, me]) await joinRoom(db, ROOM, s, undefined, now)
  return me
}

const swipe = (appid: number, yes: boolean) =>
  vote(post(`/api/room/${ROOM}/vote`, { appid, vote: yes }), params({ id: ROOM }))

describe('матч сбрасывает карточку комнаты', () => {
  test('последний голос, давший матч', async () => {
    await pair()
    await castRoomVote(db, ROOM, DIMA, 570, 1, nowSec())
    const res = await swipe(570, true)
    expect(await res.json()).toEqual({ matched: 570 })
    expect(revalidated).toEqual([CARD])
  })

  test('голос без матча карточку не трогает', async () => {
    await pair()
    expect(await (await swipe(570, true)).json()).toEqual({ matched: null })
    expect(revalidated).toEqual([])
  })

  test('«Берём» лидера голосов', async () => {
    const me = await pair()
    const now = nowSec()
    // трое: за 570 смотрящий и Дима, третий против всего — лидер 2 из 3
    const third = '76561197960287997'
    await joinRoom(db, ROOM, third, undefined, now)
    for (const [s, yes] of [
      [me, [570]],
      [DIMA, [570]],
      [third, []],
    ] as const) {
      for (const appid of [570, 620]) {
        await castRoomVote(db, ROOM, s, appid, (yes as readonly number[]).includes(appid) ? 1 : 0, now)
      }
    }
    const res = await take(post(`/api/room/${ROOM}/leader`, { appid: 570 }), params({ id: ROOM }))
    expect(await res.json()).toEqual({ matched: 570 })
    expect(revalidated).toEqual([CARD])
  })

  test('уход последнего несогласного', async () => {
    const me = await pair()
    const third = '76561197960287997'
    const now = nowSec()
    await joinRoom(db, ROOM, third, undefined, now)
    await castRoomVote(db, ROOM, me, 620, 1, now)
    await castRoomVote(db, ROOM, DIMA, 620, 1, now)
    await signIn(db, third)
    const res = await leave(post(`/api/room/${ROOM}/leave`, {}), params({ id: ROOM }))
    expect(await res.json()).toMatchObject({ removed: true, matched: 620 })
    expect(revalidated).toEqual([CARD])
  })

  test('уход из уже сошедшейся комнаты — не новый матч, сбрасывать нечего', async () => {
    await pair()
    await castRoomVote(db, ROOM, DIMA, 570, 1, nowSec())
    await swipe(570, true)
    revalidated.length = 0
    await signIn(db, DIMA)
    const res = await leave(post(`/api/room/${ROOM}/leave`, {}), params({ id: ROOM }))
    expect(await res.json()).toMatchObject({ matched: 570 })
    expect(revalidated).toEqual([])
  })
})
