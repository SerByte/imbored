import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as dbModule from '@/lib/db'
import { createRoom, joinRoom, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, params, signInAs } from '@/lib/testing/route'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/*
 * Чтение снапшотов под шпионом: это и есть цена захода — библиотека КАЖДОГО
 * участника целиком, — и проверяется, когда роут её платит.
 */
vi.mock('@/lib/db', async (orig) => {
  const real = await orig<typeof import('@/lib/db')>()
  return { ...real, getLatestSnapshot: vi.fn(real.getLatestSnapshot) }
})

const ROOM = 'ABC234'
const HOST = '76561197960287999'

let db: Db

beforeEach(async () => {
  db = await freshDb()
  vi.mocked(dbModule.getLatestSnapshot).mockClear()
})

async function seated(): Promise<void> {
  await createRoom(db, { id: ROOM, steamid: HOST }, nowSec())
  const me = await signInAs(db, 'openid')
  await joinRoom(db, ROOM, me, undefined, nowSec())
}

const ask = (round: number) =>
  GET(new Request(`http://localhost/api/room/${ROOM}/trivia?round=${round}`), params({ id: ROOM }))

/**
 * Раунды викторины конечны.
 *
 * Номер зажимался в MAX_ROUND, и с десятого раунда seed был один и тот же:
 * каждое «Ещё раунд» давало те же вопросы с теми же ответами и заново
 * поднимало библиотеки всех участников.
 */
describe('/api/room/[id]/trivia: раунды кончаются', () => {
  test('последний раунд собирается как обычно', async () => {
    await seated()
    const res = await ask(9)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { round: number }).round).toBe(9)
    expect(dbModule.getLatestSnapshot).toHaveBeenCalled()
  })

  test('за последним — пустой список, а не тот же раунд по кругу', async () => {
    await seated()
    const res = await ask(10)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { round: number; questions: unknown[] }
    expect(body.questions).toEqual([])
    expect(body.round, 'номер зажат — значит, это снова девятый раунд').toBe(10)
    expect(
      dbModule.getLatestSnapshot,
      'пустой ответ не стоит библиотек всех участников',
    ).not.toHaveBeenCalled()
  })
})
