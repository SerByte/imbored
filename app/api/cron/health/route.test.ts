import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CRON_JOBS, PAGES_STALE_SEC } from '@/lib/cron'
import { setCatalogMeta, type Db } from '@/lib/db'
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

/** Все три крона отработали минуту назад и ни на что не жалуются */
async function allFresh(): Promise<void> {
  for (const job of Object.values(CRON_JOBS)) {
    await setCatalogMeta(db, job.lastKey, JSON.stringify({ at: T0 - 60, chain: 0, hasMore: false }))
  }
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

  test('проверка ничего не пишет', async () => {
    await allFresh()
    const before = await db.execute('SELECT key, value FROM catalog_meta ORDER BY key')
    await ask()
    const after = await db.execute('SELECT key, value FROM catalog_meta ORDER BY key')
    expect(after.rows).toEqual(before.rows)
  })
})
