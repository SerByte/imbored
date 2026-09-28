import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { linksToday, runChain } from '@/lib/chain'
import { CRON_JOBS } from '@/lib/cron'
import { acquireLease, getCatalogMeta, STEAM_LEASE, type Db } from '@/lib/db'
import { freshDb } from '@/lib/testing/route'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

// after() вне сервера Next бросает — копим работу и ждём её сами
const { pending } = vi.hoisted(() => ({ pending: [] as Array<Promise<unknown>> }))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (work: Promise<unknown> | (() => unknown)) => {
    pending.push(typeof work === 'function' ? Promise.resolve().then(work) : work)
  },
}))

async function settled(): Promise<void> {
  while (pending.length) await pending.shift()
}

/**
 * /api/cron/pages — настоящим роутом, на пустой базе: очереди карточек и
 * сверки пусты, в Steam запуск не ходит (fetch здесь бросает — сторож этого).
 * Здесь суточный потолок звеньев в том виде, в каком его видит роут.
 */

const T0 = 1_760_000_000
const SECRET = 'pages-test-secret-0123456789'

let db: Db

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0 * 1000)
  vi.stubEnv('CRON_SECRET', SECRET)
  // при LLM_DAILY_CAP=150 и живой модели потолок карточек — девять звеньев
  vi.stubEnv('LLM_DAILY_CAP', '150')
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test')
  vi.stubGlobal('fetch', async () => {
    throw new Error('пустая очередь не должна ходить в сеть')
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  db = await freshDb()
})

afterEach(async () => {
  await settled()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const ask = () =>
  GET(new Request('https://imbored.test/api/cron/pages', { headers: { 'x-cron-secret': SECRET } }))

describe('/api/cron/pages', () => {
  test('запуск: звено засчитано в сутки, отметка — число звеньев и причина', async () => {
    const res = await ask()
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ started: true, dailyCap: 9, due: 0 })
    await settled()

    expect(await linksToday(db, 'pages', T0)).toBe(1)
    const mark = JSON.parse((await getCatalogMeta(db, CRON_JOBS.pages.lastKey)) ?? '{}') as Record<string, unknown>
    expect(mark).toMatchObject({ links: 1, ended: 'done', claimed: 0, сигналы: { stopped: 'done' } })
  })

  test('суточный потолок выбран — skipped: daily, аренду не берёт', async () => {
    await runChain({
      db,
      job: 'pages',
      lease: { key: STEAM_LEASE, holder: 'pages:earlier' },
      startedAt: Date.now(),
      maxDurationSec: 300,
      maxLinks: 20,
      dailyCap: 9,
      link: async () => ({ hasMore: true }),
      verdict: () => null,
    })
    const res = await ask()
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ skipped: 'daily' })
    expect(pending).toHaveLength(0)
    expect(await acquireLease(db, STEAM_LEASE, 'news:x', 60, T0)).toBe(true)
  })

  test('аренду Steam держат новости — skipped: locked', async () => {
    await acquireLease(db, STEAM_LEASE, 'news:running', 300, T0)
    expect(await (await ask()).json()).toEqual({ skipped: 'locked' })
    expect(pending).toHaveLength(0)
  })
})
