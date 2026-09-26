import { beforeEach, describe, expect, test, vi } from 'vitest'
import { listLiked, logFeedback, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, post, signInAs } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Снятие «зашло» удаляет строки фидбека, поэтому права — те же, что у записи:
 * по вставленной ссылке на чужой профиль вкус не переписывается.
 */

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

async function like(steamid: string) {
  await logFeedback(db, { steamid, appid: 620, action: 'liked' }, nowSec())
}

describe('/api/unlike', () => {
  test('без сессии — 401 nosession', async () => {
    const res = await POST(post('/api/unlike', { appid: 620 }))
    expect(res.status).toBe(401)
  })

  test('сессия по ссылке — 403 needsteam, оценка остаётся на месте', async () => {
    const steamid = await signInAs(db, 'claimed')
    await like(steamid)
    const res = await POST(post('/api/unlike', { appid: 620 }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'needsteam' })
    expect(await listLiked(db, steamid)).toHaveLength(1)
  })

  test('вход через Steam и демо оценку снимают', async () => {
    for (const kind of ['openid', 'demo'] as const) {
      const steamid = await signInAs(db, kind)
      await like(steamid)
      const res = await POST(post('/api/unlike', { appid: 620 }))
      expect(res.status, kind).toBe(200)
      expect(await listLiked(db, steamid), kind).toEqual([])
    }
  })

  test('мусор вместо appid — 400, ничего не удалено', async () => {
    const steamid = await signInAs(db, 'openid')
    await like(steamid)
    for (const body of [{}, { appid: 0 }, { appid: 1.5 }, { appid: 'x' }, null]) {
      const res = await POST(post('/api/unlike', body))
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(await listLiked(db, steamid)).toHaveLength(1)
  })
})
