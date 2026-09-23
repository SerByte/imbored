import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Db } from '@/lib/db'
import { freshDb, post, signIn } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * /api/recommend — отказы до подбора, настоящим роутом.
 *
 * Каждый код здесь — отдельный экран на /play (FAIL в app/play/page.tsx, сторож
 * lib/failscreens.test.ts), и советы у них разные. Сторож проверяет, что у
 * кода есть разбор на странице; этот тест — что роут отвечает тем кодом,
 * который страница ждёт. До модели ни один из этих запросов не доходит.
 */

const STEAMID = '76561197960287930'
const MOOD = { time: 'short', vibe: 'chill', social: 'solo' }

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

describe('/api/recommend', () => {
  test('без сессии — 401 nosession: /play уводит на вход, а не показывает экран', async () => {
    const res = await POST(post('/api/recommend', { mood: MOOD }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'nosession' })
  })

  test('непонятное настроение — 400 badmood', async () => {
    await signIn(db, STEAMID)
    for (const body of [{}, { mood: 'весёлое' }, { mood: { ...MOOD, vibe: 'rage' } }, 'не json']) {
      const res = await POST(post('/api/recommend', body))
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.json()).toEqual({ error: 'badmood' })
    }
  })

  test('сессия есть, снимка библиотеки нет — 409 nolibrary, а не пустая выдача', async () => {
    await signIn(db, STEAMID)
    const res = await POST(post('/api/recommend', { mood: MOOD }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'nolibrary' })
  })
})
