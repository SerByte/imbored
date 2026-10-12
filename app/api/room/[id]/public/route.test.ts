import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createRoom, getRoom, upsertUser, type Db } from '@/lib/db'
import { rateUsage } from '@/lib/ratelimit'
import { nowSec } from '@/lib/server'
import { STEAMID_OF, freshDb, params, post, signIn, signInAs, type SessionKind } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Вывесить комнату на доску — показать ник хоста всем на /rooms. Сессия по
 * ссылке на профиль хоста — не хост, а любой, кто знает его ссылку: создать
 * комнату она не может, и переключатель ей закрыт так же. Хостом по ссылке
 * бывает и честный участник — тот, кому рука перешла от ушедшего хоста
 * (removeRoomMember): ему страница скажет «войди через Steam».
 */

const ROOM = 'ABC234'

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

async function hostAs(kind: SessionKind): Promise<string> {
  const steamid = await signInAs(db, kind)
  await createRoom(db, { id: ROOM, steamid }, nowSec())
  return steamid
}

describe('/api/room/[id]/public', () => {
  test('хост по ссылке — 403 needsteam, комната не на доске', async () => {
    await hostAs('claimed')
    const res = await POST(post(`/api/room/${ROOM}/public`, { public: true }), params({ id: ROOM }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'needsteam' })
    expect((await getRoom(db, ROOM))?.isPublic).toBe(false)
  })

  test('хост через Steam и демо-хост вывешивают комнату', async () => {
    for (const kind of ['openid', 'demo'] as const) {
      db = await freshDb()
      await hostAs(kind)
      const res = await POST(post(`/api/room/${ROOM}/public`, { public: true }), params({ id: ROOM }))
      expect(res.status, kind).toBe(200)
      expect((await getRoom(db, ROOM))?.isPublic, kind).toBe(true)
    }
  })
})

/**
 * Потолок переключателя. Каждое нажатие — запись в rooms, а хостом бывает и
 * демо-личность, которую /api/connect выдаёт даром: без края один скрипт
 * крутил бы тумблер своей комнаты, пока Turso не выставит счёт.
 */
describe('/api/room/[id]/public: потолок', () => {
  /** Середина десятиминутного окна: двадцать нажатий не перевалят через его край */
  const MID_WINDOW_MS = (Math.floor(1_760_000_000 / 600) * 600 + 300) * 1000
  const IP = '203.0.113.7'
  const toggle = (room: string, isPublic: boolean, ip = IP) =>
    POST(post(`/api/room/${room}/public`, { public: isPublic }, { 'x-forwarded-for': ip }), params({ id: room }))

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(MID_WINDOW_MS)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('двадцать нажатий за окно проходят, двадцать первое — 429, и до базы оно не доходит', async () => {
    await hostAs('demo')
    for (let i = 0; i < 20; i++) {
      const res = await toggle(ROOM, i % 2 === 0)
      expect(res.status, `нажатие ${i + 1}`).toBe(200)
    }
    // Двадцатое было «снять» — комната не на доске
    expect((await getRoom(db, ROOM))?.isPublic).toBe(false)
    const res = await toggle(ROOM, true)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'ratelimited' })
    expect(Number(res.headers.get('Retry-After'))).toBe(300)
    expect((await getRoom(db, ROOM))?.isPublic).toBe(false)
  })

  /*
   * Личный потолок считается по steamid звонящего, так что хозяйский чужой
   * не потратит, где гейт ни стой. Потратить он мог бы свой личный и —
   * главное — потолок адреса, общий с хостом из той же квартиры.
   */
  test('чужому — 403 nothost, и ни личного потолка, ни потолка адреса он не тратит', async () => {
    await hostAs('openid')
    await signInAs(db, 'demo')
    for (let i = 0; i < 25; i++) expect((await toggle(ROOM, true)).status).toBe(403)
    const span = { limit: 20, windowSec: 600, nowSec: nowSec() }
    expect(await rateUsage(db, { ...span, bucket: 'room-public', id: STEAMID_OF.demo })).toBe(0)
    expect(await rateUsage(db, { ...span, bucket: 'room-public-ip', id: IP, limit: 60 })).toBe(0)
    expect((await getRoom(db, ROOM))?.isPublic).toBe(false)
  })

  /*
   * Личный потолок держит одну личность, а демо-вход чеканит их даром, и у
   * каждой может быть своя комната (/api/room/create). Адрес — ось против
   * скрипта, копящего хостов.
   */
  test('три хоста по двадцать — потолок адреса: четвёртому с него 429, соседний адрес не задет', async () => {
    const hosts = ['00012345678900011', '00012345678900021', '00012345678900031', '00012345678900041']
    const rooms = ['ROOM02', 'ROOM03', 'ROOM04', 'ROOM05']
    for (let h = 0; h < 4; h++) {
      // демо-личность живёт строкой users, как её заводит /api/connect
      await upsertUser(db, { steamid: hosts[h], personaName: 'Демо-игрок' }, nowSec())
      await createRoom(db, { id: rooms[h], steamid: hosts[h] }, nowSec())
    }
    for (let h = 0; h < 3; h++) {
      await signIn(db, hosts[h])
      for (let i = 0; i < 20; i++) {
        expect((await toggle(rooms[h], i % 2 === 0)).status, `${hosts[h]}: нажатие ${i + 1}`).toBe(200)
      }
    }
    await signIn(db, hosts[3])
    expect((await toggle(rooms[3], true)).status).toBe(429)
    expect((await getRoom(db, rooms[3]))?.isPublic).toBe(false)
    expect((await toggle(rooms[3], true, '203.0.113.8')).status).toBe(200)
    expect((await getRoom(db, rooms[3]))?.isPublic).toBe(true)
  })

  test('отказ по личному потолку не тратит потолок адреса', async () => {
    await hostAs('demo')
    for (let i = 0; i < 20; i++) expect((await toggle(ROOM, i % 2 === 0)).status).toBe(200)
    for (let i = 0; i < 5; i++) expect((await toggle(ROOM, true)).status).toBe(429)
    const used = { bucket: 'room-public-ip', id: IP, limit: 60, windowSec: 600, nowSec: nowSec() }
    expect(await rateUsage(db, used)).toBe(20)
  })
})
