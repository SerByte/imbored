import { beforeEach, describe, expect, test, vi } from 'vitest'
import { castRoomVote, createRoom, issueRoomDeck, joinRoom, roomVotes, type Db } from '@/lib/db'
import type { NearMiss } from '@/lib/roomlikes'
import { nowSec } from '@/lib/server'
import { freshDb, params, post, signInAs } from '@/lib/testing/route'
import { POST as vote } from '../vote/route'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * «Вы почти совпали» — только тому, кто дошёл до конца колоды.
 *
 * Блок группирует карты по раскладу «кто за, кого ждём», и свой голос
 * смотрящего этот расклад двигает. Пока голос можно было отдать за любую
 * карту, а потом переголосовать, «нет на карту — перечитать /likes —
 * сравнить счёт игр» за двадцать кругов называло, кто именно за какую игру,
 * — незнакомцу с доски «Пати» в том числе. Теперь блок приходит, когда свои
 * голоса уже отданы все, а отданный голос не меняется (castDeckVote).
 */

const ROOM = 'ABC234'
const DIMA = '76561197960287998'
const SASHA = '76561197960287997'
const PETYA = '76561197960287996'

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

/**
 * Четверо, колода [570, 620, 730]. Дима и Саша за 570, Петя по ней ещё не
 * голосовал — это и есть почти-совпадение.
 */
async function party(): Promise<string> {
  const now = nowSec()
  await createRoom(db, { id: ROOM, steamid: DIMA }, now)
  await issueRoomDeck(db, ROOM, [570, 620, 730])
  const me = await signInAs(db, 'openid')
  for (const s of [DIMA, SASHA, PETYA, me]) await joinRoom(db, ROOM, s, undefined, now)
  for (const s of [DIMA, SASHA]) await castRoomVote(db, ROOM, s, 570, 1, now)
  return me
}

const swipe = (appid: number, yes: boolean) =>
  vote(post(`/api/room/${ROOM}/vote`, { appid, vote: yes }), params({ id: ROOM }))

const near = async () =>
  ((await (await GET(new Request(`http://localhost/api/room/${ROOM}/likes`), params({ id: ROOM }))).json()) as {
    near: NearMiss[]
  }).near

describe('/api/room/[id]/likes: почти-совпадения', () => {
  test('пока свои карты не отсвайпаны — блока нет, хотя расклад есть', async () => {
    await party()
    await swipe(620, false)
    await swipe(730, false)
    expect(await near()).toEqual([])
  })

  test('колода пройдена — блок приходит', async () => {
    await party()
    for (const appid of [570, 620, 730]) await swipe(appid, appid === 570)
    expect(await near()).toMatchObject([{ forNames: [expect.any(String), expect.any(String), expect.any(String)], games: 1 }])
  })

  test('переголосовать после блока нельзя: голос отдан, расклад не двигается', async () => {
    const me = await party()
    for (const appid of [570, 620, 730]) await swipe(appid, appid === 570)
    const before = await near()

    // «Нет» на ту же карту — ответ прежний, чтобы повтор после обрыва сети
    // оставался безобидным, но записан первый голос
    expect((await swipe(570, false)).status).toBe(200)
    expect((await roomVotes(db, ROOM)).find((v) => v.steamid === me && v.appid === 570)?.vote).toBe(1)
    expect(await near()).toEqual(before)
  })
})
