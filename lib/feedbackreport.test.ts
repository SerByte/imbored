import { describe, expect, test } from 'vitest'
import { MIN_RATED, NO_VALUE, formatRates, hitRates, type ReportRow } from './feedbackreport'

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
