import { describe, expect, test, vi } from 'vitest'
import {
  runWarmup,
  warmupPercent,
  WARMUP_CALL_TIMEOUT_MS,
  WARMUP_MAX_CALLS,
  WARMUP_STALL_LIMIT,
  WARMUP_STALL_PAUSE_MS,
} from './warmup'

/**
 * Цикл прогрева ходит в сеть по несколько минут и до этих тестов существовал
 * в двух разошедшихся копиях: на /daily не было ни проверки ok, ни try/catch,
 * из-за чего экран ошибки там был недостижим — любой сбой оставлял вечный
 * спиннер. Тесты закрепляют ровно те случаи, которые копии не покрывали.
 */

/** Ответ /api/prepare. */
function reply(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Остаток, который честно убывает с каждым вызовом. Для тестов пределов: при
 * неподвижном остатке цикл теперь сдаётся раньше любого из них (см. блок
 * «прогрев без продвижения» ниже), и проверялся бы не тот предел.
 */
function shrinking(from = 999) {
  let left = from
  return vi.fn(async () => reply({ remaining: left-- })) as unknown as typeof fetch
}

/** Последовательность ответов; лишние вызовы — ошибка теста. */
function sequence(...responses: Array<Response | (() => Response | Promise<Response>)>) {
  let i = 0
  return vi.fn(async () => {
    if (i >= responses.length) throw new Error(`лишний вызов /api/prepare (#${i + 1})`)
    const r = responses[i++]
    return typeof r === 'function' ? await r() : r
  }) as unknown as typeof fetch
}

describe('runWarmup', () => {
  test('крутится, пока остаток не обнулится, и сообщает прогресс', async () => {
    const seen: Array<{ remaining: number; total: number }> = []
    const res = await runWarmup({
      fetchFn: sequence(reply({ remaining: 40 }), reply({ remaining: 12 }), reply({ remaining: 0 })),
      // только про остаток: факты о библиотеке проверяются отдельным блоком
      onProgress: (p) => seen.push({ remaining: p.remaining, total: p.total }),
    })

    expect(res).toBe('done')
    // total фиксируется по первому замеру и дальше не меняется
    expect(seen).toEqual([
      { remaining: 40, total: 40 },
      { remaining: 12, total: 40 },
      { remaining: 0, total: 40 },
    ])
  })

  test('401 и 409 — это «иди подключайся», а не ошибка', async () => {
    for (const status of [401, 409]) {
      const res = await runWarmup({ fetchFn: sequence(reply({}, { status })) })
      expect(res, `статус ${status}`).toBe('unauthorized')
    }
  })

  /** Ровно этого не было в копии на /daily: 500 читался как «прогрев закончен». */
  test('500 останавливает прогрев ошибкой, а не молча', async () => {
    const res = await runWarmup({ fetchFn: sequence(reply({}, { status: 500 })) })
    expect(res).toBe('error')
  })

  test('оборванная сеть возвращает error, а не оставляет вечный спиннер', async () => {
    const res = await runWarmup({
      fetchFn: sequence(reply({ remaining: 5 }), () => {
        throw new TypeError('Failed to fetch')
      }),
    })
    expect(res).toBe('error')
  })

  test('нечитаемый ответ — тоже error', async () => {
    const broken = new Response('не json', { status: 200 })
    const res = await runWarmup({ fetchFn: sequence(broken) })
    expect(res).toBe('error')
  })

  test('предел по времени: сдаёмся и отдаём выдачу по неполному каталогу', async () => {
    let t = 0
    const fetchFn = vi.fn(async () => {
      t += 30_000 // каждый вызов «занимает» полминуты
      return reply({ remaining: 999 })
    }) as unknown as typeof fetch

    const res = await runWarmup({ fetchFn, nowMs: () => t, maxMs: 60_000 })

    expect(res).toBe('done')
    // 60 000 / 30 000 = после второго вызова предел достигнут
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2)
  })

  test('предел по числу вызовов тоже есть — и это не ошибка', async () => {
    const fetchFn = shrinking()
    const res = await runWarmup({ fetchFn, maxCalls: 3, maxMs: Number.POSITIVE_INFINITY })

    expect(res).toBe('done')
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(3)
  })

  test('потолок вызовов по умолчанию не изменился', () => {
    expect(WARMUP_MAX_CALLS).toBe(80)
  })
})

describe('warmupPercent', () => {
  test('считает долю разобранного', () => {
    expect(warmupPercent({ remaining: 40, total: 40 })).toBe(0)
    expect(warmupPercent({ remaining: 10, total: 40 })).toBe(75)
    expect(warmupPercent({ remaining: 0, total: 40 })).toBe(100)
  })

  test('до первого замера — ноль, а не деление на ноль', () => {
    expect(warmupPercent(null)).toBe(0)
    expect(warmupPercent({ remaining: 0, total: 0 })).toBe(0)
  })

  test('выход за границы срезается: остаток больше исходного не даёт минуса', () => {
    expect(warmupPercent({ remaining: 50, total: 40 })).toBe(0)
  })
})

/**
 * Факты о библиотеке приезжают из сети, то есть могут быть чем угодно — в том
 * числе ответом старой версии приложения, если человек держал вкладку открытой
 * через деплой. Экран ожидания не имеет права показать «NaN игр».
 */
describe('факты о библиотеке в прогреве', () => {
  test('приходят с первого ответа и держатся до конца цикла', async () => {
    const seen: Array<{ games: number; untouched: number } | null> = []
    await runWarmup({
      fetchFn: sequence(
        reply({ remaining: 40, library: { games: 412, untouched: 178 } }),
        // второй ответ фактов не несёт — уже известные не должны пропасть
        reply({ remaining: 0 }),
      ),
      onProgress: (p) => seen.push(p.library),
    })
    expect(seen).toEqual([
      { games: 412, untouched: 178 },
      { games: 412, untouched: 178 },
    ])
  })

  test('без фактов цикл работает как раньше', async () => {
    const seen: Array<unknown> = []
    const res = await runWarmup({
      fetchFn: sequence(reply({ remaining: 0 })),
      onProgress: (p) => seen.push(p.library),
    })
    expect(res).toBe('done')
    expect(seen).toEqual([null])
  })

  test('мусор вместо чисел отбрасывается целиком', async () => {
    for (const bad of [
      { games: '412', untouched: 178 },
      { games: 412 },
      { games: Number.NaN, untouched: 0 },
      { games: -1, untouched: 0 },
      'библиотека',
      null,
    ]) {
      const seen: Array<unknown> = []
      await runWarmup({
        fetchFn: sequence(reply({ remaining: 0, library: bad })),
        onProgress: (p) => seen.push(p.library),
      })
      expect(seen).toEqual([null])
    }
  })

  test('ноль игр — валидный ответ, а не отсутствие фактов', async () => {
    const seen: Array<unknown> = []
    await runWarmup({
      fetchFn: sequence(reply({ remaining: 0, library: { games: 0, untouched: 0 } })),
      onProgress: (p) => seen.push(p.library),
    })
    expect(seen).toEqual([{ games: 0, untouched: 0 }])
  })
})

/**
 * Расцепка прогрева и выдачи: страница показывает карточки после первого круга,
 * а цикл догревает остальное под ней. Тесты закрепляют то, что легко сломать
 * рефакторингом, — момент сигнала и его единственность.
 */
describe('ранняя отдача выдачи', () => {
  test('сигналит после первого круга и продолжает греть', async () => {
    const seen: number[] = []
    let yields = 0
    const res = await runWarmup({
      fetchFn: sequence(
        reply({ remaining: 300 }),
        reply({ remaining: 120 }),
        reply({ remaining: 0 }),
      ),
      onProgress: (p) => seen.push(p.remaining),
      onYield: () => yields++,
    })

    expect(res).toBe('done')
    expect(yields).toBe(1)
    // цикл НЕ оборвался на сигнале — он дошёл до нуля
    expect(seen).toEqual([300, 120, 0])
  })

  test('всё разобралось за один круг — сигнала нет вовсе', async () => {
    let yields = 0
    const res = await runWarmup({
      fetchFn: sequence(reply({ remaining: 0 })),
      onYield: () => yields++,
    })
    // обещать «догреваю в фоне», когда греть нечего, — врать в интерфейсе
    expect(res).toBe('done')
    expect(yields).toBe(0)
  })

  test('сигнал несёт объём работы на момент отдачи', async () => {
    const at: Array<{ done: number; total: number }> = []
    await runWarmup({
      fetchFn: sequence(reply({ remaining: 300 }), reply({ remaining: 0 })),
      onYield: (p) => at.push({ done: p.total - p.remaining, total: p.total }),
    })
    // на первом круге разобрано ещё ноль из трёхсот — с этим числом страница
    // потом сравнивает вырос ли каталог
    expect(at).toEqual([{ done: 0, total: 300 }])
  })

  test('порог сдвигается, и до него сигнала нет', async () => {
    const marks: number[] = []
    await runWarmup({
      fetchFn: sequence(
        reply({ remaining: 300 }),
        reply({ remaining: 200 }),
        reply({ remaining: 100 }),
        reply({ remaining: 0 }),
      ),
      onYield: (p) => marks.push(p.remaining),
      yieldAfter: 3,
    })
    expect(marks).toEqual([100])
  })

  test('ошибка после сигнала возвращает error — решает страница, а не цикл', async () => {
    let yields = 0
    const res = await runWarmup({
      fetchFn: sequence(reply({ remaining: 300 }), reply({}, { status: 500 })),
      onYield: () => yields++,
    })
    // цикл честно сообщает о сбое; сохранять ли уже показанную выдачу — не его
    // ответственность, и он не должен притворяться, что всё хорошо
    expect(yields).toBe(1)
    expect(res).toBe('error')
  })

  test('предел по числу вызовов сигналит, а не молчит', async () => {
    let yields = 0
    const fetchFn = shrinking()
    const res = await runWarmup({
      fetchFn,
      maxCalls: 2,
      maxMs: Number.POSITIVE_INFINITY,
      onYield: () => yields++,
    })
    expect(res).toBe('done')
    expect(yields).toBe(1)
  })
})

/**
 * Работа стоит на месте.
 *
 * Steam отвечает 429 на GetItems — ensureMeta глотает сбой, и /api/prepare
 * отдаёт тот же остаток. Раньше цикл этого не замечал: три минуты неподвижной
 * цифры на экране и до восьмидесяти пачек в Steam ровно пока нас ограничивают.
 */
describe('прогрев без продвижения', () => {
  /** Паузы записываются, а не выжидаются: тест не должен спать по-настоящему. */
  function pauses() {
    const seen: number[] = []
    return { seen, sleep: async (ms: number) => void seen.push(ms) }
  }

  test('остаток не убывает — не больше трёх вызовов, с паузой между ними', async () => {
    const p = pauses()
    const fetchFn = sequence(
      reply({ remaining: 300 }),
      reply({ remaining: 300 }),
      reply({ remaining: 300 }),
    )
    const res = await runWarmup({ fetchFn, sleep: p.sleep })
    // 'done', а не 'error': выдача по неполному каталогу лучше экрана ошибки
    expect(res).toBe('done')
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(3)
    expect(p.seen).toEqual([WARMUP_STALL_PAUSE_MS])
    expect(WARMUP_STALL_LIMIT).toBe(2)
  })

  test('остаток растёт — это тоже не продвижение', async () => {
    const p = pauses()
    const res = await runWarmup({
      fetchFn: sequence(reply({ remaining: 300 }), reply({ remaining: 310 }), reply({ remaining: 320 })),
      sleep: p.sleep,
    })
    expect(res).toBe('done')
    expect(p.seen).toHaveLength(1)
  })

  test('продвижение сбрасывает счёт: одна заминка — не повод сдаваться', async () => {
    const p = pauses()
    const seen: number[] = []
    const res = await runWarmup({
      fetchFn: sequence(
        reply({ remaining: 300 }),
        reply({ remaining: 300 }),
        reply({ remaining: 200 }),
        reply({ remaining: 200 }),
        reply({ remaining: 100 }),
        reply({ remaining: 0 }),
      ),
      onProgress: (x) => seen.push(x.remaining),
      sleep: p.sleep,
    })
    expect(res).toBe('done')
    expect(seen).toEqual([300, 300, 200, 200, 100, 0])
    expect(p.seen).toEqual([WARMUP_STALL_PAUSE_MS, WARMUP_STALL_PAUSE_MS])
  })

  test('сервер сказал stalled — выходим сразу, без второго захода в Steam', async () => {
    const p = pauses()
    const seen: number[] = []
    let yields = 0
    const res = await runWarmup({
      fetchFn: sequence(reply({ remaining: 300, stalled: true })),
      onProgress: (x) => seen.push(x.remaining),
      onYield: () => yields++,
      sleep: p.sleep,
    })
    expect(res).toBe('done')
    // человек увидел, до какого места дошло, и /play успел показать выдачу
    expect(seen).toEqual([300])
    expect(yields).toBe(1)
    expect(p.seen).toEqual([])
  })

  test('stalled не мешает закончить, если разбирать уже нечего', async () => {
    const res = await runWarmup({ fetchFn: sequence(reply({ remaining: 0, stalled: true })) })
    expect(res).toBe('done')
  })
})

/**
 * Уход со страницы. Без сигнала цикл переживал уход с /play и ходил в
 * /api/prepare дальше, а новый заход запускал второй параллельно.
 */
describe('прогрев уходит вместе со страницей', () => {
  test('уже ушедшая страница — ни одного вызова', async () => {
    const ac = new AbortController()
    ac.abort()
    const fetchFn = vi.fn() as unknown as typeof fetch
    expect(await runWarmup({ fetchFn, signal: ac.signal })).toBe('aborted')
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0)
  })

  test('уход посреди вызова — aborted, а не error', async () => {
    const ac = new AbortController()
    // Как настоящий fetch: отказывает, когда отменили его сигнал
    const fetchFn = vi.fn(
      (_: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          )
        }),
    ) as unknown as typeof fetch
    const run = runWarmup({ fetchFn, signal: ac.signal })
    ac.abort()
    expect(await run).toBe('aborted')
  })

  test('уход во время паузы не ждёт её конца', async () => {
    const ac = new AbortController()
    let calls = 0
    const fetchFn = vi.fn(async () => {
      calls++
      // второй ответ без продвижения — за ним пауза; страница уходит посреди неё
      if (calls === 2) setTimeout(() => ac.abort(), 20)
      return reply({ remaining: 300 })
    }) as unknown as typeof fetch
    const startedAt = Date.now()
    // пауза настоящая: проверяется именно то, что её прерывает уход
    const res = await runWarmup({ fetchFn, signal: ac.signal })
    expect(res).toBe('aborted')
    expect(calls).toBe(2)
    expect(Date.now() - startedAt).toBeLessThan(WARMUP_STALL_PAUSE_MS / 2)
  })

  test('каждый вызов уходит с сигналом, даже без сигнала страницы', async () => {
    const signals: Array<AbortSignal | null | undefined> = []
    const fetchFn = vi.fn(async (_: unknown, init?: RequestInit) => {
      signals.push(init?.signal)
      return reply({ remaining: 0 })
    }) as unknown as typeof fetch
    await runWarmup({ fetchFn })
    // потолок одного вызова — WARMUP_CALL_TIMEOUT_MS: зависшее соединение
    // больше не держит экран ожидания сколько угодно
    expect(signals[0]).toBeInstanceOf(AbortSignal)
    expect(WARMUP_CALL_TIMEOUT_MS).toBe(30_000)
  })
})
