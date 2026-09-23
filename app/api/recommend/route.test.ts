import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveLibrarySnapshot, upsertGamesMeta, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { HERO_SLIDES } from '@/lib/shots'
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

/**
 * Метаданные библиотеки читаются узкой выборкой, без скриншотов, — а кадры
 * героям доезжают отдельным запросом по пятёрке (getGameShots). Проверка, что
 * при этой перестановке у героя не пропали кадры.
 */
describe('/api/recommend: кадры героев', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  test('у героя из библиотеки кадры на месте, хотя библиотека читается без блобов', async () => {
    // Без ключа модели — эвристика; Steam за ценами не отвечает
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await signIn(db, STEAMID, { verified: true })
    const now = nowSec()
    const ids = [620, 413150, 105600, 646570, 892970, 1966720]
    await saveLibrarySnapshot(
      db,
      STEAMID,
      ids.map((appid, i) => ({
        appid,
        name: `Игра ${appid}`,
        playtimeForever: i * 30,
        playtime2Weeks: 0,
      })),
      now,
    )
    await upsertGamesMeta(
      db,
      ids.map((appid) => ({
        appid,
        name: `Игра ${appid}`,
        tags: { Puzzle: 100, Casual: 60 },
        genres: [],
        categories: [2],
        art: {},
        screenshots: [1, 2, 3, 4, 5].map((n) => `https://cdn.example/${appid}/${n}.jpg`),
      })),
      now,
    )

    const res = await POST(post('/api/recommend', { mood: MOOD }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { picks: Array<{ appid: number; screenshots: string[] }> }
    expect(body.picks.length).toBeGreaterThan(0)
    for (const p of body.picks) {
      expect(p.screenshots, `кадры ${p.appid}`).toEqual(
        [1, 2, 3, 4, 5].slice(0, HERO_SLIDES).map((n) => `https://cdn.example/${p.appid}/${n}.jpg`),
      )
    }
  })
})
