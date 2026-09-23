import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createRoom, roomMembers, setRoomMatched, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb } from '@/lib/testing/route'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/*
 * Steam подменён целиком: ассерт «подтверждён», библиотека и профиль —
 * готовые. Проверяется склейка самого роута, а не разговор со Steam — тот
 * под своими тестами в lib/steam-openid и lib/steam.
 */
const STEAMID = '76561197960287930'

vi.mock('@/lib/steam-openid', async (orig) => ({
  ...(await orig<typeof import('@/lib/steam-openid')>()),
  stateMatches: () => true,
  verifyAssertion: async () => STEAMID,
}))

vi.mock('@/lib/steam', async (orig) => ({
  ...(await orig<typeof import('@/lib/steam')>()),
  fetchOwnedGames: async () => [{ appid: 570, name: 'Dota 2', playtimeForever: 600, playtime2Weeks: 0 }],
  fetchPlayerSummary: async () => ({ steamid: STEAMID, personaName: 'Аня', publicProfile: true }),
}))

const ROOM = 'ABC234'
const HOST = '76561197960287999'

let db: Db

beforeEach(async () => {
  db = await freshDb()
  vi.stubEnv('STEAM_API_KEY', 'test-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const back = (query: string) =>
  GET(new NextRequest(`http://localhost/api/auth/steam/return?state=s&${query}`))

/**
 * Приглашённый попадает в комнату самим входом.
 *
 * Раньше вход только разворачивал на /room/X, и там ждал тот же экран
 * приглашения с третьей кнопкой «Войти в комнату» — под текстом
 * «подключи библиотеку», которая к этому моменту уже подключена.
 */
describe('возврат из Steam с приглашением', () => {
  test('вход по приглашению сразу сажает в комнату', async () => {
    await createRoom(db, { id: ROOM, steamid: HOST }, nowSec())

    const res = await back(`join=${ROOM}`)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(new RegExp(`/room/${ROOM}$`))

    const members = await roomMembers(db, ROOM)
    const me = members.find((m) => m.steamid === STEAMID)
    expect(me, 'вошёл через Steam, а в комнате его нет — нужен ещё один клик').toBeDefined()
    expect(me?.personaName).toBe('Аня')
  })

  test('комнаты нет — вход всё равно состоялся, а комната скажет сама', async () => {
    const res = await back(`join=${ROOM}`)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(new RegExp(`/room/${ROOM}$`))
    expect(res.headers.get('set-cookie'), 'сессия обязана выдаться и без комнаты').toMatch(/=/)
  })

  test('в договорившуюся комнату новый человек не попадает', async () => {
    await createRoom(db, { id: ROOM, steamid: HOST }, nowSec())
    await setRoomMatched(db, ROOM, 570)

    const res = await back(`join=${ROOM}`)
    expect(res.status).toBe(307)
    expect((await roomMembers(db, ROOM)).some((m) => m.steamid === STEAMID)).toBe(false)
  })

  test('без приглашения вход ни в какую комнату не сажает', async () => {
    await createRoom(db, { id: ROOM, steamid: HOST }, nowSec())
    await back('next=/play')
    expect((await roomMembers(db, ROOM)).some((m) => m.steamid === STEAMID)).toBe(false)
  })
})
