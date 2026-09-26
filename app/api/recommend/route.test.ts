import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveLibrarySnapshot, upsertGamesMeta, upsertNeighbors, upsertSemantics, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { HERO_SLIDES } from '@/lib/shots'
import { SCORE_FACTORS, type GameSemantics } from '@/lib/types'
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

const trailerOf = (appid: number) => ({
  mp4: `https://video.akamai.steamstatic.com/store_trailers/${appid}/1/h/2/microtrailer.mp4`,
})

/**
 * Метаданные библиотеки читаются узкой выборкой, без скриншотов, — а кадры и
 * трейлер героям доезжают отдельным запросом по пятёрке (getHeroMedia).
 * Проверка, что при этой перестановке у героя не пропали кадры.
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
        // трейлер есть не у всех: у нечётных по позиции его нет вовсе
        ...(ids.indexOf(appid) % 2 === 0 ? { trailer: trailerOf(appid) } : {}),
      })),
      now,
    )

    const res = await POST(post('/api/recommend', { mood: MOOD }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      picks: Array<{ appid: number; screenshots: string[]; trailer: unknown }>
    }
    expect(body.picks.length).toBeGreaterThan(0)
    for (const p of body.picks) {
      expect(p.screenshots, `кадры ${p.appid}`).toEqual(
        [1, 2, 3, 4, 5].slice(0, HERO_SLIDES).map((n) => `https://cdn.example/${p.appid}/${n}.jpg`),
      )
      // Трейлер едет тем же отдельным чтением, что и кадры; нет — явный null
      expect(p.trailer, `трейлер ${p.appid}`).toEqual(
        ids.indexOf(p.appid) % 2 === 0 ? trailerOf(p.appid) : null,
      )
    }
  })
})

/**
 * Место и части скора едут в каждую карточку — для снимка к оценке
 * (lib/feedbackctx): /play возвращает их с «Зашло» и «Не то». Округлённые и
 * только известные множители: изнанка скоринга не должна расползаться шире
 * того, что прочитает отчёт.
 */
describe('/api/recommend: снимок к оценке', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  test('у каждой карточки rank по порядку и части скора из реестра', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await signIn(db, STEAMID, { verified: true })
    const now = nowSec()
    const ids = [620, 413150, 105600, 646570, 892970, 1966720]
    await saveLibrarySnapshot(
      db,
      STEAMID,
      ids.map((appid, i) => ({ appid, name: `Игра ${appid}`, playtimeForever: i * 30, playtime2Weeks: 0 })),
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
      })),
      now,
    )

    const res = await POST(post('/api/recommend', { mood: MOOD }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      picks: Array<{ appid: number; rank: number; parts: Record<string, number> | null }>
    }
    expect(body.picks.length).toBeGreaterThan(0)
    body.picks.forEach((p, i) => {
      expect(p.rank, `место ${p.appid}`).toBe(i)
      expect(p.parts, `части ${p.appid}`).not.toBeNull()
      expect(Object.keys(p.parts!).sort()).toEqual([...SCORE_FACTORS].sort())
      for (const v of Object.values(p.parts!)) {
        // четыре знака после запятой — не больше
        expect(Math.round(v * 10_000) / 10_000).toBe(v)
      }
    })
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

/**
 * «Как «X», но…»: выдача из соседей одной игры. Кандидаты — только соседи
 * (свои и из каталога), модель не зовётся ни при каком ключе, а эхо seed
 * говорит /play, чьи соседи на экране.
 */
describe('/api/recommend: затравка seed', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  /** Своя 10 — затравка; соседи: свои 11, 12 и каталог 20…24; мимо: своя 13 и каталог 25 */
  const NEAR = [11, 12, 20, 21, 22, 23, 24]

  async function setup(): Promise<string[]> {
    // Ключ модели есть: без затравки маршрут пошёл бы в Anthropic
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        calls.push(input instanceof Request ? input.url : String(input))
        return new Response('', { status: 404 })
      }),
    )
    await signIn(db, STEAMID, { verified: true })
    const now = nowSec()
    await saveLibrarySnapshot(
      db,
      STEAMID,
      [10, 11, 12, 13].map((appid) => ({
        appid,
        name: `Игра ${appid}`,
        playtimeForever: appid === 10 ? 3000 : 0,
        playtime2Weeks: 0,
      })),
      now,
    )
    await upsertGamesMeta(
      db,
      [10, 11, 12, 13, 20, 21, 22, 23, 24, 25].map((appid) => ({
        appid,
        name: `Игра ${appid}`,
        tags: { Puzzle: 100, Casual: 60 },
        genres: [],
        categories: [2],
      })),
      now,
    )
    await upsertNeighbors(
      db,
      new Map([[10, NEAR.map((neighbor, i) => ({ neighbor, score: 0.9 - i / 100, shared: ['Puzzle'] }))]]),
    )
    return calls
  }

  test('кандидаты — только соседи затравки, эхо seed, модель не зовётся', async () => {
    const calls = await setup()
    const res = await POST(post('/api/recommend', { mood: MOOD, seed: 10 }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      picks: Array<{ appid: number }>
      discoveries: Array<{ appid: number }>
      engine: string
      seed: unknown
    }
    const shown = [...body.picks, ...body.discoveries].map((p) => p.appid)
    expect(shown.length).toBeGreaterThan(0)
    for (const appid of shown) expect(NEAR, `${appid} не сосед затравки`).toContain(appid)
    expect(body.seed).toEqual({ appid: 10, name: 'Игра 10' })
    expect(body.engine).toBe('heuristic')
    expect(calls.filter((u) => u.includes('anthropic'))).toEqual([])
  })

  test('без затравки тот же запрос идёт к модели — значит, тест выше что-то проверяет', async () => {
    const calls = await setup()
    const res = await POST(post('/api/recommend', { mood: MOOD }))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { seed: unknown }).seed).toBeNull()
    expect(calls.some((u) => u.includes('anthropic'))).toBe(true)
  })

  // Общий суточный бюджет модели (lib/llmcap): выбран — та же выдача
  // эвристикой, без 429 и без похода в Anthropic
  test('суточный бюджет модели выбран — эвристика, модель не зовётся', async () => {
    const calls = await setup()
    vi.stubEnv('LLM_DAILY_CAP', '0')
    const res = await POST(post('/api/recommend', { mood: MOOD }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { picks: unknown[]; engine: string }
    expect(body.picks.length).toBeGreaterThan(0)
    expect(body.engine).toBe('heuristic')
    expect(calls.filter((u) => u.includes('anthropic'))).toEqual([])
  })

  test('незнакомая затравка — 409 nocandidates, мусор в поле — обычная выдача', async () => {
    await setup()
    // здесь модель не проверяем — без ключа обычная выдача не шумит отказами
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const unknown = await POST(post('/api/recommend', { mood: MOOD, seed: 999 }))
    expect(unknown.status).toBe(409)
    expect(await unknown.json()).toEqual({ error: 'nocandidates' })

    for (const seed of ['10', 1.5, 0, null]) {
      const res = await POST(post('/api/recommend', { mood: MOOD, seed }))
      expect(res.status, JSON.stringify(seed)).toBe(200)
      expect(((await res.json()) as { seed: unknown }).seed, JSON.stringify(seed)).toBeNull()
    }
  })
})

/**
 * Подталкивания после выдачи (lib/nudge.ts): модель не зовётся ни при каком
 * ключе, эхо nudge говорит /play, какой чипс нажат, «Что-то другое» не
 * повторяет показанное, «Знакомое» — только своё.
 */
describe('/api/recommend: подталкивания', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  /** Своё 10…15 и каталог 20…25 — с одинаковым вкусом */
  async function setup(): Promise<string[]> {
    // Ключ модели есть: без подталкивания маршрут пошёл бы в Anthropic
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        calls.push(input instanceof Request ? input.url : String(input))
        return new Response('', { status: 404 })
      }),
    )
    await signIn(db, STEAMID, { verified: true })
    const now = nowSec()
    await saveLibrarySnapshot(
      db,
      STEAMID,
      [10, 11, 12, 13, 14, 15].map((appid) => ({
        appid,
        name: `Игра ${appid}`,
        playtimeForever: appid === 10 ? 3000 : 0,
        playtime2Weeks: 0,
      })),
      now,
    )
    await upsertGamesMeta(
      db,
      [10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25].map((appid) => ({
        appid,
        name: `Игра ${appid}`,
        tags: { Puzzle: 100, Casual: 60 },
        genres: [],
        categories: [2],
      })),
      now,
    )
    return calls
  }

  type Body = {
    picks: Array<{ appid: number; source: string }>
    discoveries: Array<{ appid: number }>
    engine: string
    nudge: unknown
    scope: unknown
  }

  test('подталкивание — эвристикой, с эхом, и модель не зовётся', async () => {
    const calls = await setup()
    const res = await POST(post('/api/recommend', { mood: MOOD, nudge: 'story' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Body
    expect(body.nudge).toBe('story')
    expect(body.engine).toBe('heuristic')
    expect(calls.filter((u) => u.includes('anthropic'))).toEqual([])
  })

  test('мусор в поле — обычная выдача: эхо null, и модель снова зовётся', async () => {
    const calls = await setup()
    const res = await POST(post('/api/recommend', { mood: MOOD, nudge: 'faster' }))
    expect(res.status).toBe(200)
    expect(((await res.json()) as Body).nudge).toBeNull()
    expect(calls.some((u) => u.includes('anthropic'))).toBe(true)
  })

  test('«Что-то другое» не повторяет того, что уже на экране', async () => {
    await setup()
    const shown = [11, 12, 20, 21]
    const res = await POST(post('/api/recommend', { mood: MOOD, nudge: 'different', exclude: shown }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Body
    const got = [...body.picks, ...body.discoveries].map((p) => p.appid)
    expect(got.length).toBeGreaterThan(0)
    for (const appid of shown) expect(got, `${appid} уже был на экране`).not.toContain(appid)
  })

  test('exclude без «Что-то другое» ничего не прячет', async () => {
    await setup()
    const ask = async (body: object) => (await (await POST(post('/api/recommend', body))).json()) as Body
    const plain = await ask({ mood: MOOD, nudge: 'story' })
    const withExclude = await ask({ mood: MOOD, nudge: 'story', exclude: plain.picks.map((p) => p.appid) })
    expect(withExclude.picks.map((p) => p.appid)).toEqual(plain.picks.map((p) => p.appid))
  })

  test('«Знакомое» — только своё, и эхо источника это говорит', async () => {
    await setup()
    const res = await POST(post('/api/recommend', { mood: MOOD, nudge: 'familiar', scope: 'all' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Body
    expect(body.scope).toBe('library')
    expect(body.picks.every((p) => p.source !== 'new')).toBe(true)
  })
})
