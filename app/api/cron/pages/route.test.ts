import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { routePaths } from '@/lib/i18n'
import { linksToday, runChain } from '@/lib/chain'
import { CRON_JOBS } from '@/lib/cron'
import { acquireLease, getCatalogMeta, setCatalogMeta, STEAM_LEASE, upsertGameMeta, type Db } from '@/lib/db'
import { PRICE_TRUST_SEC } from '@/lib/discount'
import { DEALS_SWEPT_KEY } from '@/lib/gamecache'
import { runCardCatchUp, runPageSlice } from '@/lib/pagejob'
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

// Срез и догон настоящие, но тест может подменить их итог: какие карточки поменялись
vi.mock('@/lib/pagejob', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/pagejob')>()
  return { ...real, runPageSlice: vi.fn(real.runPageSlice), runCardCatchUp: vi.fn(real.runCardCatchUp) }
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
    // пульс отзывов идёт тем же звеном и тоже отмечается — на пустом пуле пустым
    expect(mark).toMatchObject({ пульс: { measured: 0, stopped: 'done' } })
    // ничего не поменялось — ни одной карточки в перегенерацию
    expect(revalidated).toEqual([])
    expect(mark).toMatchObject({ сброшено: 0, итого: { сброшено: 0 } })
    // проход погасших скидок отметился и на пустой базе
    expect(await getCatalogMeta(db, DEALS_SWEPT_KEY)).toBe(String(T0))
  })

  test('карточки, которые срез поменял, уходят в перегенерацию — каждая раз', async () => {
    // Карточка живёт в ISR месяц (lib/gamecache): без сброса свежие pros/cons
    // и кадры ждали бы её конца
    const real = (await vi.importActual<typeof import('@/lib/pagejob')>('@/lib/pagejob')).runPageSlice
    vi.mocked(runPageSlice).mockImplementationOnce(async (...a) => ({
      ...(await real(...a)),
      cards: [730, 570, 730],
    }))
    expect((await ask()).status).toBe(202)
    await settled()
    expect(revalidated).toEqual(['/game/730', '/game/570'].flatMap(routePaths))
    // В отметку — число, а не список: итог звена лежит в *_last_slice целиком
    const mark = JSON.parse((await getCatalogMeta(db, CRON_JOBS.pages.lastKey)) ?? '{}') as Record<string, unknown>
    expect(mark).not.toHaveProperty('cards')
    expect(mark).toMatchObject({ сброшено: 2, итого: { сброшено: 2 } })
  })

  /**
   * Догон русского и «Наиграли» (runCardCatchUp) — на каждом звене, до среза:
   * после среза он не начался бы никогда. Его карточки уходят в тот же сброс,
   * что и карточки среза, — иначе строка ждала бы месячного срока ISR.
   */
  test('догон идёт в звене до среза, его карточки — в тот же сброс, счёт — в отметку', async () => {
    const order: string[] = []
    vi.mocked(runCardCatchUp).mockImplementationOnce(async () => {
      order.push('догон')
      return { русский: 2, наиграли: 1, cards: [730, 570] }
    })
    const real = (await vi.importActual<typeof import('@/lib/pagejob')>('@/lib/pagejob')).runPageSlice
    vi.mocked(runPageSlice).mockImplementationOnce(async (...a) => {
      order.push('срез')
      return { ...(await real(...a)), cards: [570, 440] }
    })

    expect((await ask()).status).toBe(202)
    await settled()

    expect(order).toEqual(['догон', 'срез'])
    expect([...revalidated].sort()).toEqual(['/game/440', '/game/570', '/game/730'].flatMap(routePaths).sort())
    const mark = JSON.parse((await getCatalogMeta(db, CRON_JOBS.pages.lastKey)) ?? '{}') as Record<string, unknown>
    expect(mark).toMatchObject({
      русский: 2,
      наиграли: 1,
      сброшено: 3,
      итого: { русский: 2, наиграли: 1, сброшено: 3 },
    })
  })

  test('упавший догон не роняет звено: срез идёт, счёта догона в отметке нет', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(runCardCatchUp).mockRejectedValueOnce(new Error('Turso: operation timed out'))

    expect((await ask()).status).toBe(202)
    await settled()

    expect(runPageSlice).toHaveBeenCalled()
    const mark = JSON.parse((await getCatalogMeta(db, CRON_JOBS.pages.lastKey)) ?? '{}') as Record<string, unknown>
    expect(mark).toMatchObject({ links: 1, ended: 'done', claimed: 0 })
    expect(mark).not.toHaveProperty('упало')
    expect(mark).not.toHaveProperty('русский')
  })

  /**
   * Строки, которые догон поменял, из его очереди уже ушли: язык записан,
   * отметка разбора за отсечкой. Сбрасывай их роут только вместе с карточками
   * среза — упавший срез унёс бы и их сброс, и следующее звено их бы не
   * вернуло: страницы ждали бы конца месячного кэша.
   */
  test('упавший срез не теряет карточек догона: они сброшены до него', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(runCardCatchUp).mockResolvedValueOnce({ русский: 1, наиграли: 1, cards: [730, 570] })
    vi.mocked(runPageSlice).mockRejectedValueOnce(new Error('Turso: operation timed out'))

    expect((await ask()).status).toBe(202)
    await settled()

    // Следующее звено идёт по настоящей пустой базе, и сбросить ему нечего:
    // эти адреса — от звена, чей срез упал
    expect([...revalidated].sort()).toEqual(['/game/570', '/game/730'].flatMap(routePaths).sort())
  })

  test('скидка, погасшая с прошлого запуска, — карточка в перегенерацию, и один раз', async () => {
    // Собранная до конца скидки карточка обещает её в JSON-LD, пока живёт в
    // месячном кэше: строку цены клиент спрячет сам, разметку — нет
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
    expect(revalidated).toEqual(routePaths('/game/620'))
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
