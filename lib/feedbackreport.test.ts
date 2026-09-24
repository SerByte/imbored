import { describe, expect, test } from 'vitest'
import {
  MIN_RATED,
  NO_VALUE,
  formatOutcomes,
  formatRates,
  hitRates,
  outcomeStats,
  type OutcomeReportRow,
  type ReportRow,
} from './feedbackreport'

const row = (over: Partial<ReportRow>): ReportRow => ({
  steamid: 'u1',
  appid: 1,
  action: 'liked',
  reason: null,
  ctx: { slot: 'hero' },
  ...over,
})

describe('hitRates', () => {
  test('доля — «зашло» против «не то» внутри значения оси', () => {
    const lines = hitRates(
      [
        row({ appid: 1 }),
        row({ appid: 2, action: 'skipped' }),
        row({ appid: 3, action: 'skipped', reason: 'genre' }),
        row({ appid: 4, ctx: { slot: 'picked' } }),
      ],
      'slot',
    )
    expect(lines).toEqual([
      { key: 'hero', liked: 1, skipped: 2, launched: 0, rate: 1 / 3 },
      { key: 'picked', liked: 1, skipped: 0, launched: 0, rate: 1 },
    ])
  })

  test('«зашло» считается по играм человека, а не по нажатиям', () => {
    const lines = hitRates(
      [row({ appid: 1 }), row({ appid: 1 }), row({ appid: 1, steamid: 'u2' })],
      'slot',
    )
    expect(lines[0]).toMatchObject({ liked: 2 })
  })

  test('бросок рулетки и свайп колоды — не промах подбора', () => {
    const lines = hitRates(
      [
        row({ action: 'skipped', reason: 'spin' }),
        row({ action: 'skipped', reason: 'explore' }),
        row({ appid: 2, action: 'skipped', reason: 'notnow' }),
      ],
      'slot',
    )
    expect(lines[0]).toMatchObject({ liked: 0, skipped: 1, rate: 0 })
  })

  test('запуски отдельно и в долю не входят; открытия и баны не считаются вовсе', () => {
    const lines = hitRates(
      [
        row({ action: 'launched' }),
        row({ action: 'launched', appid: 2 }),
        row({ action: 'opened' }),
        row({ action: 'banned' }),
      ],
      'slot',
    )
    expect(lines).toEqual([{ key: 'hero', liked: 0, skipped: 0, launched: 2, rate: null }])
  })

  test('нет значения оси или снимка — своя строка «—», а не потеря', () => {
    const lines = hitRates([row({ ctx: null }), row({ appid: 2, ctx: { engine: 'claude' } })], 'nudge')
    expect(lines).toEqual([{ key: NO_VALUE, liked: 2, skipped: 0, launched: 0, rate: 1 }])
  })

  test('сверху — где оценок больше', () => {
    const lines = hitRates(
      [
        row({ ctx: { engine: 'claude' } }),
        row({ appid: 2, ctx: { engine: 'heuristic' } }),
        row({ appid: 3, action: 'skipped', ctx: { engine: 'heuristic' } }),
      ],
      'engine',
    )
    expect(lines.map((l) => l.key)).toEqual(['heuristic', 'claude'])
  })
})

describe('formatRates', () => {
  test('жидкая выборка помечена, пустая ось — словом', () => {
    const text = formatRates('slot', hitRates([row({})], 'slot'))
    expect(text[0]).toBe('slot:')
    expect(text[1]).toContain('100%')
    expect(text[1]).toContain('(мало данных)')
    expect(formatRates('nudge', [])).toEqual(['nudge:', '  (пусто)'])
  })

  test('с достаточной выборкой — без пометки', () => {
    const rows = Array.from({ length: MIN_RATED }, (_, i) => row({ appid: i + 1 }))
    const [, line] = formatRates('slot', hitRates(rows, 'slot'))
    expect(line).not.toContain('мало данных')
    expect(line).toContain(`${MIN_RATED} зашло`)
  })
})

describe('outcomeStats', () => {
  const out = (over: Partial<OutcomeReportRow>): OutcomeReportRow => ({
    source: 'untouched',
    ctx: { source: 'play', slot: 'hero' },
    minutesBefore: 30,
    minutesAfter: 30,
    ownedAfter: true,
    checked: true,
    verdict: null,
    ...over,
  })

  test('доля сыгравших — от сверенных, а несверенные только в «всего»', () => {
    const [line] = outcomeStats(
      [
        out({ minutesAfter: 30 + 120 }),
        out({ minutesAfter: 30 + 10 }),
        out({ minutesAfter: 30 + 40 }),
        out({ checked: false, minutesAfter: null }),
      ],
      'candidate',
    )
    expect(line).toEqual({
      key: 'untouched',
      total: 4,
      checked: 3,
      played: 2,
      bought: 0,
      medianMinutes: 40,
      hooked: 0,
      meh: 0,
    })
  })

  test('покупка — игры не было до совета, а после она в библиотеке', () => {
    const [line] = outcomeStats(
      [
        out({ source: 'new', minutesBefore: null, minutesAfter: 0, ownedAfter: true }),
        out({ source: 'new', minutesBefore: null, minutesAfter: null, ownedAfter: false }),
        out({ source: 'new', minutesBefore: null, minutesAfter: 90, ownedAfter: true, verdict: 'hooked' }),
      ],
      'candidate',
    )
    expect(line).toMatchObject({ key: 'new', checked: 3, bought: 2, played: 1, hooked: 1 })
  })

  test('оси снимка: откуда совет и с какого места; нет значения — «—»', () => {
    const lines = outcomeStats(
      [out({}), out({ ctx: { source: 'daily' } }), out({ ctx: null })],
      'source',
    )
    expect(lines.map((l) => [l.key, l.total])).toEqual([
      [NO_VALUE, 1],
      ['daily', 1],
      ['play', 1],
    ])
  })

  test('формат: доля, медиана и пометка о жидкой выборке', () => {
    const [head, line] = formatOutcomes('candidate', outcomeStats([out({ minutesAfter: 230 })], 'candidate'))
    expect(head).toBe('candidate:')
    expect(line).toContain('100% сыграли')
    expect(line).toContain('медиана 3 ч 20 мин')
    expect(line).toContain('(мало данных)')
    expect(formatOutcomes('slot', [])).toEqual(['slot:', '  (пусто)'])
  })
})
