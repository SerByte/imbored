import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  CRON_JOBS,
  CRON_TAIL_MS,
  cronAuthorized,
  DIGEST_STALE_SEC,
  PAGES_STALE_SEC,
  pagesChainGoesOn,
  pagesNeedKick,
  sliceClock,
  sliceDeadline,
  sliceHealth,
  sliceLooksStale,
} from './cron'

// Заголовки HTTP это ByteString: секрет обязан быть ASCII.
// Vercel генерирует hex, так что на практике это не ограничение.
const h = (init: Record<string, string> = {}) => new Headers(init)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('cronAuthorized', () => {
  test('пускает по Bearer, которым Vercel зовёт крон', () => {
    vi.stubEnv('CRON_SECRET', 's3cr3t-long-enough-abc')
    expect(cronAuthorized(h({ authorization: 'Bearer s3cr3t-long-enough-abc' }))).toBe(true)
    expect(cronAuthorized(h({ Authorization: 'bearer s3cr3t-long-enough-abc' }))).toBe(true)
  })

  test('пускает по x-cron-secret — для curl и внешнего пингера', () => {
    vi.stubEnv('CRON_SECRET', 's3cr3t-long-enough-abc')
    expect(cronAuthorized(h({ 'x-cron-secret': 's3cr3t-long-enough-abc' }))).toBe(true)
  })

  test('чужой или пустой секрет не проходит', () => {
    vi.stubEnv('CRON_SECRET', 's3cr3t-long-enough-abc')
    expect(cronAuthorized(h())).toBe(false)
    expect(cronAuthorized(h({ authorization: 'Bearer wrong-but-same-len' }))).toBe(false)
    expect(cronAuthorized(h({ 'x-cron-secret': '' }))).toBe(false)
    // разная длина не должна ронять timingSafeEqual
    expect(() => cronAuthorized(h({ 'x-cron-secret': 'x' }))).not.toThrow()
  })

  test('без секрета в проде закрыто наглухо', () => {
    // иначе публичный роут, дёргающий Steam и Claude, — бесплатный усилитель
    vi.stubEnv('CRON_SECRET', '')
    vi.stubEnv('VERCEL', '1')
    expect(cronAuthorized(h())).toBe(false)

    vi.stubEnv('VERCEL', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(cronAuthorized(h())).toBe(false)
  })

  test('локально без секрета открыто, чтобы не мешать разработке', () => {
    vi.stubEnv('CRON_SECRET', '')
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('NODE_ENV', 'test')
    expect(cronAuthorized(h())).toBe(true)
  })
})

const NOW = 1_700_000_000
const slice = (at: number) => JSON.stringify({ at, chain: 0, digested: 25 })

describe('sliceLooksStale: подстраховка на случай, если расписание замолчит', () => {
  const stale = (raw: string | null, max = DIGEST_STALE_SEC) => sliceLooksStale(raw, NOW, max)

  test('свежий срез — не трогаем', () => {
    expect(stale(slice(NOW - 600))).toBe(false)
  })

  test('молчит дольше порога — пинаем', () => {
    expect(stale(slice(NOW - DIGEST_STALE_SEC + 1))).toBe(false)
    expect(stale(slice(NOW - DIGEST_STALE_SEC))).toBe(true)
  })

  test('ни разу не отрабатывал — пинаем', () => {
    // первый прогон после деплоя: записи ещё нет
    expect(stale(null)).toBe(true)
  })

  test('мусор вместо записи — тоже пинаем', () => {
    // отсутствие подтверждения, что крон жив, и есть повод пнуть:
    // молчаливая поломка хуже лишнего запроса
    expect(stale('не json')).toBe(true)
    expect(stale('{}')).toBe(true)
    expect(stale(JSON.stringify({ at: 'вчера' }))).toBe(true)
    expect(stale(JSON.stringify({ at: 0 }))).toBe(true)
    expect(stale('null')).toBe(true)
  })

  test('порог у каждого свой', () => {
    expect(stale(slice(NOW - 100), 50)).toBe(true)
    expect(stale(slice(NOW - 100), 500)).toBe(false)
  })
})

describe('pagesNeedKick: у карточек одно суточное расписание и не было повтора', () => {
  const pages = (at: number, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ at, chain: 3, enriched: 14, hasMore: true, stopped: 'budget', ...extra })

  test('вчерашний срез в пределах суток с запасом — не трогаем', () => {
    expect(pagesNeedKick(pages(NOW - 24 * 3600), NOW)).toBe(false)
  })

  test('вызова из vercel.json не было больше суток — пинаем', () => {
    // пропущенный вызов, skipped: locked под арендой новостей — сутки без повтора
    expect(pagesNeedKick(pages(NOW - PAGES_STALE_SEC), NOW)).toBe(true)
    expect(pagesNeedKick(null, NOW)).toBe(true)
  })

  test('цепочка оборвалась на передаче звена — пинаем, не дожидаясь завтра', () => {
    expect(pagesNeedKick(pages(NOW - 3600, { обрыв: 'HTTP 503' }), NOW)).toBe(true)
  })

  test('упавшее последнее звено — не повод: суточная норма звеньев уже выбрана', () => {
    // упавшее звено само передаёт эстафету, и последней «упало» остаётся
    // только на MAX_CHAIN
    const last = JSON.stringify({ at: NOW - 3600, chain: 24, упало: 'fetch failed' })
    expect(pagesNeedKick(last, NOW)).toBe(false)
  })
})

describe('sliceHealth: что видит /api/cron/health', () => {
  const H = 3600

  test('свежая спокойная отметка — здоров', () => {
    expect(sliceHealth(slice(NOW - 60), NOW, H)).toEqual({ ok: true, ageSec: 60 })
  })

  test('нет записи, протух, упало, обрыв — нездоров, и видно почему', () => {
    expect(sliceHealth(null, NOW, H)).toEqual({ ok: false, problem: 'нет записи' })
    expect(sliceHealth('мусор', NOW, H)).toMatchObject({ ok: false, problem: 'нет записи' })
    expect(sliceHealth(slice(NOW - H), NOW, H)).toEqual({ ok: false, problem: 'протух', ageSec: H })
    expect(
      sliceHealth(JSON.stringify({ at: NOW - 60, chain: 0, упало: 'SQLITE_BUSY' }), NOW, H),
    ).toEqual({ ok: false, problem: 'упало', ageSec: 60, detail: 'SQLITE_BUSY' })
    expect(
      sliceHealth(JSON.stringify({ at: NOW - 60, chain: 5, обрыв: 'HTTP 401' }), NOW, H),
    ).toEqual({ ok: false, problem: 'обрыв', ageSec: 60, detail: 'HTTP 401' })
  })

  test('пауза — здорова, но видна: её ставят руками, и письмо каждый час — шум', () => {
    expect(sliceHealth(slice(NOW - 10 * H), NOW, H, true)).toEqual({
      ok: true,
      paused: true,
      ageSec: 10 * H,
    })
    expect(sliceHealth(null, NOW, H, true)).toEqual({ ok: true, paused: true })
  })

  test('у каждого крона свой ключ, и ключи не пересекаются', () => {
    const keys = Object.values(CRON_JOBS).flatMap((j) => [j.lastKey, j.pausedKey])
    expect(new Set(keys).size).toBe(keys.length)
    expect(CRON_JOBS.pages.staleSec).toBe(PAGES_STALE_SEC)
  })
})

describe('срок среза крона', () => {
  test('считается от начала вызова и оставляет хвост под finally', () => {
    // Раньше срок брался внутри after(), то есть после ответа: холодный старт,
    // миграции и аренда в бюджет не входили, а maxDuration их считает.
    const startedAt = 1_000_000
    expect(sliceDeadline(startedAt, 60)).toBe(startedAt + 60_000 - CRON_TAIL_MS)
    expect(sliceDeadline(startedAt, 60)).toBeLessThan(startedAt + 50_000)
  })
})

describe('sliceClock: уложится ли ещё одна итерация', () => {
  test('первая итерация идёт по одному сроку', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(10_000)
    expect(sliceClock(10_000).next()).toBe(true)
    expect(sliceClock(9_999).next()).toBe(false)
  })

  test('самая долгая итерация становится запасом для следующих', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    const часы = sliceClock(30_000)
    expect(часы.next()).toBe(true) // t=0
    vi.setSystemTime(8_000)
    expect(часы.next()).toBe(true) // t=8, запас 8 → 16 ≤ 30
    vi.setSystemTime(10_000)
    expect(часы.longestMs).toBe(8_000)
    expect(часы.next()).toBe(true) // короткая итерация максимум не снижает: 18 ≤ 30
    expect(часы.longestMs).toBe(8_000)
    vi.setSystemTime(23_000)
    expect(часы.next()).toBe(false) // 23 + 13 > 30
  })
})

describe('pagesChainGoesOn: передавать ли звено крона карточек', () => {
  const base = { failed: false, chain: 0, maxChain: 24, hasSecret: true }
  const slice = (hasMore: boolean, stopped: 'done' | 'budget' | 'blocked' = 'budget') => ({ hasMore, stopped })

  test('работа у карточек — дальше, как было', () => {
    expect(pagesChainGoesOn({ ...base, slice: slice(true), signals: null })).toBe(true)
    expect(pagesChainGoesOn({ ...base, slice: slice(false, 'done'), signals: null })).toBe(false)
  })

  test('карточки выбраны, а у сверки сигналов устаревшие остались — дальше', () => {
    // иначе сверка шла бы пачкой в сутки: круг по пулу в месяц
    expect(pagesChainGoesOn({ ...base, slice: slice(false, 'done'), signals: { stopped: 'budget' } })).toBe(true)
    expect(pagesChainGoesOn({ ...base, slice: slice(false, 'done'), signals: { stopped: 'done' } })).toBe(false)
    // Steam отказал сверке — не повод звать следующее звено ради неё
    expect(pagesChainGoesOn({ ...base, slice: slice(false, 'done'), signals: { stopped: 'blocked' } })).toBe(false)
  })

  test('блок магазина у карточек останавливает цепочку, даже если сверке есть что делать', () => {
    expect(
      pagesChainGoesOn({ ...base, slice: slice(true, 'blocked'), signals: { stopped: 'budget' } }),
    ).toBe(false)
  })

  test('упавшее звено передаёт эстафету; без секрета и за потолком — никогда', () => {
    expect(pagesChainGoesOn({ ...base, failed: true, slice: null, signals: null })).toBe(true)
    expect(pagesChainGoesOn({ ...base, hasSecret: false, slice: slice(true), signals: null })).toBe(false)
    expect(
      pagesChainGoesOn({ ...base, chain: 24, failed: true, slice: null, signals: { stopped: 'budget' } }),
    ).toBe(false)
  })
})
