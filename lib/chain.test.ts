import fs from 'node:fs'
import path from 'node:path'
import type { InStatement } from '@libsql/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  chainEndLine,
  kickCron,
  kickFailLine,
  LEASE_SLACK_SEC,
  leaseTtlSec,
  LINK_MS,
  linksToday,
  openRun,
  runChain,
  type ChainOpts,
} from './chain'
import { CRON_JOBS, CRON_MAX_DURATION_SEC, sliceHealth, type LinkStop } from './cron'
import { acquireLease, createDb, getCatalogMeta, releaseLease, setCatalogMeta, STEAM_LEASE, type Db } from './db'
import { takeLlmBudget } from './llmcap'
import { resetRateMemory } from './ratelimit'

const T0 = 1_760_000_000_000
const LAST = CRON_JOBS.pages.lastKey
const PAUSED = CRON_JOBS.pages.pausedKey
const HOLDER = 'pages:test'

type Link = { n: number; hasMore: boolean }

let db: Db

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  resetRateMemory()
  db = await createDb(':memory:')
  // строка о каждом запуске в лог — тесту она не нужна
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const sec = () => Math.floor(Date.now() / 1000)
const mark = async (): Promise<Record<string, unknown>> =>
  JSON.parse((await getCatalogMeta(db, LAST)) ?? 'null') as Record<string, unknown>
/** Свободна ли аренда: чужой holder берёт её, только если наша отдана или истекла */
const leaseFree = async () => {
  const other = `other:${Math.random()}`
  const took = await acquireLease(db, STEAM_LEASE, other, 60, sec())
  if (took) await releaseLease(db, STEAM_LEASE, other)
  return took
}

/** Та же база, но execute бросает `message`, когда throwIf скажет «да» по аргументам запроса */
const failingDb = (message: string, throwIf: (args: unknown[]) => boolean): Db =>
  new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== 'execute') return Reflect.get(target, prop, receiver)
      return async (q: InStatement) => {
        const args = typeof q === 'string' || !Array.isArray(q.args) ? [] : q.args
        if (throwIf(args)) throw new Error(message)
        return target.execute(q)
      }
    },
  })

/** Звено «сделало n и хочет ещё, пока hasMore»; решение — как у новостей */
const verdict = ({ result, failed }: { result: Link | null; failed: boolean }): LinkStop | null =>
  failed ? null : result?.hasMore ? null : 'done'

const run = (over: Partial<ChainOpts<Link>> = {}) =>
  runChain<Link>({
    db,
    job: 'pages',
    lease: { key: STEAM_LEASE, holder: HOLDER },
    startedAt: Date.now(),
    maxDurationSec: CRON_MAX_DURATION_SEC,
    maxLinks: 8,
    link: async () => ({ n: 1, hasMore: true }),
    verdict,
    totals: ['n'],
    ...over,
  })

/** Звено, которое идёт `ms` по часам и отдаёт следующий из `results` */
const scripted = (results: Link[], ms = 1_000) => {
  let i = 0
  return async () => {
    vi.setSystemTime(Date.now() + ms)
    return results[Math.min(i++, results.length - 1)]
  }
}

describe('runChain: почему запуск кончается', () => {
  test('работа кончилась — done; итог, итого и ended в отметке, аренда отдана', async () => {
    await openRun(db, { job: 'pages', lease: { key: STEAM_LEASE, holder: HOLDER }, startedAt: T0, maxDurationSec: 300 })
    const end = await run({
      link: scripted([
        { n: 5, hasMore: true },
        { n: 7, hasMore: true },
        { n: 2, hasMore: false },
      ]),
    })
    expect(end).toMatchObject({ ended: 'done', links: 3, totals: { n: 14 }, упало: null, last: { n: 2 } })
    expect(await mark()).toMatchObject({ links: 3, ended: 'done', n: 2, hasMore: false, итого: { n: 14 } })
    expect(await leaseFree()).toBe(true)
  })

  test('время: следующее звено не начинается, если до срока меньше LINK_MS', async () => {
    const starts: number[] = []
    const deadlines: number[] = []
    const end = await run({
      link: async ({ deadlineAt }) => {
        starts.push(Date.now())
        deadlines.push(deadlineAt)
        vi.setSystemTime(Date.now() + 60_000)
        return { n: 1, hasMore: true }
      },
    })
    // срок 300 − 12 = 288 с; пятое звено начинается на 240-й секунде, когда
    // остаётся ровно 48, шестое на 300-й уже не начинается
    expect(end).toMatchObject({ ended: 'time', links: 5 })
    expect(starts.map((t) => (t - T0) / 1000)).toEqual([0, 60, 120, 180, 240])
    // срок звена — его начало плюс LINK_MS, а не срок всего вызова
    expect(deadlines.map((d, i) => d - starts[i])).toEqual(Array(5).fill(LINK_MS))
  })

  test('потолок звеньев на запуск держит горячую петлю', async () => {
    const end = await run({ maxLinks: 3, link: async () => ({ n: 1, hasMore: true }) })
    expect(end).toMatchObject({ ended: 'links', links: 3 })
  })

  test('суточный потолок: звенья считаются через запуски, отказ их не засчитывает', async () => {
    expect(await run({ dailyCap: 3, maxLinks: 2 })).toMatchObject({ ended: 'links', links: 2 })
    expect(await run({ dailyCap: 3 })).toMatchObject({ ended: 'daily', links: 1 })
    expect(await linksToday(db, 'pages', sec())).toBe(3)
    // новые сутки UTC — новый потолок
    vi.setSystemTime(T0 + 86_400_000)
    expect(await run({ dailyCap: 3 })).toMatchObject({ ended: 'daily', links: 3 })
  })

  test('звену нужна модель, а бюджет суток выбран — не начинаем', async () => {
    vi.stubEnv('LLM_DAILY_CAP', '2')
    const link = vi.fn(async () => {
      // каждое звено тратит один вызов
      await takeLlmBudget(db, sec())
      return { n: 1, hasMore: true }
    })
    expect(await run({ needsLlm: true, link })).toMatchObject({ ended: 'llm', links: 2 })
    expect(await run({ needsLlm: true, link })).toMatchObject({ ended: 'llm', links: 0 })
    expect(link).toHaveBeenCalledTimes(2)
    // карточкам модель не обязательна — их звенья идут и без бюджета
    expect(await run({ maxLinks: 2 })).toMatchObject({ ended: 'links', links: 2 })
  })

  test('аренду отняли — стоп; чужую аренду запуск не трогает', async () => {
    let calls = 0
    const end = await run({
      link: async () => {
        if (++calls === 1) {
          // Наш срок истёк, и аренду взял ручной прогон: так бывает, когда
          // звено вышло за срок, или у оператора часы убежали вперёд
          await setCatalogMeta(db, STEAM_LEASE, JSON.stringify({ holder: 'local:script', until: sec() + 600 }))
        }
        return { n: 1, hasMore: true }
      },
    })
    expect(end).toMatchObject({ ended: 'lease', links: 1 })
    expect(calls).toBe(1)
    expect(await leaseFree()).toBe(false)
    expect(await acquireLease(db, STEAM_LEASE, 'local:script', 600, sec())).toBe(true)
  })

  test('килл-свитч посреди запуска — следующее звено не начинается', async () => {
    const end = await run({
      link: async () => {
        await setCatalogMeta(db, PAUSED, '1')
        return { n: 1, hasMore: true }
      },
    })
    expect(end).toMatchObject({ ended: 'paused', links: 1 })
    expect(await mark()).toMatchObject({ ended: 'paused' })
  })
})

describe('runChain: упавшее звено', () => {
  test('решение за задачей: карточки и новости идут дальше, «упало» живёт до удачного звена', async () => {
    let calls = 0
    const end = await run({
      link: async () => {
        if (++calls === 1) throw new Error('SQLITE_BUSY: database is locked')
        return { n: 3, hasMore: false }
      },
    })
    expect(end).toMatchObject({ ended: 'done', links: 2, упало: null, totals: { n: 3 } })
    expect(await mark()).not.toHaveProperty('упало')
  })

  test('пересказы останавливаются, и health видит «упало» с причиной', async () => {
    const end = await run({
      link: async () => {
        throw new Error('SQLITE_BUSY: database is locked')
      },
      verdict: ({ failed }) => (failed ? 'failed' : null),
    })
    expect(end).toMatchObject({ ended: 'failed', links: 1, last: null })
    const raw = await getCatalogMeta(db, LAST)
    expect(sliceHealth(raw, sec(), 3600)).toMatchObject({
      ok: false,
      problem: 'упало',
      detail: 'SQLITE_BUSY: database is locked',
    })
    // аренду упавший запуск всё равно отдаёт
    expect(await leaseFree()).toBe(true)
  })

  test('сбой базы в проверке перед звеном — failed с причиной, аренда отдана', async () => {
    let checks = 0
    // второе чтение килл-свитча — то есть проверка перед вторым звеном
    const flaky = failingDb('fetch failed', (args) => args[0] === PAUSED && ++checks === 2)
    const end = await runChain<Link>({
      db: flaky,
      job: 'pages',
      lease: { key: STEAM_LEASE, holder: HOLDER },
      startedAt: Date.now(),
      maxDurationSec: CRON_MAX_DURATION_SEC,
      maxLinks: 8,
      link: async () => ({ n: 1, hasMore: true }),
      verdict,
    })
    expect(end).toMatchObject({ ended: 'failed', links: 1, упало: 'fetch failed' })
    expect(await leaseFree()).toBe(true)
  })

  test('отказ записи отметки — диагностики, не работы — цикл не рвёт', async () => {
    const noMarks = failingDb('Turso моргнул', (args) => args[0] === LAST)
    const end = await runChain<Link>({
      db: noMarks,
      job: 'pages',
      lease: { key: STEAM_LEASE, holder: HOLDER },
      startedAt: Date.now(),
      maxDurationSec: CRON_MAX_DURATION_SEC,
      maxLinks: 8,
      link: scripted([
        { n: 1, hasMore: true },
        { n: 1, hasMore: false },
      ]),
      verdict,
    })
    expect(end).toMatchObject({ ended: 'done', links: 2 })
    expect(await leaseFree()).toBe(true)
  })
})

describe('runChain: отметки', () => {
  test('в начале — links: 0, после звена — промежуточная без ended', async () => {
    const seen: Array<Record<string, unknown>> = []
    await run({
      link: async ({ index }) => {
        seen.push(await mark())
        return { n: 10 + index, hasMore: index < 1 }
      },
    })
    expect(seen[0]).toEqual({ at: sec(), links: 0, итого: { n: 0 } })
    expect(seen[1]).toEqual({ at: sec(), links: 1, n: 10, hasMore: true, итого: { n: 10 } })
    // промежуточная отметка — «запуск идёт», а не авария
    expect(sliceHealth(JSON.stringify(seen[1]), sec(), 3600)).toMatchObject({ ok: true })
  })

  test.each([
    ['упало', { links: 8, ended: 'links', упало: 'SQLITE_BUSY: database is locked' }],
    ['снят', { links: 2, enriched: 12 }],
    ['модель недоступна', { links: 1, ended: 'llm', llm: 'down', llmStatus: 402 }],
  ])('стартовая отметка не затирает «%s» прошлого запуска — его перепишет первое звено', async (problem, prev) => {
    // Прошлый запуск был час назад; health позовут через секунды после
    // нынешнего 202 — и он обязан увидеть итог прошлого, а не «запуск идёт»
    const prevRaw = JSON.stringify({ at: sec() - 3600, ...prev })
    await setCatalogMeta(db, LAST, prevRaw)
    let atLinkStart: string | null = null
    await run({
      link: async () => {
        atLinkStart = await getCatalogMeta(db, LAST)
        return { n: 1, hasMore: false }
      },
    })
    expect(atLinkStart).toBe(prevRaw)
    expect(sliceHealth(atLinkStart, sec(), 26 * 3600)).toMatchObject({ ok: false, problem })
    // своё звено запуск записал — уже свежим итогом
    expect(await mark()).toMatchObject({ links: 1, ended: 'done' })
  })

  test('поверх здорового итога — стартовая отметка: health видит «запуск идёт»', async () => {
    await setCatalogMeta(db, LAST, JSON.stringify({ at: sec() - 3600, links: 3, ended: 'time' }))
    let atLinkStart: Record<string, unknown> | null = null
    await run({
      link: async () => {
        atLinkStart = await mark()
        return { n: 1, hasMore: false }
      },
    })
    expect(atLinkStart).toEqual({ at: sec(), links: 0, итого: { n: 0 } })
  })

  test('прошлую отметку не прочли — не затираем, а запуск идёт', async () => {
    const prevRaw = JSON.stringify({ at: sec() - 3600, links: 1, ended: 'failed', упало: 'x' })
    await setCatalogMeta(db, LAST, prevRaw)
    let reads = 0
    // первое чтение LAST — проверка перед стартовой отметкой
    const flaky = failingDb('fetch failed', (args) => args[0] === LAST && ++reads === 1)
    let atLinkStart: string | null = null
    const end = await runChain<Link>({
      db: flaky,
      job: 'pages',
      lease: { key: STEAM_LEASE, holder: HOLDER },
      startedAt: Date.now(),
      maxDurationSec: CRON_MAX_DURATION_SEC,
      maxLinks: 8,
      link: async () => {
        atLinkStart = await getCatalogMeta(db, LAST)
        return { n: 1, hasMore: false }
      },
      verdict,
    })
    expect(atLinkStart).toBe(prevRaw)
    expect(end).toMatchObject({ ended: 'done', links: 1 })
  })

  test('снятый посреди звена запуск оставляет отметку без ended — health скажет «снят»', async () => {
    let calls = 0
    // Звено не возвращается никогда: так выглядит инстанс, снятый по maxDuration
    void run({
      link: () => (++calls === 1 ? Promise.resolve({ n: 4, hasMore: true }) : new Promise<Link>(() => {})),
    })
    await vi.waitFor(() => expect(calls).toBe(2))
    const raw = await getCatalogMeta(db, LAST)
    expect(JSON.parse(raw ?? '{}')).not.toHaveProperty('ended')
    expect(sliceHealth(raw, sec() + 3600, 26 * 3600)).toMatchObject({ ok: false, problem: 'снят', detail: 'звеньев: 1' })
  })
})

describe('runChain: конец запуска', () => {
  test('onEnd — после итоговой отметки и отдачи аренды, с итого и остатком времени', async () => {
    let seen: { free: boolean; ended: unknown; left: number; leftAfterKick: number; n: number } | null = null
    await run({
      link: scripted([{ n: 6, hasMore: false }], 20_000),
      onEnd: async (end) => {
        const left = end.hardLeftMs()
        // пинок соседа ждёт его ответа — остаток после него уже другой
        vi.setSystemTime(Date.now() + 5_000)
        seen = {
          free: await leaseFree(),
          ended: (await mark()).ended,
          left,
          leftAfterKick: end.hardLeftMs(),
          n: end.totals.n,
        }
      },
    })
    expect(seen).toEqual({ free: true, ended: 'done', left: 280_000, leftAfterKick: 275_000, n: 6 })
  })

  test('исключение в onEnd не выходит наружу: сделанного оно не отменяет', async () => {
    await expect(
      run({
        link: async () => ({ n: 1, hasMore: false }),
        onEnd: async () => {
          throw new Error('IndexNow лёг')
        },
      }),
    ).resolves.toMatchObject({ ended: 'done' })
  })

  test('строка о запуске в лог — одна строка JSON с меткой события', async () => {
    const log = vi.mocked(console.log)
    await run({ link: async () => ({ n: 1, hasMore: false }) })
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('cron-run'))
    expect(JSON.parse(line ?? '{}')).toMatchObject({ event: 'cron-run', cron: 'pages', links: 1, ended: 'done' })
  })

  test('аренду отняли — строка в stderr: рядом работал второй поток', async () => {
    const err = vi.mocked(console.error)
    await run({
      link: async () => {
        await setCatalogMeta(db, STEAM_LEASE, JSON.stringify({ holder: 'x', until: sec() + 600 }))
        return { n: 1, hasMore: true }
      },
    })
    expect(err.mock.calls.some((c) => String(c[0]).includes('"ended":"lease"'))).toBe(true)
  })
})

describe('openRun: можно ли начинать', () => {
  const open = (over: { holder?: string; dailyCap?: number } = {}) =>
    openRun(db, {
      job: 'pages',
      lease: { key: STEAM_LEASE, holder: over.holder ?? HOLDER },
      startedAt: T0,
      maxDurationSec: CRON_MAX_DURATION_SEC,
      ...(over.dailyCap !== undefined ? { dailyCap: over.dailyCap } : {}),
    })

  test('аренда берётся до конца вызова плюс запас — не «сейчас плюс TTL»', async () => {
    expect(await open()).toBeNull()
    const lease = JSON.parse((await getCatalogMeta(db, STEAM_LEASE)) ?? '{}') as { holder: string; until: number }
    expect(lease).toEqual({ holder: HOLDER, until: T0 / 1000 + CRON_MAX_DURATION_SEC + LEASE_SLACK_SEC })
  })

  test('аренда занята — locked', async () => {
    expect(await open({ holder: 'news:1' })).toBeNull()
    expect(await open({ holder: 'pages:2' })).toBe('locked')
  })

  test('килл-свитч и суточный потолок — отказ ДО аренды', async () => {
    await setCatalogMeta(db, PAUSED, '1')
    expect(await open()).toBe('paused')
    expect(await leaseFree()).toBe(true)

    await setCatalogMeta(db, PAUSED, '0')
    await run({ dailyCap: 2 })
    expect(await open({ dailyCap: 2 })).toBe('daily')
    expect(await leaseFree()).toBe(true)
  })
})

describe('leaseTtlSec', () => {
  test('продление держит тот же срок, а не отодвигает его', () => {
    const startedAt = 1_000_000
    expect(leaseTtlSec(startedAt, 300, 1000)).toBe(300 + LEASE_SLACK_SEC)
    expect(leaseTtlSec(startedAt, 300, 1240)).toBe(60 + LEASE_SLACK_SEC)
    // за сроком — не ноль и не минус: acquireLease с TTL 0 не взял бы ничего
    expect(leaseTtlSec(startedAt, 300, 5000)).toBe(1)
  })
})

const ОТВЕТ = (status: number) => ({ ok: status >= 200 && status < 300, status }) as Response

describe('пинок соседнего крона', () => {
  test('принятый пинок не повторяется', async () => {
    let звонков = 0
    const итог = await kickCron('http://x/api/cron/pages', 's', {
      delayMs: 0,
      fetchFn: async () => {
        звонков++
        return ОТВЕТ(202)
      },
    })
    expect(итог).toEqual({ ok: true })
    expect(звонков).toBe(1)
  })

  test('не-2xx не невидим, и на ответе повторяем один раз', async () => {
    // Ровно это и глотал прежний .catch(() => {}): 401 или 508 выглядели
    // так же, как успех
    let звонков = 0
    const итог = await kickCron('http://x/api/cron/pages', 's', {
      delayMs: 0,
      fetchFn: async () => {
        звонков++
        return ОТВЕТ(508)
      },
    })
    expect(итог).toEqual({ ok: false, reason: 'HTTP 508' })
    expect(звонков).toBe(2)
  })

  test('моргнувший ответ лечится повтором', async () => {
    let звонков = 0
    const итог = await kickCron('http://x/api/cron/pages', 's', {
      delayMs: 0,
      fetchFn: async () => ОТВЕТ(++звонков === 1 ? 503 : 202),
    })
    expect(итог).toEqual({ ok: true })
  })

  test('отказ сети не повторяется: запрос мог дойти', async () => {
    let звонков = 0
    const итог = await kickCron('http://x/api/cron/pages', 's', {
      delayMs: 0,
      fetchFn: async () => {
        звонков++
        throw new Error('ECONNRESET')
      },
    })
    expect(звонков).toBe(1)
    expect(итог).toEqual({ ok: false, reason: 'ECONNRESET' })
  })

  test('исключение наружу не выходит ни при каком раскладе', async () => {
    await expect(
      kickCron('http://x', 's', { delayMs: 0, fetchFn: async () => { throw 'строка, не Error' } }),
    ).resolves.toMatchObject({ ok: false })
  })
})

describe('строки для логов', () => {
  test('одна строка JSON с меткой события — по ней ищут в Runtime Logs', () => {
    const run = chainEndLine({ cron: 'pages', links: 5, ended: 'time', ms: 281_000, упало: 'a\nb' })
    expect(run).not.toContain('\n')
    expect(JSON.parse(run)).toEqual({ event: 'cron-run', cron: 'pages', links: 5, ended: 'time', ms: 281_000, упало: 'a\nb' })
    expect(JSON.parse(kickFailLine({ cron: 'digest', reason: 'HTTP 503' }))).toEqual({
      event: 'cron-kick-fail',
      cron: 'digest',
      reason: 'HTTP 503',
    })
  })
})

/**
 * Сторож роутов кронов — по тексту: тесты роутов гоняют их на пустой базе с
 * подменённым fetch, а расходится здесь молча. Самовызов вернёт 508 только на
 * проде, а maxDuration меньше CRON_MAX_DURATION_SEC — это снятые запуски,
 * которые health начнёт звать «снят» не вовремя.
 */
describe('роуты кронов', () => {
  const ROOT = path.join(__dirname, '..')
  const CRON_DIR = path.join(ROOT, 'app', 'api', 'cron')
  const jobs = fs
    .readdirSync(CRON_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'health')
    .map((e) => e.name)
  const src = (job: string) => fs.readFileSync(path.join(CRON_DIR, job, 'route.ts'), 'utf8')

  test('сторож видит все три крона', () => {
    expect(jobs.sort()).toEqual(Object.keys(CRON_JOBS).sort())
  })

  test.each(['digest', 'news', 'pages'])('%s: maxDuration — литерал, равный CRON_MAX_DURATION_SEC', (job) => {
    const m = src(job).match(/^export const maxDuration = (\d+)$/m)
    expect(m, 'Next читает конфиг сегмента статически: только литерал').not.toBeNull()
    expect(Number(m?.[1])).toBe(CRON_MAX_DURATION_SEC)
  })

  test.each(['digest', 'news', 'pages'])('%s: звенья идут через runChain, а не HTTP-запросом себе', (job) => {
    const code = src(job)
    expect(code).toContain('runChain')
    expect(code).toContain('openRun')
    // Самовызов со второго шага Vercel режет 508 — ровно то, от чего всё это
    // В адресе, а не в тексте комментария: там на соседей ссылаются словами
    expect(code, 'роут зовёт сам себя').not.toMatch(new RegExp(`[\`'"}]/api/cron/${job}\\b`))
    expect(code).not.toMatch(/[?&]chain=/)
    expect(code).not.toContain('passChain')
  })

  test('пинает соседей только конец запуска новостей: у пнутого роута шаг последний', () => {
    for (const job of jobs) {
      if (job === 'news') expect(src(job)).toContain('kickCron(')
      else expect(src(job), `${job} зовёт соседей по HTTP`).not.toMatch(/kickCron\(|appBaseUrl\(\)\}\/api/)
    }
  })
})
