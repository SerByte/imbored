import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { routePaths } from '@/lib/i18n'
import { CRON_JOBS, sliceHealth } from '@/lib/cron'
import { acquireLease, DIGEST_LEASE, getCatalogMeta, type Db } from '@/lib/db'
import { takeLlmBudget } from '@/lib/llmcap'
import { runDigestSlice } from '@/lib/newsjob'
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
const { revalidated } = vi.hoisted(() => ({ revalidated: [] as string[] }))
vi.mock('next/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/cache')>()),
  revalidateTag: () => {},
  revalidatePath: (path: string) => {
    revalidated.push(path)
  },
}))

// Срез настоящий, но тест может подменить его итог: чьи патчи пересказаны
vi.mock('@/lib/newsjob', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/newsjob')>()
  return { ...real, runDigestSlice: vi.fn(real.runDigestSlice) }
})

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
  revalidated.length = 0
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
    expect(revalidated).toEqual([])
  })

  test('карточки игр с новым пересказом уходят в перегенерацию', async () => {
    // Пересказ стоит на карточке строкой под патчем, а карточка живёт в ISR
    // неделю (lib/gamecache)
    vi.mocked(runDigestSlice).mockResolvedValueOnce({
      digested: 2,
      cards: [730, 570],
      hasMore: false,
      stopped: 'done',
    })
    expect((await ask()).status).toBe(202)
    await settled()
    // и архивы обновлений тех же игр: пересказ там — главное в строке.
    // «сброшено» ниже — по-прежнему число игр, а не адресов. Каждый адрес —
    // в обеих языковых копиях маршрута (revalidateSitePath)
    expect(revalidated.sort()).toEqual(
      ['/game/570', '/game/570/news', '/game/730', '/game/730/news'].flatMap(routePaths).sort(),
    )
    const mark = await lastMark()
    expect(mark).not.toHaveProperty('cards')
    expect(mark).toMatchObject({ digested: 2, сброшено: 2, итого: { digested: 2, сброшено: 2 } })
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
