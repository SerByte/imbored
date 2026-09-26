import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CRON_JOBS, LLM_DOWN_FRESH_SEC, PAGES_STALE_SEC, SWEEP_KEY } from '@/lib/cron'
import { setCatalogMeta, type Db } from '@/lib/db'
import { takeLlmBudget } from '@/lib/llmcap'
import { STEAM_PROBE_KEY } from '@/lib/steamprobe'
import { freshDb } from '@/lib/testing/route'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * /api/cron/health — единственное, что снаружи видит работу кронов, а не код
 * их первого ответа (202 до after()).
 */

const T0 = 1_760_000_000
const SECRET = 'health-test-secret-0123456789'

let db: Db

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0 * 1000)
  vi.stubEnv('CRON_SECRET', SECRET)
  db = await freshDb()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const ask = (secret = SECRET) =>
  GET(new Request('http://localhost/api/cron/health', { headers: { 'x-cron-secret': secret } }))

/**
 * Все три крона отработали минуту назад и ни на что не жалуются; ключ Steam
 * проверен десять минут назад, уборка прошла вчера
 */
async function allFresh(): Promise<void> {
  for (const job of Object.values(CRON_JOBS)) {
    await setCatalogMeta(db, job.lastKey, JSON.stringify({ at: T0 - 60, chain: 0, hasMore: false }))
  }
  await setCatalogMeta(db, STEAM_PROBE_KEY, JSON.stringify({ at: T0 - 600, ok: true }))
  await setCatalogMeta(db, SWEEP_KEY, JSON.stringify({ at: T0 - 20 * 3600, demos: 0, sessions: 0 }))
}

describe('/api/cron/health', () => {
  test('без секрета — 401, отметки наружу не отдаются', async () => {
    // заголовки HTTP — ByteString, поэтому чужой секрет тоже ASCII
    const res = await ask('wrong-secret-of-same-length-0')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'forbidden' })
  })

  test('все кроны свежие — 200', async () => {
    await allFresh()
    const res = await ask()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      jobs: { news: { ok: true }, digest: { ok: true }, pages: { ok: true } },
    })
  })

  test('крон карточек не приходил больше суток — 503 и видно, какой', async () => {
    // Ровно «с 25.08 нет записей»: суточный вызов не пришёл, а воркфлоу
    // смотрел только на 202 новостей и пересказов и оставался зелёным.
    await allFresh()
    await setCatalogMeta(
      db,
      CRON_JOBS.pages.lastKey,
      JSON.stringify({ at: T0 - PAGES_STALE_SEC - 1, chain: 4 }),
    )
    const res = await ask()
    expect(res.status).toBe(503)
    const body = (await res.json()) as { ok: boolean; jobs: Record<string, unknown> }
    expect(body.ok).toBe(false)
    expect(body.jobs.pages).toMatchObject({ ok: false, problem: 'протух' })
    expect(body.jobs.news).toMatchObject({ ok: true })
  })

  test('оборванная передача звена — 503 с причиной', async () => {
    await allFresh()
    await setCatalogMeta(
      db,
      CRON_JOBS.digest.lastKey,
      JSON.stringify({ at: T0 - 60, chain: 2, обрыв: 'HTTP 401' }),
    )
    const res = await ask()
    expect(res.status).toBe(503)
    expect(((await res.json()) as { jobs: Record<string, unknown> }).jobs.digest).toEqual({
      ok: false,
      problem: 'обрыв',
      ageSec: 60,
      detail: 'HTTP 401',
    })
  })

  test('крон на паузе не валит проверку', async () => {
    await allFresh()
    const weekAgo = JSON.stringify({ at: T0 - 86_400 * 7, chain: 0 })
    await setCatalogMeta(db, CRON_JOBS.news.lastKey, weekAgo)
    await setCatalogMeta(db, CRON_JOBS.news.pausedKey, '1')
    const res = await ask()
    expect(res.status).toBe(200)
    expect(((await res.json()) as { jobs: Record<string, unknown> }).jobs.news).toMatchObject({
      ok: true,
      paused: true,
    })
  })

  test('отказ модели в свежем срезе пересказов — 503 со статусом', async () => {
    await allFresh()
    await setCatalogMeta(
      db,
      CRON_JOBS.digest.lastKey,
      JSON.stringify({ at: T0 - 60, chain: 0, digested: 0, hasMore: false, stopped: 'unavailable', llm: 'down', llmStatus: 402 }),
    )
    const res = await ask()
    expect(res.status).toBe(503)
    expect(((await res.json()) as { jobs: Record<string, unknown> }).jobs.digest).toMatchObject({
      ok: false,
      problem: 'модель недоступна',
      detail: 'HTTP 402',
    })
  })

  test('ключа модели нет вовсе — это настройка, а не авария', async () => {
    await allFresh()
    await setCatalogMeta(
      db,
      CRON_JOBS.digest.lastKey,
      JSON.stringify({ at: T0 - 60, chain: 0, digested: 0, hasMore: false, stopped: 'unavailable' }),
    )
    expect((await ask()).status).toBe(200)
  })

  test('утренний отказ модели у карточек не красит health до вечера', async () => {
    // отметка карточек живёт сутки: старый отказ — уже не новость
    await allFresh()
    await setCatalogMeta(
      db,
      CRON_JOBS.pages.lastKey,
      JSON.stringify({ at: T0 - LLM_DOWN_FRESH_SEC - 1, chain: 3, llm: 'down', llmStatus: null }),
    )
    expect((await ask()).status).toBe(200)
  })

  test('ключ Steam отозван — 503 и причина без самого ключа', async () => {
    await allFresh()
    await setCatalogMeta(
      db,
      STEAM_PROBE_KEY,
      JSON.stringify({ at: T0 - 600, ok: false, detail: 'Steam API /ISteamUser/ResolveVanityURL/v1/: HTTP 403' }),
    )
    const res = await ask()
    expect(res.status).toBe(503)
    expect(((await res.json()) as { checks: Record<string, unknown> }).checks.steamKey).toMatchObject({
      ok: false,
      problem: 'ключ Steam',
      detail: expect.stringContaining('HTTP 403'),
    })
  })

  test('проба ключа не ходила три часа — 503 «протух»', async () => {
    await allFresh()
    await setCatalogMeta(db, STEAM_PROBE_KEY, JSON.stringify({ at: T0 - 3 * 3600, ok: true }))
    const res = await ask()
    expect(res.status).toBe(503)
    expect(((await res.json()) as { checks: Record<string, unknown> }).checks.steamKey).toMatchObject({
      problem: 'протух',
    })
  })

  test('уборки не было двое суток — 503', async () => {
    await allFresh()
    await setCatalogMeta(db, SWEEP_KEY, JSON.stringify({ at: T0 - 48 * 3600 - 1 }))
    const res = await ask()
    expect(res.status).toBe(503)
    expect(((await res.json()) as { checks: Record<string, unknown> }).checks.sweep).toMatchObject({
      ok: false,
      problem: 'протух',
    })
  })

  test('новости на паузе — проба и уборка стоят вместе с ними', async () => {
    await allFresh()
    await setCatalogMeta(db, CRON_JOBS.news.pausedKey, '1')
    await setCatalogMeta(db, STEAM_PROBE_KEY, JSON.stringify({ at: T0 - 86_400 * 3, ok: true }))
    await setCatalogMeta(db, SWEEP_KEY, JSON.stringify({ at: T0 - 86_400 * 3 }))
    const res = await ask()
    expect(res.status).toBe(200)
    expect(((await res.json()) as { checks: Record<string, unknown> }).checks).toMatchObject({
      steamKey: { ok: true, paused: true },
      sweep: { ok: true, paused: true },
    })
  })

  test('расход модели за сутки — справкой, без 503', async () => {
    await allFresh()
    vi.stubEnv('LLM_DAILY_CAP', '2')
    for (let i = 0; i < 3; i++) await takeLlmBudget(db, T0)
    const res = await ask()
    expect(res.status).toBe(200)
    expect(((await res.json()) as { llm: unknown }).llm).toEqual({ used: 3, cap: 2 })
  })

  test('проверка ничего не пишет', async () => {
    await allFresh()
    const before = await db.execute('SELECT key, value FROM catalog_meta ORDER BY key')
    const limitsBefore = await db.execute('SELECT key, count FROM rate_limits ORDER BY key')
    await ask()
    const after = await db.execute('SELECT key, value FROM catalog_meta ORDER BY key')
    expect(after.rows).toEqual(before.rows)
    // справка о бюджете модели читает счётчик, а не берёт из него
    expect((await db.execute('SELECT key, count FROM rate_limits ORDER BY key')).rows).toEqual(limitsBefore.rows)
  })
})
