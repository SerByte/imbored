import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getRoom, roomMembers, type Db } from '@/lib/db'
import { freshDb, post, signInAs } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Комната создаётся от имени профиля: хост управляет ею и виден на доске под
 * своим ником. По вставленной ссылке на чужой профиль — нельзя.
 */

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

describe('/api/room/create', () => {
  test('без сессии — 401 nosession', async () => {
    const res = await POST(post('/api/room/create'))
    expect(res.status).toBe(401)
  })

  test('сессия по ссылке — 403 needsteam, и комнаты нет', async () => {
    await signInAs(db, 'claimed')
    const res = await POST(post('/api/room/create'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'needsteam' })
    const rows = await db.execute('SELECT COUNT(*) AS n FROM rooms')
    expect(Number(rows.rows[0]?.n)).toBe(0)
  })

  test('вход через Steam и демо создают комнату и сразу в ней сидят', async () => {
    for (const kind of ['openid', 'demo'] as const) {
      const steamid = await signInAs(db, kind)
      const res = await POST(post('/api/room/create'))
      expect(res.status, kind).toBe(200)
      const { roomId } = (await res.json()) as { roomId: string }
      expect((await getRoom(db, roomId))?.createdBy, kind).toBe(steamid)
      expect((await roomMembers(db, roomId)).map((m) => m.steamid), kind).toEqual([steamid])
    }
  })
})
