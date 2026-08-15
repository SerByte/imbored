import { describe, expect, test, vi } from 'vitest'
import {
  afterProbe,
  countFresh,
  initialPollState,
  nextDelayMs,
  onVisible,
  PROBE_BACKOFF_MAX_MS,
  PROBE_INTERVAL_MS,
  PROBE_MAX_CALLS,
  PROBE_MAX_MS,
  probeFeedHead,
  shouldProbe,
} from './feedpoll'

const NOW = 1_700_000_000_000

/** Настоящий Response, как в lib/warmup.test.ts — заглушка врала бы про json() */
function reply(body: unknown, init: { status?: number } = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

const okHead = { showPopular: true, now: 1_700_000_000, items: [{ k: '730:a', at: 100 }] }

describe('probeFeedHead', () => {
  test('нормальный ответ разбирается', async () => {
    const fetchFn = vi.fn(async () => reply(okHead)) as unknown as typeof fetch
    const res = await probeFeedHead({ fetchFn })
    expect(res).toEqual({ kind: 'ok', head: okHead })
  })

  test('вкладка передаётся в запрос', async () => {
    const fetchFn = vi.fn(async () => reply(okHead)) as unknown as typeof fetch
    await probeFeedHead({ fetchFn, feed: 'popular' })
    const calls = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(String(calls[0]![0])).toContain('feed=popular')
  })

  test('404 — это конец, а не сбой: старый JS против нового деплоя', async () => {
    const fetchFn = vi.fn(async () => reply({}, { status: 404 })) as unknown as typeof fetch
    expect(await probeFeedHead({ fetchFn })).toEqual({ kind: 'stop' })
  })

  test('500 и оборванная сеть — сбой', async () => {
    const bad = vi.fn(async () => reply({}, { status: 500 })) as unknown as typeof fetch
    expect(await probeFeedHead({ fetchFn: bad })).toEqual({ kind: 'error' })
    const thrown = vi.fn(async () => {
      throw new TypeError('network')
    }) as unknown as typeof fetch
    expect(await probeFeedHead({ fetchFn: thrown })).toEqual({ kind: 'error' })
  })

  test('нечитаемый ответ — сбой, а не «ноль новых»', async () => {
    const fetchFn = vi.fn(async () => reply('не json')) as unknown as typeof fetch
    expect(await probeFeedHead({ fetchFn })).toEqual({ kind: 'error' })
  })

  test('валидный JSON неверной формы до счётчика не доезжает', async () => {
    // иначе плашка рисует «999 новых обновлений» по мусору
    for (const body of [
      { showPopular: true, now: 1, items: 'нет' },
      { showPopular: true, now: 1, items: [1, 2] },
      { showPopular: true, now: 1, items: [{ k: 1, at: 'x' }] },
      { showPopular: 'да', now: 1, items: [] },
      { now: 1, items: [] },
    ]) {
      const fetchFn = vi.fn(async () => reply(body)) as unknown as typeof fetch
      expect(await probeFeedHead({ fetchFn })).toEqual({ kind: 'error' })
    }
  })
})

describe('темп опроса', () => {
  test('без сбоёв — ровный интервал', () => {
    expect(nextDelayMs(initialPollState(NOW))).toBe(PROBE_INTERVAL_MS)
  })

  test('сбои удваивают паузу, но не дальше потолка', () => {
    const s = initialPollState(NOW)
    expect(nextDelayMs({ ...s, failures: 1 })).toBe(PROBE_INTERVAL_MS * 2)
    expect(nextDelayMs({ ...s, failures: 3 })).toBe(PROBE_INTERVAL_MS * 8)
    expect(nextDelayMs({ ...s, failures: 40 })).toBe(PROBE_BACKOFF_MAX_MS)
  })

  test('удачный опрос обнуляет счётчик сбоёв', () => {
    let s = initialPollState(NOW)
    s = afterProbe(s, false, NOW + 1000)
    expect(s.failures).toBe(1)
    s = afterProbe(s, true, NOW + 2000)
    expect(s.failures).toBe(0)
    expect(s.calls).toBe(2)
  })

  test('скрытая вкладка не опрашивается', () => {
    const s = { ...initialPollState(NOW), lastAt: NOW - PROBE_INTERVAL_MS * 10 }
    expect(shouldProbe(s, { visible: false, nowMs: NOW })).toBe(false)
    expect(shouldProbe(s, { visible: true, nowMs: NOW })).toBe(true)
  })

  test('раньше срока не спрашиваем', () => {
    const s = initialPollState(NOW)
    expect(shouldProbe(s, { visible: true, nowMs: NOW + PROBE_INTERVAL_MS - 1 })).toBe(false)
    expect(shouldProbe(s, { visible: true, nowMs: NOW + PROBE_INTERVAL_MS })).toBe(true)
  })

  test('остановленный автомат молчит, сколько ни жди', () => {
    const s = { ...initialPollState(NOW), stopped: true, lastAt: 0 }
    expect(shouldProbe(s, { visible: true, nowMs: NOW + PROBE_MAX_MS })).toBe(false)
  })
})

describe('потолки: время ограничивает сеанс, счётчик ловит разнос', () => {
  test('упёрлись в число вызовов', () => {
    const s = { ...initialPollState(NOW), calls: PROBE_MAX_CALLS - 1 }
    expect(afterProbe(s, true, NOW + 1000).stopped).toBe(true)
  })

  test('упёрлись в непрерывное время чтения', () => {
    const s = initialPollState(NOW)
    expect(afterProbe(s, true, NOW + PROBE_MAX_MS - 1).stopped).toBe(false)
    expect(afterProbe(s, true, NOW + PROBE_MAX_MS).stopped).toBe(true)
  })

  test('возврат во вкладку сбрасывает время, но НЕ счётчик вызовов', () => {
    // асимметрия и есть причина держать оба потолка: сеанс чтения честно
    // начинается заново, а сорванный таймер иначе маскировался бы вечно
    const s = { ...initialPollState(NOW), calls: 400, startedAt: NOW - PROBE_MAX_MS }
    const back = onVisible(s, NOW)
    expect(back.startedAt).toBe(NOW)
    expect(back.calls).toBe(400)
    expect(afterProbe(back, true, NOW + 1000).stopped).toBe(false)
  })
})

describe('countFresh', () => {
  const head = [
    { k: 'a', at: 300 },
    { k: 'b', at: 200 },
    { k: 'c', at: 100 },
  ]

  test('всё знакомо — ноль', () => {
    expect(countFresh(new Set(['a', 'b', 'c']), 100, head)).toBe(0)
  })

  test('новая строка сверху считается', () => {
    expect(countFresh(new Set(['b', 'c']), 100, head)).toBe(1)
  })

  test('у той же игры новый gid — это новое обновление', () => {
    const next = [{ k: '730:новый', at: 400 }, ...head]
    expect(countFresh(new Set(['730:старый', 'a', 'b', 'c']), 100, next)).toBe(1)
  })

  test('всплывший снизу старый патч новым НЕ считается', () => {
    // окно фиксировано: когда запись выпадает (упал ранг, переклассификация в
    // hotfix), снизу подтягивается патч старше хвоста — наверху он не появится
    const next = [...head, { k: 'древний', at: 50 }]
    expect(countFresh(new Set(['a', 'b', 'c']), 100, next)).toBe(0)
  })

  test('запись ровно на хвосте не считается, на секунду свежее — считается', () => {
    expect(countFresh(new Set(), 300, [{ k: 'x', at: 300 }])).toBe(0)
    expect(countFresh(new Set(), 300, [{ k: 'x', at: 301 }])).toBe(1)
  })

  test('счёт никогда не больше длины головы', () => {
    expect(countFresh(new Set(), 0, head)).toBe(head.length)
  })
})
