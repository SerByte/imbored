import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRoom, getRoom, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, params, post, signInAs, type SessionKind } from '@/lib/testing/route'
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
