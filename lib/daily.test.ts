import { describe, expect, test } from 'vitest'
import { pickDaily } from './daily'
import type { ScoredCandidate } from './types'

const CANDS: ScoredCandidate[] = [
  { appid: 1, name: 'A', source: 'backlog', score: 0.9 },
  { appid: 2, name: 'B', source: 'comeback', score: 0.7 },
  { appid: 3, name: 'C', source: 'new', score: 0.5 },
  { appid: 4, name: 'D', source: 'backlog', score: 0.4 },
  { appid: 5, name: 'E', source: 'new', score: 0.2 },
]

describe('pickDaily', () => {
  test('один сид — всегда один и тот же выбор', () => {
    const first = pickDaily(CANDS, 'user1:2026-08-12')
    for (let i = 0; i < 10; i++) {
      expect(pickDaily(CANDS, 'user1:2026-08-12')).toEqual(first)
    }
  })

  test('выбор всегда из списка кандидатов', () => {
    for (let d = 1; d <= 20; d++) {
      const pick = pickDaily(CANDS, `user1:2026-08-${String(d).padStart(2, '0')}`)
      expect(CANDS.some((c) => c.appid === pick?.appid)).toBe(true)
    }
  })

  test('разные дни дают разные игры (не залипает на одной)', () => {
    const picks = new Set<number>()
    for (let d = 1; d <= 28; d++) {
      picks.add(pickDaily(CANDS, `user1:2026-08-${String(d).padStart(2, '0')}`)!.appid)
    }
    expect(picks.size).toBeGreaterThan(1)
  })

  test('разные пользователи в один день — не обязательно одна игра', () => {
    const picks = new Set<number>()
    for (let u = 0; u < 30; u++) {
      picks.add(pickDaily(CANDS, `user${u}:2026-08-12`)!.appid)
    }
    expect(picks.size).toBeGreaterThan(1)
  })

  test('пустые кандидаты — null', () => {
    expect(pickDaily([], 'seed')).toBeNull()
  })
})
