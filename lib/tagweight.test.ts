import { describe, expect, test } from 'vitest'
import {
  cosine,
  cosineOf,
  cosineSide,
  rarityOf,
  rarityScale,
  tagWeightFrom,
  weightedCosine,
  weightedCosineTo,
  weightedSide,
  weighsSomething,
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

  test('не-числа выпадают и с весом, и без: NaN не доходит до длины стороны', () => {
    const w = tagWeightFrom(TAG_STATS)!
    expect(weighTags({ Indie: 1, Automation: Number.NaN }, null)).toEqual({ Indie: 1 })
    expect(weighTags({ 'Colony Sim': 0.5, Automation: Infinity }, w)).toEqual({
      'Colony Sim': 0.5 * w('Colony Sim'),
    })
    expect(Number.isFinite(cosineSide(weighTags({ Indie: 1, X: Number.NaN }, null)).len)).toBe(true)
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

  test('профиль, взвешенный в ноль, откатывает к сырому косинусу — всех кандидатов разом', () => {
    const profile = { Singleplayer: 1 }
    const toProfile = weightedCosineTo(profile, w)
    const games: Array<Record<string, number>> = [
      { Singleplayer: 1, Indie: 1 },
      { Automation: 1 },
      { Singleplayer: 1 },
    ]
    for (const game of games) expect(toProfile(game)).toBe(cosine(profile, game))
  })

  test('кандидат, взвешенный в ноль, получает ноль, а не сырой косинус: шкала у выдачи одна', () => {
    const profile = { Singleplayer: 10, Indie: 8, Automation: 6, 'Colony Sim': 3 }
    const generic = { Singleplayer: 1 }
    const colony = { 'Colony Sim': 1, Action: 1 }
    // Сырой косинус выбирает частотное…
    expect(cosine(profile, generic)).toBeGreaterThan(cosine(profile, colony))
    // …и откат по одному кандидату протаскивал это «частотное» мимо веса
    const toProfile = weightedCosineTo(profile, w)
    expect(toProfile(generic)).toBe(0)
    expect(toProfile(colony)).toBeGreaterThan(0)
    expect(weightedCosine(profile, generic, w)).toBe(0)
  })

  test('weighsSomething: без веса — да, с весом — только при хоть одном весомом теге', () => {
    expect(weighsSomething({ Singleplayer: 1 }, null)).toBe(true)
    expect(weighsSomething({ Singleplayer: 1, 'Нет в карте': 1 }, w)).toBe(false)
    expect(weighsSomething({ Singleplayer: 1, Automation: 0.1 }, w)).toBe(true)
    expect(weighsSomething({}, w)).toBe(false)
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

/**
 * Приготовленная сторона: норма профиля считается один раз, обход идёт по
 * кандидату. Проверка — против прежней формулы, написанной здесь дословно:
 * обе нормы на каждой паре и обход по первому вектору.
 */
describe('cosineOf: приготовленная сторона', () => {
  function oldCosine(a: Record<string, number>, b: Record<string, number>): number {
    let dot = 0
    let normA = 0
    let normB = 0
    for (const v of Object.values(a)) normA += v * v
    for (const v of Object.values(b)) normB += v * v
    if (normA === 0 || normB === 0) return 0
    for (const [k, v] of Object.entries(a)) {
      const bv = b[k]
      if (bv !== undefined) dot += v * bv
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  /** Детерминированный «случайный» вектор: профиль — сотни тегов, игра — десятки */
  function vector(seed: number, size: number): Record<string, number> {
    const out: Record<string, number> = {}
    let x = seed
    for (let i = 0; i < size; i++) {
      x = (x * 1_103_515_245 + 12_345) % 2_147_483_648
      out[`tag${x % 500}`] = (x % 1000) / 37
    }
    return out
  }

  test('тот же косинус, что прежняя формула, на профиле в сотни тегов', () => {
    const profile = vector(7, 420)
    const side = cosineSide(profile)
    for (let seed = 1; seed <= 50; seed++) {
      const game = vector(seed * 31, 20)
      expect(cosineOf(side, cosineSide(game))).toBeCloseTo(oldCosine(profile, game), 12)
      expect(cosine(profile, game)).toBe(cosineOf(side, cosineSide(game)))
    }
  })

  test('взвешенная сторона даёт то же, что weightedCosineTo, — так живут якоря', () => {
    const w = tagWeightFrom(TAG_STATS)
    const anchor = { Automation: 1, 'Colony Sim': 0.5, Indie: 1 }
    const toAnchor = weightedCosineTo(anchor, w)
    const side = weightedSide(anchor, w)
    const games: Array<Record<string, number>> = [
      { Automation: 1 },
      { 'Colony Sim': 1, Singleplayer: 1 },
      { Indie: 1 },
      {},
    ]
    for (const game of games) {
      expect(cosineOf(side, weightedSide(game, w))).toBe(toAnchor(game))
    }
  })

  test('нулевая или пустая сторона — ноль, а не NaN', () => {
    expect(cosineOf(cosineSide({}), cosineSide({ a: 1 }))).toBe(0)
    expect(cosineOf(cosineSide({ a: 1 }), cosineSide({ a: 0 }))).toBe(0)
  })
})
