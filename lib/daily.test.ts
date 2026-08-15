import { describe, expect, test } from 'vitest'
import { pickDaily, pickDailyPool, STORE_DAY_EVERY } from './daily'
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

describe('pickDailyPool', () => {
  const own = [{ appid: 1 }, { appid: 2 }]
  const discovery = [{ appid: 3 }, { appid: 4 }]

  test('один сид — всегда один и тот же пул', () => {
    const first = pickDailyPool(own, discovery, 'user1:2026-08-15')
    for (let i = 0; i < 10; i++) {
      expect(pickDailyPool(own, discovery, 'user1:2026-08-15')).toBe(first)
    }
  })

  test('магазинных дней примерно каждый третий', () => {
    let store = 0
    const days = 90
    for (let d = 0; d < days; d++) {
      const seed = `user1:2026-08-${String(d).padStart(2, '0')}`
      if (pickDailyPool(own, discovery, seed) === discovery) store++
    }
    // Разброс у хеша есть, но доля должна держаться около 1/STORE_DAY_EVERY:
    // «игра дня» не должна превратиться ни в витрину, ни обратно в чистый бэклог
    expect(store).toBeGreaterThan(days / STORE_DAY_EVERY / 2)
    expect(store).toBeLessThan((days / STORE_DAY_EVERY) * 2)
  })

  test('без находок остаётся своё', () => {
    expect(pickDailyPool(own, [], 'seed')).toBe(own)
  })

  test('без своего берём находки — пустой экран хуже неудачной рекомендации', () => {
    expect(pickDailyPool([], discovery, 'seed')).toBe(discovery)
  })
})
