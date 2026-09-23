import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { listFeedback, type Db } from '@/lib/db'
import { freshDb, post, signIn } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * /api/feedback — настоящим роутом, на базе в памяти.
 *
 * Здесь проверяется то, что из lib/ не видно: порядок отказов и то, что до
 * записи доходит только разобранный запрос.
 */

const STEAMID = '76561197960287930'
/** Середина десятиминутного окна лимита: сто двадцать запросов не перевалят через его край. */
const MID_WINDOW_MS = (Math.floor(1_760_000_000 / 600) * 600 + 300) * 1000

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('/api/feedback', () => {
  test('без сессии — 401 nosession, и в базу ничего', async () => {
    const res = await POST(post('/api/feedback', { appid: 620, action: 'liked' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'nosession' })
    expect(await listFeedback(db, STEAMID)).toEqual([])
  })

  test('мусор вместо запроса — 400 badinput, и в базу ничего', async () => {
    await signIn(db, STEAMID, { verified: true })
    for (const body of [
      'это не json',
      {},
      { appid: 620 },
      { appid: 620, action: 'hacked' },
      { appid: 'шестьсот двадцать', action: 'liked' },
      { appid: 6.5, action: 'liked' },
    ]) {
      const res = await POST(post('/api/feedback', body))
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.json()).toEqual({ error: 'badinput' })
    }
    expect(await listFeedback(db, STEAMID)).toEqual([])
  })

  test('разобранный запрос пишется, мусорные mood и reason отбрасываются молча', async () => {
    await signIn(db, STEAMID, { verified: true })
    const res = await POST(
      post('/api/feedback', { appid: 620, action: 'skipped', reason: 'потому что', mood: 'грустно' }),
    )
    expect(res.status).toBe(200)
    const rows = await listFeedback(db, STEAMID)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ appid: 620, action: 'skipped' })
    expect(rows[0]).not.toHaveProperty('reason')
    expect(rows[0]).not.toHaveProperty('mood')
  })

  test('сто двадцать за окно проходят, сто двадцать первый — 429 с Retry-After', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(MID_WINDOW_MS)
    await signIn(db, STEAMID, { verified: true })

    for (let i = 0; i < 120; i++) {
      const res = await POST(post('/api/feedback', { appid: 1000 + i, action: 'skipped' }))
      expect(res.status, `запрос ${i + 1}`).toBe(200)
    }
    const res = await POST(post('/api/feedback', { appid: 620, action: 'skipped' }))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'ratelimited' })
    expect(Number(res.headers.get('Retry-After'))).toBe(300)
    // Отказ — до записи: в истории ровно пропущенные лимитом сто двадцать
    expect(await listFeedback(db, STEAMID)).toHaveLength(120)
  })
})
