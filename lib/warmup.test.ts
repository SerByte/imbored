import { describe, expect, test, vi } from 'vitest'
import { runWarmup, warmupPercent, WARMUP_MAX_CALLS } from './warmup'

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
      onProgress: (p) => seen.push({ ...p }),
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
    const fetchFn = vi.fn(async () => reply({ remaining: 999 })) as unknown as typeof fetch
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
