import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { linksToday, runChain } from '@/lib/chain'
import { CRON_JOBS, SWEEP_KEY } from '@/lib/cron'
import { acquireLease, getCatalogMeta, releaseLease, setCatalogMeta, STEAM_LEASE, type Db } from '@/lib/db'
import { runNewsSlice } from '@/lib/newsjob'
import { STEAM_PROBE_KEY } from '@/lib/steamprobe'
import { freshDb } from '@/lib/testing/route'
import { GET as health } from '../health/route'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/*
 * after() из next/server вне сервера Next бросает. Здесь работа складывается в
 * список, чтобы тест мог дождаться всего запуска: звенья, итог, пинки.
 */
const { pending } = vi.hoisted(() => ({ pending: [] as Array<Promise<unknown>> }))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (work: Promise<unknown> | (() => unknown)) => {
    pending.push(typeof work === 'function' ? Promise.resolve().then(work) : work)
  },
}))

// Настоящие revalidateTag и revalidatePath вне сервера Next бросают; ленте в
// этих тестах сбрасывать нечего — запуск на пустой базе ничего не вставляет, —
// а адреса карточек копим: их сброс роут делает по итогу звена
const { revalidated } = vi.hoisted(() => ({ revalidated: [] as string[] }))
vi.mock('next/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/cache')>()),
  revalidateTag: () => {},
  revalidatePath: (path: string) => {
    revalidated.push(path)
  },
}))

// Срез новостей — настоящий, но тест может придержать его на старте: так
// выглядит запуск, у которого after() дошёл до первого звена
vi.mock('@/lib/newsjob', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/newsjob')>()
  return { ...real, runNewsSlice: vi.fn(real.runNewsSlice) }
})

async function settled(): Promise<void> {
  while (pending.length) await pending.shift()
}

/**
 * /api/cron/news — настоящим роутом, на пустой базе: очередь опроса пуста,
 * значит в Steam запуск не ходит, а всё, что вокруг среза, — настоящее.
 * Здесь то, что из lib/ не видно: роут отдаёт звенья циклу, а конец запуска
 * пинает соседей — один HTTP-шаг, и никогда себя.
 */

const T0 = 1_760_000_000
const SECRET = 'news-test-secret-0123456789'
const BASE = 'https://imbored.test'

let db: Db
let kicked: string[]

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0 * 1000)
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.stubEnv('APP_BASE_URL', BASE)
  // без ключа проба Steam пишет отметку, не выходя в сеть
  vi.stubEnv('STEAM_API_KEY', '')
  // потолок карточек при LLM_DAILY_CAP=150 и живой модели — девять звеньев
  vi.stubEnv('LLM_DAILY_CAP', '150')
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test')
  db = await freshDb()
  kicked = []
  vi.stubGlobal('fetch', async (url: string) => {
    kicked.push(url)
    return new Response(JSON.stringify({ started: true }), { status: 202 })
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  revalidated.length = 0
})

afterEach(async () => {
  await settled()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const ask = () =>
  GET(new Request(`${BASE}/api/cron/news`, { headers: { 'x-cron-secret': SECRET } }))

/** Пересказы отработали только что — пинать их незачем */
const digestFresh = () =>
  setCatalogMeta(db, CRON_JOBS.digest.lastKey, JSON.stringify({ at: T0 - 60, links: 1, ended: 'done' }))

describe('/api/cron/news', () => {
  test('звенья — внутри вызова: отметка с числом звеньев и причиной, аренда отдана', async () => {
    await digestFresh()
    const res = await ask()
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ started: true, due: 0 })
    await settled()

    const mark = JSON.parse((await getCatalogMeta(db, CRON_JOBS.news.lastKey)) ?? '{}') as Record<string, unknown>
    expect(mark).toMatchObject({ links: 1, ended: 'done', hasMore: false, итого: { polled: 0, inserted: 0 } })
    expect(mark).not.toHaveProperty('chain')
    expect(await acquireLease(db, STEAM_LEASE, 'other', 60, T0)).toBe(true)
    // лента ни у кого не поменялась — карточки не сбрасываются
    expect(revalidated).toEqual([])
  })

  test('карточки игр с новыми патчами уходят в перегенерацию', async () => {
    // Карточка живёт в ISR неделю (lib/gamecache): новый патч не должен ждать
    // её конца
    await digestFresh()
    const real = (await vi.importActual<typeof import('@/lib/newsjob')>('@/lib/newsjob')).runNewsSlice
    vi.mocked(runNewsSlice).mockImplementationOnce(async (...a) => ({ ...(await real(...a)), cards: [730] }))
    expect((await ask()).status).toBe(202)
    await settled()
    expect(revalidated).toEqual(['/game/730'])
    // В отметку — число, а не список: у новостей это десятки appid на звено
    const mark = JSON.parse((await getCatalogMeta(db, CRON_JOBS.news.lastKey)) ?? '{}') as Record<string, unknown>
    expect(mark).not.toHaveProperty('cards')
    expect(mark).toMatchObject({ сброшено: 1, итого: { сброшено: 1 } })
  })

  test('конец запуска пинает карточки, пока суточный потолок звеньев не выбран', async () => {
    await digestFresh()
    await ask()
    await settled()
    // один шаг от корневого вызова, и никогда — себя
    expect(kicked).toEqual([`${BASE}/api/cron/pages`])
  })

  test('потолок выбран — карточек не пинает до полуночи UTC', async () => {
    await digestFresh()
    await runChain({
      db,
      job: 'pages',
      lease: { key: STEAM_LEASE, holder: 'pages:test' },
      startedAt: Date.now(),
      maxDurationSec: 300,
      maxLinks: 20,
      dailyCap: 9,
      link: async () => ({ hasMore: true }),
      verdict: () => null,
    })
    expect(await linksToday(db, 'pages', T0)).toBe(9)
    await ask()
    await settled()
    expect(kicked).toEqual([])

    vi.setSystemTime((T0 + 86_400) * 1000)
    await setCatalogMeta(db, CRON_JOBS.digest.lastKey, JSON.stringify({ at: T0 + 86_400 - 60, links: 1, ended: 'done' }))
    await ask()
    await settled()
    expect(kicked).toEqual([`${BASE}/api/cron/pages`])
  })

  test('пересказы молчат дольше трёх часов — пинает и их', async () => {
    await ask()
    await settled()
    expect(kicked).toEqual([`${BASE}/api/cron/digest`, `${BASE}/api/cron/pages`])
  })

  test('аренду Steam держат карточки — skipped: locked, без запуска и пинков', async () => {
    await acquireLease(db, STEAM_LEASE, 'pages:running', 300, T0)
    const res = await ask()
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ skipped: 'locked' })
    await settled()
    expect(kicked).toEqual([])
    expect(await getCatalogMeta(db, CRON_JOBS.news.lastKey)).toBeNull()
    await releaseLease(db, STEAM_LEASE, 'pages:running')
  })

  test('килл-свитч — ни аренды, ни запуска', async () => {
    await setCatalogMeta(db, CRON_JOBS.news.pausedKey, '1')
    expect(await (await ask()).json()).toEqual({ paused: true })
    await settled()
    expect(await acquireLease(db, STEAM_LEASE, 'other', 60, T0)).toBe(true)
  })
})

/**
 * Реальный порядок, в котором health видит отметки: пинок крона, секунды, и
 * health. Стартовая отметка пишется через сотню миллисекунд после 202 — и,
 * затирай она всё подряд, итог упавшего прошлого запуска не дожил бы до
 * чтения: health отвечал бы 200 каждый час при восьми упавших звеньях из
 * восьми.
 */
describe('/api/cron/news, затем /api/cron/health', () => {
  const askHealth = () =>
    health(new Request(`${BASE}/api/cron/health`, { headers: { 'x-cron-secret': SECRET } }))

  /** Соседи и проверки в порядке: 503, если будет, — только из-за новостей */
  async function othersFresh(): Promise<void> {
    await digestFresh()
    await setCatalogMeta(db, CRON_JOBS.pages.lastKey, JSON.stringify({ at: T0 - 600, links: 6, ended: 'time' }))
    await setCatalogMeta(db, STEAM_PROBE_KEY, JSON.stringify({ at: T0 - 600, ok: true }))
    await setCatalogMeta(db, SWEEP_KEY, JSON.stringify({ at: T0 - 3600 }))
  }

  /**
   * Придержать звено новостей на старте. reached — дождаться, пока запуск до
   * него дойдёт (стартовая отметка к этому моменту уже решена), open —
   * отпустить.
   */
  async function holdLink(): Promise<{ reached: () => Promise<void>; open: () => void }> {
    const real = (await vi.importActual<typeof import('@/lib/newsjob')>('@/lib/newsjob')).runNewsSlice
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    let started = false
    vi.mocked(runNewsSlice).mockImplementationOnce(async (...a) => {
      started = true
      await gate
      return real(...a)
    })
    return { reached: () => vi.waitFor(() => expect(started).toBe(true)), open }
  }

  test('прошлый запуск упал — health видит «упало», пока нынешний не дописал звено', async () => {
    await othersFresh()
    await setCatalogMeta(
      db,
      CRON_JOBS.news.lastKey,
      JSON.stringify({ at: T0 - 3600, links: 8, ended: 'links', упало: 'SQLITE_BUSY: database is locked' }),
    )
    const { reached, open } = await holdLink()
    try {
      expect((await ask()).status).toBe(202)
      await reached()

      const res = await askHealth()
      expect(res.status).toBe(503)
      expect(((await res.json()) as { jobs: unknown }).jobs).toMatchObject({
        news: { ok: false, problem: 'упало', detail: 'SQLITE_BUSY: database is locked' },
        digest: { ok: true },
        pages: { ok: true },
      })
    } finally {
      open()
    }
    await settled()
    // нынешний запуск дописал свой итог — он и есть свежая правда
    expect(((await (await askHealth()).json()) as { jobs: { news: unknown } }).jobs.news).toMatchObject({ ok: true })
  })

  test('прошлый запуск здоров — стартовая отметка, и health видит «запуск идёт»', async () => {
    await othersFresh()
    await setCatalogMeta(db, CRON_JOBS.news.lastKey, JSON.stringify({ at: T0 - 3600, links: 1, ended: 'done' }))
    const { reached, open } = await holdLink()
    try {
      await ask()
      await reached()
      expect(JSON.parse((await getCatalogMeta(db, CRON_JOBS.news.lastKey)) ?? '{}')).toMatchObject({
        at: T0,
        links: 0,
      })
      expect((await askHealth()).status).toBe(200)
    } finally {
      open()
    }
  })
})
