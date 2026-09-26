import { describe, expect, test } from 'vitest'
import {
  DAILY_TZ,
  dailyHeroAppids,
  dayKey,
  dayStartSec,
  hashString,
  parseDailySelection,
  pickDaily,
  pickDailyPool,
  pickOwnAlternate,
  publicPick,
  STORE_DAY_EVERY,
} from './daily'
import { dayLabel } from './freshness'
import { neutralParts } from './recommend'
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

describe('publicPick', () => {
  test('скор и его части на клиент не уходят: в них видно, что человек откладывал', () => {
    const c: ScoredCandidate = {
      appid: 1,
      name: 'A',
      source: 'backlog',
      score: 0.35,
      parts: neutralParts({ taste: 0.7, cooldown: 0.5 }),
    }
    expect(publicPick(c)).toEqual({ appid: 1, name: 'A', source: 'backlog' })
  })
})

/**
 * Сутки «Игры дня» — московские. По UTC игра менялась в 03:00 МСК посреди
 * ночной сессии, а с полуночи до трёх подпись показывала вчерашнее число.
 */
describe('dayKey', () => {
  const at = (iso: string) => Date.parse(iso) / 1000

  test('по умолчанию — Москва', () => {
    expect(DAILY_TZ).toBe('Europe/Moscow')
    // 01:30 по Москве 24-го — уже 24-е, хотя в UTC ещё 23-е
    expect(dayKey(at('2026-09-23T22:30:00Z'))).toBe('2026-09-24')
  })

  test('граница суток — ровно полночь по Москве', () => {
    expect(dayKey(at('2026-09-23T20:59:59Z'))).toBe('2026-09-23')
    expect(dayKey(at('2026-09-23T21:00:00Z'))).toBe('2026-09-24')
  })

  test('через год и с нулями в месяце и дне', () => {
    expect(dayKey(at('2026-12-31T21:00:00Z'))).toBe('2027-01-01')
    expect(dayKey(at('2026-01-04T21:00:00Z'))).toBe('2026-01-05')
  })

  test('в поясе UTC совпадает с прежним ключом', () => {
    for (const iso of ['2026-09-23T22:30:00Z', '2026-01-01T00:00:00Z', '2026-06-30T23:59:59Z']) {
      expect(dayKey(at(iso), 'UTC')).toBe(new Date(iso).toISOString().slice(0, 10))
    }
  })

  test('подпись даты сходится с ключом и после полуночи по Москве', () => {
    expect(dayLabel(dayKey(at('2026-09-23T22:30:00Z')))).toBe('24 сентября')
  })
})

/**
 * «Не сегодня» считается сказанным про сегодня с полуночи по Москве — той же,
 * что у ключа дня: иначе отложенное вчера в 23:50 не вернулось бы героем и
 * завтра утром.
 */
describe('dayStartSec', () => {
  const at = (iso: string) => Date.parse(iso) / 1000

  test('полночь по Москве того же ключа суток', () => {
    // 15:30 МСК 23-го → 00:00 МСК 23-го = 21:00 UTC 22-го
    expect(dayStartSec(at('2026-09-23T12:30:15Z'))).toBe(at('2026-09-22T21:00:00Z'))
    // 01:30 МСК 24-го (в UTC ещё 23-е) → уже 24-е
    expect(dayStartSec(at('2026-09-23T22:30:00Z'))).toBe(at('2026-09-23T21:00:00Z'))
    // ровно в полночь — она сама
    expect(dayStartSec(at('2026-09-23T21:00:00Z'))).toBe(at('2026-09-23T21:00:00Z'))
  })

  test('начало суток и ключ суток согласны', () => {
    for (const iso of ['2026-09-23T12:30:15Z', '2026-12-31T21:30:00Z', '2026-03-01T00:00:01Z']) {
      const start = dayStartSec(at(iso))
      expect(dayKey(start)).toBe(dayKey(at(iso)))
      expect(dayKey(start - 1)).not.toBe(dayKey(at(iso)))
    }
  })
})

describe('pickOwnAlternate', () => {
  const own = CANDS.filter((c) => c.source !== 'new')
  const shop = CANDS.filter((c) => c.source === 'new')
  /** Сиды магазинного и своего дня — перебором, как в тестах pickDailyPool */
  const seeds = Array.from({ length: 60 }, (_, i) => `u:2026-09-${i}`)
  const storeDay = seeds.find((s) => hashString(`${s}:store`) % STORE_DAY_EVERY === 0)!
  const ownDay = seeds.find((s) => hashString(`${s}:store`) % STORE_DAY_EVERY !== 0)!

  test('в магазинный день — своя тем же сидом', () => {
    expect(pickDailyPool(own, shop, storeDay)).toBe(shop)
    expect(pickOwnAlternate(own, shop, storeDay)).toBe(pickDaily(own, storeDay))
  })

  test('в свой день и без своего предлагать нечего', () => {
    expect(pickOwnAlternate(own, shop, ownDay)).toBeNull()
    expect(pickOwnAlternate([], shop, storeDay)).toBeNull()
    expect(pickOwnAlternate(own, [], storeDay)).toBeNull()
  })
})

describe('parseDailySelection', () => {
  const chosen = { appid: 620, name: 'Portal 2', source: 'untouched' }
  const base = {
    pick: chosen,
    shelf: [{ appid: 999, name: 'Новая', source: 'new' }],
    hoursPlayed: null,
    reasonBase: 'Причина.',
    sharedTags: ['Puzzle'],
    hideUrgency: false,
  }
  const alt = {
    pick: { appid: 570, name: 'Dota 2', source: 'comeback' },
    hoursPlayed: 12,
    reasonBase: 'Своя.',
    sharedTags: [],
  }

  test('запись до запасной своей проходит — утренний выбор посреди дня не пересчитывается', () => {
    expect(parseDailySelection(base)).toEqual({ ...base, via: null, alt: null })
  })

  test('запасная своя читается; битая — отбрасывается одна, без выбора дня', () => {
    expect(parseDailySelection({ ...base, alt })?.alt).toEqual({ ...alt, via: null })
    expect(parseDailySelection({ ...base, alt: { ...alt, pick: { appid: 'x' } } })).toEqual({
      ...base,
      via: null,
      alt: null,
    })
  })

  test('ориентир читается; битый или чужой — без фона, запись живёт', () => {
    const via = { appid: 570, name: 'Dota 2', hours: 2400 }
    expect(parseDailySelection({ ...base, via })?.via).toEqual(via)
    expect(parseDailySelection({ ...base, alt: { ...alt, via } })?.alt?.via).toEqual(via)
    for (const bad of [{ appid: -106, name: 'LoL', hours: 1 }, { appid: 570 }, 'Dota 2', 7]) {
      const sel = parseDailySelection({ ...base, via: bad })
      expect(sel, JSON.stringify(bad)).not.toBeNull()
      expect(sel?.via, JSON.stringify(bad)).toBeNull()
    }
  })

  test('битый герой, полка или причина — записи нет, выбор пересчитается', () => {
    for (const raw of [
      null,
      { ...base, pick: { ...chosen, source: 'store' } },
      { ...base, shelf: [{ appid: 1 }] },
      { ...base, reasonBase: 7 },
      { ...base, sharedTags: [1] },
      { ...base, hideUrgency: 'нет' },
    ]) {
      expect(parseDailySelection(raw), JSON.stringify(raw)).toBeNull()
    }
  })

  test('«Не сегодня» сбрасывает запись только про героя дня и запасную свою', () => {
    expect(dailyHeroAppids(null)).toEqual([])
    expect(dailyHeroAppids(parseDailySelection(base))).toEqual([620])
    expect(dailyHeroAppids(parseDailySelection({ ...base, alt }))).toEqual([620, 570])
  })
})
