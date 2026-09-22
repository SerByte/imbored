import { describe, expect, test } from 'vitest'
import {
  cosine,
  rarityOf,
  rarityScale,
  tagWeightFrom,
  weightedCosine,
  weightedCosineTo,
  weighTags,
} from './tagweight'

/** Пропорции настоящего каталога: Singleplayer у половины игр, Automation — у сотни. */
const TAG_STATS = new Map<string, number>([
  ['Singleplayer', 3025],
  ['Indie', 2800],
  ['Action', 2335],
  ['Colony Sim', 300],
  ['Automation', 100],
])

describe('rarityScale / rarityOf', () => {
  test('знаменатель — максимум карты, мелкая карта непригодна', () => {
    expect(rarityScale(TAG_STATS)).toBe(3025)
    expect(rarityScale(new Map([['Action', 3]]))).toBe(0)
    expect(rarityScale(new Map())).toBe(0)
  })

  test('самый частый и неизвестный теги весят ноль, редкий — больше частого', () => {
    const top = rarityScale(TAG_STATS)
    expect(rarityOf('Singleplayer', TAG_STATS, top)).toBe(0)
    expect(rarityOf('Нет в карте', TAG_STATS, top)).toBe(0)
    expect(rarityOf('Automation', TAG_STATS, top)).toBeGreaterThan(rarityOf('Indie', TAG_STATS, top))
  })
})

describe('tagWeightFrom', () => {
  test('непригодная карта — null, то есть «без веса», а не нули', () => {
    expect(tagWeightFrom(new Map())).toBeNull()
    expect(tagWeightFrom(new Map([['Action', 3]]))).toBeNull()
  })

  test('вес совпадает с rarityOf', () => {
    const w = tagWeightFrom(TAG_STATS)!
    expect(w('Automation')).toBeCloseTo(Math.log(3025 / 100), 10)
    expect(w('Singleplayer')).toBe(0)
  })
})

describe('weighTags', () => {
  test('без веса вектор возвращается как есть', () => {
    const v = { Indie: 1, Automation: 0.5 }
    expect(weighTags(v, null)).toBe(v)
  })

  test('теги с нулевым весом выпадают, остальные умножаются', () => {
    const w = tagWeightFrom(TAG_STATS)!
    const out = weighTags({ Singleplayer: 1, Automation: 0.5 }, w)
    expect(out).not.toHaveProperty('Singleplayer')
    expect(out.Automation).toBeCloseTo(0.5 * w('Automation'), 10)
  })
})

describe('weightedCosine', () => {
  const w = tagWeightFrom(TAG_STATS)

  test('без веса — ровно сырой косинус, до бита', () => {
    const a = { Indie: 3, Automation: 1 }
    const b = { Indie: 1, Action: 0.4 }
    expect(weightedCosine(a, b, null)).toBe(cosine(a, b))
  })

  test('совпадение по редкому тегу перевешивает совпадение по частому', () => {
    // Профиль как у всех: частотный костяк тяжелее всего
    const profile = { Indie: 10, Action: 8, Automation: 2 }
    const factory = { Automation: 1 }
    const brawler = { Indie: 1, Action: 1 }
    // Сырой косинус выбирает частотное…
    expect(cosine(profile, brawler)).toBeGreaterThan(cosine(profile, factory))
    // …взвешенный — характерное
    expect(weightedCosine(profile, factory, w)).toBeGreaterThan(weightedCosine(profile, brawler, w))
  })

  test('сторона, взвешенная в ноль, откатывает к сырому косинусу, а не к нулю', () => {
    const a = { Singleplayer: 1, Indie: 1 }
    const b = { Singleplayer: 1 }
    expect(weightedCosine(a, b, w)).toBe(cosine(a, b))
    expect(weightedCosine(b, a, w)).toBe(cosine(b, a))
  })

  test('weightedCosineTo считает то же, что weightedCosine, но взвешивает сторону один раз', () => {
    const profile = { Indie: 10, Action: 8, Automation: 2, 'Colony Sim': 1 }
    const toProfile = weightedCosineTo(profile, w)
    const games: Array<Record<string, number>> = [
      { Automation: 1 },
      { Indie: 1, 'Colony Sim': 0.5 },
      { Singleplayer: 1 },
      {},
    ]
    for (const game of games) {
      expect(toProfile(game)).toBe(weightedCosine(profile, game, w))
    }
  })

  test('пустые вектора не роняют', () => {
    expect(weightedCosine({}, { Automation: 1 }, w)).toBe(0)
    expect(weightedCosine({}, {}, w)).toBe(0)
  })
})
