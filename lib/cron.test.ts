import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  CRON_JOBS,
  CRON_MAX_DURATION_SEC,
  CRON_TAIL_MS,
  cronAuthorized,
  DIGEST_STALE_SEC,
  digestLinkVerdict,
  newsLinkVerdict,
  PAGES_LINKS_CPU_CAP,
  PAGES_LINKS_MIN,
  PAGES_STALE_SEC,
  pagesDailyLinks,
  pagesLinkVerdict,
  pagesNeedKick,
  RUN_LOST_SEC,
  sliceAlarm,
  sliceClock,
  sliceDeadline,
  sliceHealth,
  sliceLooksStale,
  steamKeyHealth,
  LLM_DOWN_FRESH_SEC,
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

describe('pagesNeedKick: часовой ритм карточек — от конца запуска новостей', () => {
  test('пока суточный потолок звеньев не выбран — пинаем', () => {
    expect(pagesNeedKick({ linksToday: 0, cap: 9 })).toBe(true)
    expect(pagesNeedKick({ linksToday: 8, cap: 9 })).toBe(true)
  })

  test('выбран — до полуночи UTC не пинаем: пинок только упёрся бы в потолок', () => {
    expect(pagesNeedKick({ linksToday: 9, cap: 9 })).toBe(false)
    // владелец опустил LLM_DAILY_CAP посреди суток — потолок стал ниже пройденного
    expect(pagesNeedKick({ linksToday: 12, cap: 9 })).toBe(false)
  })
})

describe('pagesDailyLinks: суточный потолок звеньев карточек', () => {
  test('при LLM_DAILY_CAP=150 — девять звеньев: половина бюджета по восемь вызовов', () => {
    expect(pagesDailyLinks({ llmCap: 150, llmOn: true })).toBe(9)
  })

  test('большой бюджет модели упирается в потолок по Active CPU', () => {
    expect(pagesDailyLinks({ llmCap: 2000, llmOn: true })).toBe(PAGES_LINKS_CPU_CAP)
  })

  test('без модели — только CPU: модель такие звенья не тратят', () => {
    expect(pagesDailyLinks({ llmCap: 150, llmOn: false })).toBe(PAGES_LINKS_CPU_CAP)
    // LLM_DAILY_CAP=0 — модель выключена намеренно
    expect(pagesDailyLinks({ llmCap: 0, llmOn: true })).toBe(PAGES_LINKS_CPU_CAP)
  })

  test('крошечный бюджет не останавливает скриншоты и семантику', () => {
    expect(pagesDailyLinks({ llmCap: 10, llmOn: true })).toBe(PAGES_LINKS_MIN)
  })
})

describe('sliceHealth: что видит /api/cron/health', () => {
  const H = 3600

  test('свежая спокойная отметка — здоров', () => {
    expect(sliceHealth(slice(NOW - 60), NOW, H)).toEqual({ ok: true, ageSec: 60 })
  })

  test('нет записи, протух, упало — нездоров, и видно почему', () => {
    expect(sliceHealth(null, NOW, H)).toEqual({ ok: false, problem: 'нет записи' })
    expect(sliceHealth('мусор', NOW, H)).toMatchObject({ ok: false, problem: 'нет записи' })
    expect(sliceHealth(slice(NOW - H), NOW, H)).toEqual({ ok: false, problem: 'протух', ageSec: H })
    expect(
      sliceHealth(JSON.stringify({ at: NOW - 60, links: 1, ended: 'failed', упало: 'SQLITE_BUSY' }), NOW, H),
    ).toEqual({ ok: false, problem: 'упало', ageSec: 60, detail: 'SQLITE_BUSY' })
  })

  test('обрыв передачи звена больше не авария: звено не передаётся по HTTP', () => {
    // Ровно так выглядела норма до перехода: 508 на втором шаге самовызова,
    // и health краснел каждый день. Такая отметка перезапишется первым же
    // запуском, а до того ничего не значит.
    const old = JSON.stringify({ at: NOW - 60, chain: 1, enriched: 14, stopped: 'budget', обрыв: 'HTTP 508' })
    expect(sliceHealth(old, NOW, H)).toEqual({ ok: true, ageSec: 60 })
  })

  test('запуск кончился — любая причина, кроме «упало», здорова', () => {
    for (const ended of ['done', 'time', 'links', 'daily', 'llm', 'blocked', 'paused', 'lease']) {
      expect(sliceHealth(JSON.stringify({ at: NOW - 60, links: 3, ended }), NOW, H)).toEqual({
        ok: true,
        ageSec: 60,
      })
    }
  })

  test('запуск идёт — промежуточная отметка без ended здорова', () => {
    const running = JSON.stringify({ at: NOW - 120, links: 2, enriched: 13 })
    expect(sliceHealth(running, NOW, H)).toEqual({ ok: true, ageSec: 120 })
    expect(sliceHealth(JSON.stringify({ at: NOW - 5, links: 0 }), NOW, H)).toEqual({ ok: true, ageSec: 5 })
  })

  test('промежуточная отметка старше maxDuration — запуск сняли, не дав дописать итог', () => {
    // Единственный путь, которым звенья внутри вызова умирают молча
    expect(RUN_LOST_SEC).toBeGreaterThan(CRON_MAX_DURATION_SEC)
    const lost = JSON.stringify({ at: NOW - RUN_LOST_SEC, links: 4, enriched: 12 })
    expect(sliceHealth(lost, NOW, 26 * H)).toEqual({
      ok: false,
      problem: 'снят',
      ageSec: RUN_LOST_SEC,
      detail: 'звеньев: 4',
    })
    expect(sliceHealth(JSON.stringify({ at: NOW - RUN_LOST_SEC + 1, links: 4 }), NOW, 26 * H)).toMatchObject({
      ok: true,
    })
    // снятый на старте, до первого звена
    expect(sliceHealth(JSON.stringify({ at: NOW - 3600, links: 0 }), NOW, 26 * H)).toMatchObject({
      problem: 'снят',
      detail: 'звеньев: 0',
    })
  })

  test('отметки старого вида без links — не «снят», как бы стары ни были', () => {
    expect(sliceHealth(JSON.stringify({ at: NOW - 3600, chain: 3 }), NOW, 26 * H)).toEqual({
      ok: true,
      ageSec: 3600,
    })
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

describe('sliceAlarm: что стартовая отметка запуска не вправе затереть', () => {
  const at = (ago: number, extra: Record<string, unknown>) => JSON.stringify({ at: NOW - ago, ...extra })

  test('упало, снят, свежий отказ модели — тревога: health её ещё не прочёл', () => {
    expect(sliceAlarm(at(3600, { links: 8, ended: 'links', упало: 'SQLITE_BUSY' }), NOW)).toBe(true)
    expect(sliceAlarm(at(3600, { links: 2 }), NOW)).toBe(true)
    expect(sliceAlarm(at(3600, { links: 1, ended: 'llm', llm: 'down', llmStatus: 402 }), NOW)).toBe(true)
  })

  test('здоровый итог, нет записи и мусор — затирать нечего', () => {
    for (const ended of ['done', 'time', 'links', 'daily', 'llm', 'blocked', 'paused', 'lease']) {
      expect(sliceAlarm(at(3600, { links: 3, ended }), NOW)).toBe(false)
    }
    expect(sliceAlarm(null, NOW)).toBe(false)
    expect(sliceAlarm('мусор', NOW)).toBe(false)
    // старый отказ модели health уже не показывает — и беречь его незачем
    expect(sliceAlarm(at(LLM_DOWN_FRESH_SEC, { links: 1, ended: 'daily', llm: 'down' }), NOW)).toBe(false)
  })

  test('«протух» — не тревога, которую надо беречь: её лечит сам начатый запуск', () => {
    expect(sliceAlarm(at(30 * 86_400, { links: 1, ended: 'done' }), NOW)).toBe(false)
    // а «упало» бережём, как бы старо оно ни было
    expect(sliceAlarm(at(30 * 86_400, { links: 1, ended: 'failed', упало: 'x' }), NOW)).toBe(true)
  })

  test('запуск, отметка которого моложе RUN_LOST_SEC, — ещё не «снят»', () => {
    expect(sliceAlarm(at(RUN_LOST_SEC - 1, { links: 2 }), NOW)).toBe(false)
  })
})

describe('срок среза крона', () => {
  test('считается от начала вызова и оставляет хвост под итог и конец запуска', () => {
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

describe('решения задач по итогу звена', () => {
  const slice = (hasMore: boolean, stopped: 'done' | 'budget' | 'blocked' = 'budget') => ({ hasMore, stopped })

  test('карточки: работа у среза — дальше, очередь выбрана — done', () => {
    expect(pagesLinkVerdict({ failed: false, slice: slice(true), signals: null })).toBeNull()
    expect(pagesLinkVerdict({ failed: false, slice: slice(false, 'done'), signals: null })).toBe('done')
  })

  test('карточки выбраны, а у сверки сигналов устаревшие остались — дальше', () => {
    // иначе сверка шла бы пачкой в сутки: круг по пулу в месяц
    expect(
      pagesLinkVerdict({ failed: false, slice: slice(false, 'done'), signals: { stopped: 'budget' } }),
    ).toBeNull()
    expect(
      pagesLinkVerdict({ failed: false, slice: slice(false, 'done'), signals: { stopped: 'done' } }),
    ).toBe('done')
    // Steam отказал сверке — не повод звать следующее звено ради неё
    expect(
      pagesLinkVerdict({ failed: false, slice: slice(false, 'done'), signals: { stopped: 'blocked' } }),
    ).toBe('done')
  })

  test('блок магазина у карточек останавливает запуск, даже если сверке есть что делать', () => {
    expect(
      pagesLinkVerdict({ failed: false, slice: slice(true, 'blocked'), signals: { stopped: 'budget' } }),
    ).toBe('blocked')
  })

  test('упавшее звено карточек и новостей не останавливает запуск', () => {
    expect(pagesLinkVerdict({ failed: true, slice: null, signals: null })).toBeNull()
    expect(newsLinkVerdict({ failed: true, result: null })).toBeNull()
  })

  test('новости: hasMore — дальше, блок — стоп', () => {
    expect(newsLinkVerdict({ failed: false, result: slice(true) })).toBeNull()
    expect(newsLinkVerdict({ failed: false, result: slice(false, 'done') })).toBe('done')
    expect(newsLinkVerdict({ failed: false, result: slice(true, 'blocked') })).toBe('blocked')
  })

  test('пересказы: упавшее звено — стоп, иначе следующее заплатило бы за ту же запись', () => {
    expect(digestLinkVerdict({ failed: true, result: null })).toBe('failed')
  })

  test('пересказы: без модели делать нечего — llm', () => {
    expect(digestLinkVerdict({ failed: false, result: { hasMore: false, stopped: 'capped' } })).toBe('llm')
    expect(digestLinkVerdict({ failed: false, result: { hasMore: false, stopped: 'unavailable' } })).toBe('llm')
    expect(digestLinkVerdict({ failed: false, result: { hasMore: true, stopped: 'budget' } })).toBeNull()
    expect(digestLinkVerdict({ failed: false, result: { hasMore: false, stopped: 'done' } })).toBe('done')
  })
})

describe('sliceHealth: отказ модели внутри среза', () => {
  const NOW = 1_760_000_000
  const mark = (ago: number, extra: Record<string, unknown>) => JSON.stringify({ at: NOW - ago, chain: 0, ...extra })

  test('свежий отказ — нездоров, со статусом', () => {
    expect(sliceHealth(mark(60, { llm: 'down', llmStatus: 401 }), NOW, 3 * 3600)).toEqual({
      ok: false,
      problem: 'модель недоступна',
      ageSec: 60,
      detail: 'HTTP 401',
    })
    expect(sliceHealth(mark(60, { llm: 'down', llmStatus: null }), NOW, 3 * 3600)).toMatchObject({
      detail: 'нет связи',
    })
  })

  test('старый отказ — уже не новость', () => {
    expect(sliceHealth(mark(LLM_DOWN_FRESH_SEC, { llm: 'down', llmStatus: 500 }), NOW, 26 * 3600)).toEqual({
      ok: true,
      ageSec: LLM_DOWN_FRESH_SEC,
    })
  })

  test('«протух», «упало» и «снят» важнее отказа модели', () => {
    expect(sliceHealth(mark(4 * 3600, { llm: 'down' }), NOW, 3 * 3600)).toMatchObject({ problem: 'протух' })
    expect(sliceHealth(mark(60, { llm: 'down', упало: 'x' }), NOW, 3 * 3600)).toMatchObject({ problem: 'упало' })
    expect(sliceHealth(mark(RUN_LOST_SEC, { llm: 'down', links: 2 }), NOW, 3 * 3600)).toMatchObject({
      problem: 'снят',
    })
  })

  test('llm с чужим значением — не отказ', () => {
    expect(sliceHealth(mark(60, { llm: 'ok' }), NOW, 3 * 3600)).toEqual({ ok: true, ageSec: 60 })
  })
})

describe('steamKeyHealth', () => {
  const NOW = 1_760_000_000
  const STALE = 3 * 3600

  test('живая проба — здоров', () => {
    expect(steamKeyHealth(JSON.stringify({ at: NOW - 600, ok: true }), NOW, STALE)).toEqual({ ok: true, ageSec: 600 })
  })

  test('проба с отказом — «ключ Steam» с причиной', () => {
    expect(steamKeyHealth(JSON.stringify({ at: NOW - 600, ok: false, detail: 'HTTP 403' }), NOW, STALE)).toEqual({
      ok: false,
      problem: 'ключ Steam',
      ageSec: 600,
      detail: 'HTTP 403',
    })
  })

  test('мигание Steam — здоров: про ключ оно ничего не говорит', () => {
    expect(
      steamKeyHealth(JSON.stringify({ at: NOW - 600, ok: false, transient: true, detail: 'HTTP 503' }), NOW, STALE),
    ).toEqual({ ok: true, ageSec: 600 })
  })

  test('нет записи, мусор и старая проба', () => {
    expect(steamKeyHealth(null, NOW, STALE)).toEqual({ ok: false, problem: 'нет записи' })
    expect(steamKeyHealth('{не json', NOW, STALE)).toEqual({ ok: false, problem: 'нет записи' })
    expect(steamKeyHealth(JSON.stringify({ at: NOW - STALE, ok: true }), NOW, STALE)).toMatchObject({
      problem: 'протух',
    })
  })

  test('пауза — здоров, но видно', () => {
    expect(steamKeyHealth(null, NOW, STALE, true)).toEqual({ ok: true, paused: true })
  })
})
