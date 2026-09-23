import { beforeEach, describe, expect, test, vi } from 'vitest'
import { listBanned, logFeedback, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, post, signInAs } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Снятие бана — единственный роут, который удаляет пользовательские строки.
 * По вставленной ссылке на чужой профиль это было бы «вернуть человеку всё,
 * что он выгнал», поэтому права те же, что у записи фидбека.
 */

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

async function ban(steamid: string) {
  await logFeedback(db, { steamid, appid: 620, action: 'banned' }, nowSec())
}

describe('/api/unban', () => {
  test('без сессии — 401 nosession', async () => {
    const res = await POST(post('/api/unban', { appid: 620 }))
    expect(res.status).toBe(401)
  })

  test('сессия по ссылке — 403 needsteam, бан остаётся на месте', async () => {
    const steamid = await signInAs(db, 'claimed')
    await ban(steamid)
    const res = await POST(post('/api/unban', { appid: 620 }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'needsteam' })
    expect(await listBanned(db, steamid)).toHaveLength(1)
  })

  test('вход через Steam и демо бан снимают', async () => {
    for (const kind of ['openid', 'demo'] as const) {
      const steamid = await signInAs(db, kind)
      await ban(steamid)
      const res = await POST(post('/api/unban', { appid: 620 }))
      expect(res.status, kind).toBe(200)
      expect(await listBanned(db, steamid), kind).toEqual([])
    }
  })
})
