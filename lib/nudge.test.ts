import { describe, expect, test } from 'vitest'
import { EXCLUDE_MAX, NUDGE_LABEL, NUDGES, parseExclude, parseNudge, planNudge } from './nudge'
import type { Mood } from './types'

describe('parseNudge', () => {
  test('известное — как есть, мусор — «без подталкивания»', () => {
    for (const n of NUDGES) expect(parseNudge(n)).toBe(n)
    for (const raw of ['faster', '', null, undefined, 1, { nudge: 'shorter' }]) {
      expect(parseNudge(raw), JSON.stringify(raw)).toBeNull()
    }
  })

  test('у каждого подталкивания своя подпись, и они не повторяются', () => {
    const labels = NUDGES.map((n) => NUDGE_LABEL[n])
    expect(new Set(labels).size).toBe(NUDGES.length)
  })
})

describe('parseExclude', () => {
  test('только ненулевые целые, без повторов', () => {
    expect(parseExclude([10, '20', 1.5, 0, -30, 10, null, 40])).toEqual([10, -30, 40])
  })

  test('не список — пусто; длинный — обрезан до EXCLUDE_MAX', () => {
    expect(parseExclude('10,20')).toEqual([])
    expect(parseExclude(undefined)).toEqual([])
    const many = Array.from({ length: EXCLUDE_MAX + 20 }, (_, i) => i + 1)
    expect(parseExclude(many)).toEqual(many.slice(0, EXCLUDE_MAX))
  })
})

describe('planNudge', () => {
  const mood: Mood = { time: 'long', vibe: 'engaged', social: 'friends' }

  test('компания остаётся компанией: подталкивание не трогает social', () => {
    for (const n of NUDGES) expect(planNudge(n, mood, 'all').mood.social).toBe('friends')
  })

  test('«Знакомое» уводит в своё, остальные источник не трогают', () => {
    for (const n of NUDGES) {
      expect(planNudge(n, mood, 'all').scope, n).toBe(n === 'familiar' ? 'library' : 'all')
    }
    expect(planNudge('shorter', mood, 'library').scope).toBe('library')
  })
})
