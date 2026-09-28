import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CRON_JOBS, sliceHealth } from '@/lib/cron'
import { acquireLease, DIGEST_LEASE, getCatalogMeta, type Db } from '@/lib/db'
import { takeLlmBudget } from '@/lib/llmcap'
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
vi.mock('next/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/cache')>()),
  revalidateTag: () => {},
  revalidatePath: () => {},
}))

async function settled(): Promise<void> {
  while (pending.length) await pending.shift()
}

/**
 * /api/cron/digest — настоящим роутом, на пустой базе: пересказывать нечего,
 * модель не зовётся (fetch бросает — сторож этого). Здесь то, что звеньям
 * пересказов нужна модель: без бюджета суток запуск не начинает ни одного.
 */

const T0 = 1_760_000_000
const SECRET = 'digest-test-secret-0123456789'

let db: Db

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0 * 1000)
  vi.stubEnv('CRON_SECRET', SECRET)
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
  GET(new Request('https://imbored.test/api/cron/digest', { headers: { 'x-cron-secret': SECRET } }))

const lastMark = async () =>
  JSON.parse((await getCatalogMeta(db, CRON_JOBS.digest.lastKey)) ?? '{}') as Record<string, unknown>

describe('/api/cron/digest', () => {
  test('очередь пуста — одно звено, done, аренда отдана', async () => {
    expect((await ask()).status).toBe(202)
    await settled()
    expect(await lastMark()).toMatchObject({ links: 1, ended: 'done', итого: { digested: 0 } })
    expect(await acquireLease(db, DIGEST_LEASE, 'other', 60, T0)).toBe(true)
  })

  test('бюджет модели на сутки выбран — запуск кончается, не начав звена', async () => {
    vi.stubEnv('LLM_DAILY_CAP', '1')
    await takeLlmBudget(db, T0)
    expect((await ask()).status).toBe(202)
    await settled()
    const mark = await lastMark()
    expect(mark).toMatchObject({ links: 0, ended: 'llm' })
    // выбранный бюджет — не авария: сервис ждёт завтрашнего
    expect(sliceHealth(JSON.stringify(mark), T0, 3 * 3600)).toMatchObject({ ok: true })
  })
})
