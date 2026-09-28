import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Db } from '@/lib/db'
import { demoLibrary, demoLibrary2 } from '@/lib/demo'
import { SESSION_COOKIE, sessionSecret } from '@/lib/server'
import { verifySessionV2 } from '@/lib/session'
import { forgetSessionCache } from '@/lib/sessions'
import { setTestCookie } from '@/lib/testing/headers'
import { STEAMID_OF, freshDb, post, signInAs } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Сеть Steam — подменённая: проверяется то, что роут делает с ответами, а не
 * сам Steam. Ввод steamid64 идёт мимо resolveProfile к двум вызовам ниже.
 */
const steam = vi.hoisted(() => ({
  owned: vi.fn(),
  summary: vi.fn(),
}))
vi.mock('@/lib/steam', async (orig) => ({
  ...(await orig<typeof import('@/lib/steam')>()),
  fetchOwnedGames: steam.owned,
  fetchPlayerSummary: steam.summary,
}))

/**
 * /api/connect — единственная ручка, что выдаёт подписанную сессию без
 * доказательства владения: демо и ссылка на профиль. Держит три обещания:
 * потолок по адресу стоит перед всем, демо-личность не путается с чужой, а
 * сессия по ссылке — только для чтения.
 */

const T0 = 1_760_000_000
const OTHER = '76561197960287999'

let db: Db

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0 * 1000)
  db = await freshDb()
  vi.stubEnv('STEAM_API_KEY', 'test-key')
  steam.owned.mockResolvedValue([{ appid: 620, name: 'Portal 2', playtimeForever: 600, playtime2Weeks: 0 }])
  steam.summary.mockResolvedValue({ steamid: OTHER, personaName: 'Гордон', avatarUrl: 'https://x/a.jpg' })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  steam.owned.mockReset()
  steam.summary.mockReset()
})

const connect = (body: unknown, ip = '203.0.113.7') =>
  POST(post('/api/connect', body, { 'x-forwarded-for': ip, 'user-agent': 'Firefox/140' }))

/** steamid из куки сессии, которую поставил ответ; null — куки нет */
function cookieSteamid(res: Response): string | null {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))
  if (!line) return null
  const token = decodeURIComponent(line.slice(SESSION_COOKIE.length + 1).split(';')[0])
  return verifySessionV2(token, sessionSecret())?.steamid ?? null
}

async function count(sql: string, ...args: string[]): Promise<number> {
  return Number((await db.execute({ sql, args })).rows[0]?.n ?? 0)
}

describe('/api/connect: демо', () => {
  test('демо-игрок — сессия, строки и честное число игр', async () => {
    const res = await connect({ demo: true })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { steamid: string; gameCount: number; demo: boolean; writer: boolean }
    expect(body.steamid).toMatch(/^000\d{13}1$/)
    expect(body).toMatchObject({ demo: true, writer: true, personaName: 'Демо-игрок' })
    // число в ответе захардкожено в роуте — держим его равным библиотеке
    expect(body.gameCount).toBe(demoLibrary(T0).length)
    expect(cookieSteamid(res)).toBe(body.steamid)
    expect(await count('SELECT COUNT(*) AS n FROM users WHERE steamid = ?', body.steamid)).toBe(1)
    expect(await count('SELECT COUNT(*) AS n FROM library_snapshots WHERE steamid = ?', body.steamid)).toBe(1)
    expect(await count('SELECT COUNT(*) AS n FROM sessions WHERE steamid = ? AND verified = 0', body.steamid)).toBe(1)
  })

  test('демо-друг встаёт в пару к своему демо-игроку', async () => {
    await signInAs(db, 'demo')
    const res = await connect({ demo: true, variant: 2 })
    const body = (await res.json()) as { steamid: string; personaName: string; gameCount: number }
    expect(body.steamid).toBe(STEAMID_OF.demo.slice(0, 16) + '2')
    expect(body.personaName).toBe('Демо-друг')
    expect(body.gameCount).toBe(demoLibrary2(T0).length)
  })

  test('мусор в variant — обычный демо-игрок', async () => {
    const body = (await (await connect({ demo: true, variant: 'x' })).json()) as { steamid: string }
    expect(body.steamid.endsWith('1')).toBe(true)
  })

  // Фиксация сессии: новая кука на устройстве гасит прежнюю, а не копит их
  test('прежняя сессия этого устройства отзывается', async () => {
    const first = await connect({ demo: true })
    const line = first.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? ''
    setTestCookie(SESSION_COOKIE, decodeURIComponent(line.slice(SESSION_COOKIE.length + 1).split(';')[0]))
    forgetSessionCache()
    await connect({ demo: true })
    expect(await count('SELECT COUNT(*) AS n FROM sessions')).toBe(2)
    expect(await count('SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL')).toBe(1)
  })
})

describe('/api/connect: ссылка на профиль', () => {
  test('успех — сессия только для чтения, профиль и библиотека записаны', async () => {
    const res = await connect({ input: OTHER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({ ok: true, steamid: OTHER, personaName: 'Гордон', gameCount: 1, writer: false })
    expect(body.demo).toBeUndefined()
    expect(cookieSteamid(res)).toBe(OTHER)
    expect(await count('SELECT COUNT(*) AS n FROM sessions WHERE steamid = ? AND verified = 0', OTHER)).toBe(1)
    expect(await count('SELECT COUNT(*) AS n FROM library_snapshots WHERE steamid = ?', OTHER)).toBe(1)
  })

  test('без ключа — 503 nokey и без куки', async () => {
    vi.stubEnv('STEAM_API_KEY', '')
    const res = await connect({ input: OTHER })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'nokey' })
    expect(cookieSteamid(res)).toBeNull()
  })

  test('чужой сайт вместо профиля — 400', async () => {
    const res = await connect({ input: 'https://evil.example/id/x' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'badinput' })
  })

  test('скрытая библиотека — 403 с именем, пустая — 404', async () => {
    steam.owned.mockResolvedValueOnce('private')
    const hidden = await connect({ input: OTHER })
    expect(hidden.status).toBe(403)
    expect(await hidden.json()).toEqual({ error: 'private', personaName: 'Гордон' })

    steam.owned.mockResolvedValueOnce([])
    const empty = await connect({ input: OTHER })
    expect(empty.status).toBe(404)
    expect(await empty.json()).toEqual({ error: 'empty' })
    expect(cookieSteamid(empty)).toBeNull()
  })

  test('Steam упал — 502 и строка в логе, без куки', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    steam.owned.mockRejectedValueOnce(new Error('Steam API /IPlayerService/GetOwnedGames/v1/: HTTP 503'))
    const res = await connect({ input: OTHER })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'steam' })
    expect(cookieSteamid(res)).toBeNull()
    expect(warn.mock.calls.some((c) => String(c[0]).includes('connect:steam'))).toBe(true)
    warn.mockRestore()
  })
})

describe('/api/connect: потолок', () => {
  // Потолок стоит перед всем, включая демо и отказ «нет ключа»: иначе ручка,
  // выдающая сессии без доказательства, была бы бесплатной
  test('тринадцатый запрос с адреса — 429, соседний адрес не задет', async () => {
    vi.stubEnv('STEAM_API_KEY', '')
    for (let i = 0; i < 12; i++) expect((await connect({}, '198.51.100.9')).status).toBe(503)
    const refused = await connect({ demo: true }, '198.51.100.9')
    expect(refused.status).toBe(429)
    expect(refused.headers.get('retry-after')).toBeTruthy()
    expect((await connect({}, '198.51.100.10')).status).toBe(503)
  })
})
