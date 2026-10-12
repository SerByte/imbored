import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { linksToday, runChain } from '@/lib/chain'
import { CRON_JOBS } from '@/lib/cron'
import { acquireLease, getCatalogMeta, setCatalogMeta, STEAM_LEASE, upsertGameMeta, type Db } from '@/lib/db'
import { PRICE_TRUST_SEC } from '@/lib/discount'
import { DEALS_SWEPT_KEY } from '@/lib/gamecache'
import { runPageSlice } from '@/lib/pagejob'
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

// Настоящий revalidatePath вне сервера Next бросает — копим адреса
const { revalidated } = vi.hoisted(() => ({ revalidated: [] as string[] }))
vi.mock('next/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/cache')>()),
  revalidatePath: (path: string) => {
    revalidated.push(path)
  },
}))

// Срез настоящий, но тест может подменить его итог: какие карточки поменялись
vi.mock('@/lib/pagejob', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/pagejob')>()
  return { ...real, runPageSlice: vi.fn(real.runPageSlice) }
})

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
    // ничего не поменялось — ни одной карточки в перегенерацию
    expect(revalidated).toEqual([])
    expect(mark).toMatchObject({ сброшено: 0, итого: { сброшено: 0 } })
    // проход погасших скидок отметился и на пустой базе
    expect(await getCatalogMeta(db, DEALS_SWEPT_KEY)).toBe(String(T0))
  })

  test('карточки, которые срез поменял, уходят в перегенерацию — каждая раз', async () => {
    // Карточка живёт в ISR неделю (lib/gamecache): без сброса свежие pros/cons
    // и кадры ждали бы её конца
    const real = (await vi.importActual<typeof import('@/lib/pagejob')>('@/lib/pagejob')).runPageSlice
    vi.mocked(runPageSlice).mockImplementationOnce(async (...a) => ({
      ...(await real(...a)),
      cards: [730, 570, 730],
    }))
    expect((await ask()).status).toBe(202)
    await settled()
    expect(revalidated).toEqual(['/game/730', '/game/570'])
    // В отметку — число, а не список: итог звена лежит в *_last_slice целиком
    const mark = JSON.parse((await getCatalogMeta(db, CRON_JOBS.pages.lastKey)) ?? '{}') as Record<string, unknown>
    expect(mark).not.toHaveProperty('cards')
    expect(mark).toMatchObject({ сброшено: 2, итого: { сброшено: 2 } })
  })

  test('скидка, погасшая с прошлого запуска, — карточка в перегенерацию, и один раз', async () => {
    // Собранная до конца скидки карточка обещает её в JSON-LD, пока живёт в
    // недельном кэше: строку цены клиент спрячет сам, разметку — нет
    await setCatalogMeta(db, DEALS_SWEPT_KEY, String(T0 - 86_400))
    // Доверие по замеру вышло час назад. Тегов нет — не в пуле, и ни срез
    // карточек, ни сверка сигналов в Steam за ней не пойдут
    await upsertGameMeta(
      db,
      {
        appid: 620,
        name: 'Portal 2',
        tags: {},
        genres: [],
        categories: [],
        priceFinal: 199,
        priceInitial: 999,
        discountPercent: 80,
        priceAt: T0 - 3600 - PRICE_TRUST_SEC,
      },
      T0 - 2 * 86_400,
    )
    expect((await ask()).status).toBe(202)
    await settled()
    expect(revalidated).toEqual(['/game/620'])
    expect(await getCatalogMeta(db, DEALS_SWEPT_KEY)).toBe(String(T0))

    // Следующий запуск через час: эта скидка уже пройдена
    revalidated.length = 0
    vi.setSystemTime((T0 + 3600) * 1000)
    expect((await ask()).status).toBe(202)
    await settled()
    expect(revalidated).toEqual([])
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
