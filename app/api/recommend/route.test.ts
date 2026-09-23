import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveLibrarySnapshot, upsertGamesMeta, upsertSemantics, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { HERO_SLIDES } from '@/lib/shots'
import type { GameSemantics } from '@/lib/types'
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

/**
 * Длина захода и настроение словами едут в карточку из семантики — той же
 * строкой, что на карточке игры, и только из уверенной: по одним тегам
 * карточка про сессию молчит.
 */
describe('/api/recommend: семантика в карточке', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  const semantics = (minutes: number, confidence: number): GameSemantics => ({
    v: 1,
    axes: { challenge: 20, complexity: 40, pace: 40 },
    session: { bucket: minutes <= 25 ? 'short' : 'medium', minutes, canStopAnytime: false },
    timeToFun: { bucket: null, hours: null },
    confidence,
    n: 40,
    basis: confidence > 0.4 ? 'tags+reviews' : 'tags',
  })

  test('уверенная семантика — «Сессия ~20 мин» и слова настроения; по тегам — ничего', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await signIn(db, STEAMID, { verified: true })
    const now = nowSec()
    const ids = [620, 413150, 105600]
    await saveLibrarySnapshot(
      db,
      STEAMID,
      ids.map((appid) => ({ appid, name: `Игра ${appid}`, playtimeForever: 0, playtime2Weeks: 0 })),
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
        ...(appid === 620 ? { reviewsTotal: 48_213, reviewsPercent: 92 } : {}),
      })),
      now,
    )
    await upsertSemantics(db, [
      { appid: 620, semantics: semantics(20, 0.8), computedAt: now },
      { appid: 413150, semantics: semantics(20, 0.3), computedAt: now },
    ])

    const res = await POST(post('/api/recommend', { mood: MOOD }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      picks: Array<{
        appid: number
        session: { label: string; value: string } | null
        signals: { moodWords: string[] } | null
        entry: { level: string; basis: string } | null
        reviewsPercent: number | null
        reviewsTotal: number | null
      }>
    }
    const byId = new Map(body.picks.map((p) => [p.appid, p]))
    expect(byId.get(620)?.session).toEqual({ label: 'Сессия', value: '~20 мин' })
    expect(byId.get(620)?.signals?.moodWords).toEqual(['спокойная', 'короткие сессии'])
    expect(byId.get(413150)?.session).toBeNull()
    expect(byId.get(413150)?.signals?.moodWords).toEqual([])
    expect(byId.get(105600)?.session).toBeNull()
    // Цена входа: уверенная семантика старта не видит — строки нет, хотя
    // Casual по тегам сказал бы «низкий»; без неё говорит жанр
    expect(byId.get(620)?.entry).toBeNull()
    expect(byId.get(413150)?.entry).toEqual({ level: 'low', hours: null, basis: 'tags' })
    // Отзывы — для «92% из 48 тыс.» на плитке полки
    expect(byId.get(620)).toMatchObject({ reviewsPercent: 92, reviewsTotal: 48_213 })
    expect(byId.get(413150)).toMatchObject({ reviewsPercent: null, reviewsTotal: null })
  })
})
