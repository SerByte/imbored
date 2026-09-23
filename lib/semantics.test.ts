import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { LANES, mineReviews, parseReviewsRaw, type Lane, type MinedReviews } from './reviewmine'
import {
  deriveSemantics,
  MIN_REVIEWS,
  TAG_PRIOR,
  TAGS_MAX_CONFIDENCE,
  tagPrior,
} from './semantics'

/** Разбор отзывов, собранный руками: доли полос и ничего лишнего */
function mined(n: number, shares: Partial<Record<Lane, number>> = {}, over: Partial<MinedReviews> = {}): MinedReviews {
  const lanes = Object.fromEntries(
    LANES.map((lane) => {
      const share = shares[lane] ?? 0
      return [lane, { count: Math.round(share * n), weighted: share * n, share, sharePos: share, shareNeg: share }]
    }),
  ) as MinedReviews['lanes']
  return {
    n,
    nPos: n,
    nNeg: 0,
    lanes,
    timeToFunHours: null,
    timeToFunMentions: 0,
    playtime: { total: n, medianPosMin: null, medianNegMin: null, negShortShare: null },
    ...over,
  }
}

// Теги в том виде, в каком лежат в tags_json: голоса Steam
const CIV = { Strategy: 1544, 'Turn-Based Strategy': 1115, 'Grand Strategy': 617, '4X': 513, 'City Builder': 499, Historical: 743 }
const HADES = { 'Action Roguelike': 1051, Roguelite: 766, 'Hack and Slash': 747, Indie: 737, Mythology: 729, Difficult: 327 }
const STARDEW = { 'Farming Sim': 858, 'Life Sim': 769, Relaxing: 683, Casual: 365, 'Pixel Graphics': 789, Cute: 300 }
const FANTASY = { Fantasy: 900, Anime: 500, 'Sci-fi': 300 }

describe('tagPrior и deriveSemantics по одним тегам', () => {
  test('большая стратегия — на вечер, медленный старт, много освоения', () => {
    const s = deriveSemantics(CIV, null)
    expect(s.session.bucket).toBe('long')
    expect(s.session.minutes).toBeGreaterThanOrEqual(75)
    expect(s.timeToFun.bucket).toBe('slow')
    expect(s.axes.complexity).toBeGreaterThan(75)
    expect(s.axes.pace).toBeLessThan(35)
    expect(s.session.canStopAnytime).toBe(true)
  })

  test('рогалик — короткие забеги и веселье сразу, но не «бросить посреди»', () => {
    const s = deriveSemantics(HADES, null)
    expect(s.session.bucket).toBe('short')
    expect(s.session.minutes).toBeLessThanOrEqual(25)
    expect(s.timeToFun.bucket).toBe('fast')
    expect(s.axes.challenge).toBeGreaterThan(65)
    expect(s.axes.pace).toBeGreaterThan(65)
    expect(s.session.canStopAnytime).toBe(false)
  })

  test('уютная ферма — низкая сложность и темп', () => {
    const s = deriveSemantics(STARDEW, null)
    expect(s.axes.challenge).toBeLessThan(25)
    expect(s.axes.pace).toBeLessThan(25)
    expect(s.session.canStopAnytime).toBe(true)
  })

  test('без отзывов уверенность не выше 0.4, basis — tags', () => {
    for (const tags of [CIV, HADES, STARDEW, FANTASY, {}]) {
      const s = deriveSemantics(tags, null)
      expect(s.confidence).toBeLessThanOrEqual(TAGS_MAX_CONFIDENCE)
      expect(s.basis).toBe('tags')
      expect(s.n).toBe(0)
      expect(s.v).toBe(1)
    }
    expect(deriveSemantics(CIV, null).confidence).toBe(TAGS_MAX_CONFIDENCE)
  })

  test('теги, о которых таблица молчит, — середина шкалы и нулевая уверенность', () => {
    for (const tags of [FANTASY, {}]) {
      expect(deriveSemantics(tags, null)).toEqual({
        v: 1,
        axes: { challenge: 50, complexity: 50, pace: 50 },
        session: { bucket: 'medium', minutes: 40, canStopAnytime: false },
        timeToFun: { bucket: null, hours: null },
        confidence: 0,
        n: 0,
        basis: 'tags',
      })
    }
  })

  test('мусор в тегах не даёт NaN', () => {
    const tags = { Relaxing: Number.NaN, Difficult: 'много', Roguelite: -5, Cozy: 10 } as unknown as Record<string, number>
    const s = deriveSemantics(tags, null)
    for (const x of [s.axes.challenge, s.axes.complexity, s.axes.pace, s.session.minutes, s.confidence]) {
      expect(Number.isFinite(x)).toBe(true)
    }
    expect(s.axes.challenge).toBeLessThan(50)
  })

  test('вес тега в игре важен: слабый голос сдвигает меньше сильного', () => {
    const strong = tagPrior({ Difficult: 1000, Fantasy: 1000 }).lean.challenge
    const weak = tagPrior({ Difficult: 100, Fantasy: 1000 }).lean.challenge
    expect(strong).toBeGreaterThan(weak)
    expect(weak).toBeGreaterThan(0)
  })

  test('таблица: вклады в −1..1, только известные оси', () => {
    const dims = new Set(['challenge', 'complexity', 'pace', 'session', 'ttf', 'stop'])
    for (const [tag, c] of Object.entries(TAG_PRIOR)) {
      for (const [d, x] of Object.entries(c)) {
        expect(dims.has(d), `${tag}.${d}`).toBe(true)
        expect(Math.abs(x!), `${tag}.${d}`).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('deriveSemantics с отзывами', () => {
  test('теги против тегов с отзывами: «hard» поднимает сложность, basis и уверенность растут', () => {
    const tagsOnly = deriveSemantics(STARDEW, null)
    const withReviews = deriveSemantics(STARDEW, mined(60, { hard: 0.3 }))
    expect(withReviews.basis).toBe('tags+reviews')
    expect(withReviews.n).toBe(60)
    expect(withReviews.axes.challenge).toBeGreaterThan(tagsOnly.axes.challenge + 20)
    expect(withReviews.confidence).toBeGreaterThan(TAGS_MAX_CONFIDENCE)
    expect(withReviews.confidence).toBeLessThanOrEqual(1)
  })

  test('отзывов меньше порога — приор не двигается ни на бит', () => {
    const few = mined(MIN_REVIEWS - 1, { hard: 0.9, shortSession: 0.9, slowStart: 0.9 }, {
      timeToFunHours: 10,
      timeToFunMentions: 5,
    })
    const s = deriveSemantics(CIV, few)
    expect({ ...s, n: 0 }).toEqual(deriveSemantics(CIV, null))
    expect(s.n).toBe(MIN_REVIEWS - 1)
    expect(s.basis).toBe('tags')
  })

  test('молчание отзывов о полосе — не свидетельство: оси остаются приором', () => {
    const silent = deriveSemantics(HADES, mined(200))
    const prior = deriveSemantics(HADES, null)
    expect(silent.axes).toEqual(prior.axes)
    expect(silent.session).toEqual(prior.session)
    expect(silent.timeToFun).toEqual(prior.timeToFun)
    expect(silent.basis).toBe('tags+reviews')
    expect(silent.confidence).toBeGreaterThan(prior.confidence)
  })

  test('монотонность: больше «hard» — не меньше сложности, при любом приоре и любом «relaxing»', () => {
    for (const tags of [STARDEW, FANTASY, HADES]) {
      for (const relaxing of [0, 0.2, 0.6]) {
        let prev = -1
        for (let hard = 0; hard <= 1.0001; hard += 0.05) {
          const c = deriveSemantics(tags, mined(40, { hard, relaxing })).axes.challenge
          expect(c).toBeGreaterThanOrEqual(prev)
          prev = c
        }
      }
    }
  })

  test('монотонность сессии: «ещё один ход» удлиняет, «пара забегов» укорачивает', () => {
    let prevLong = -1
    let prevShort = Infinity
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const longer = deriveSemantics(HADES, mined(40, { longSession: x, shortSession: 0.1 })).session.minutes
      const shorter = deriveSemantics(CIV, mined(40, { shortSession: x, longSession: 0.1 })).session.minutes
      expect(longer).toBeGreaterThanOrEqual(prevLong)
      expect(shorter).toBeLessThanOrEqual(prevShort)
      prevLong = longer
      prevShort = shorter
    }
  })

  test('вес отзывов растёт с их числом: n/(n+20)', () => {
    const shift = (n: number) =>
      deriveSemantics(STARDEW, mined(n, { hard: 0.3 })).axes.challenge - deriveSemantics(STARDEW, null).axes.challenge
    expect(shift(10)).toBeGreaterThan(0)
    expect(shift(100)).toBeGreaterThan(shift(10))
    expect(shift(1000)).toBeGreaterThanOrEqual(shift(100))
  })

  test('крайние доли не выводят оси за 0..100', () => {
    const s = deriveSemantics(STARDEW, mined(10_000, { hard: 1, relaxing: 1, complex: 1, longSession: 1, slowStart: 1 }))
    for (const x of [s.axes.challenge, s.axes.complexity, s.axes.pace]) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(100)
    }
    expect(s.confidence).toBeLessThanOrEqual(1)
  })

  test('время до веселья: число из отзывов — только если назвали хотя бы двое', () => {
    const one = deriveSemantics(HADES, mined(40, {}, { timeToFunHours: 10, timeToFunMentions: 1 }))
    expect(one.timeToFun).toEqual({ bucket: 'fast', hours: null })
    const two = deriveSemantics(HADES, mined(40, {}, { timeToFunHours: 10, timeToFunMentions: 2 }))
    expect(two.timeToFun).toEqual({ bucket: 'slow', hours: 10 })
    const quick = deriveSemantics(CIV, mined(40, {}, { timeToFunHours: 0.5, timeToFunMentions: 3 }))
    expect(quick.timeToFun).toEqual({ bucket: 'fast', hours: 0.5 })
  })

  test('«медленный старт» в отзывах тянет время до веселья в slow', () => {
    expect(deriveSemantics(FANTASY, null).timeToFun.bucket).toBeNull()
    expect(deriveSemantics(FANTASY, mined(100, { slowStart: 0.4 })).timeToFun.bucket).toBe('slow')
  })

  test('детерминизм: тот же вход — тот же выход, порядок ключей тегов не важен', () => {
    const m = mined(50, { hard: 0.2, relaxing: 0.05, longSession: 0.1 })
    const reversed = Object.fromEntries(Object.entries(CIV).reverse())
    expect(deriveSemantics(CIV, m)).toEqual(deriveSemantics(CIV, m))
    expect(deriveSemantics(reversed, m)).toEqual(deriveSemantics(CIV, m))
  })

  test('сквозной путь: ответ appreviews → mineReviews → deriveSemantics', () => {
    const json = JSON.parse(
      fs.readFileSync(path.join(__dirname, '__fixtures__', 'reviews', 'synthetic.json'), 'utf8'),
    )
    const m = mineReviews(parseReviewsRaw(json)!)
    expect(m.n).toBeGreaterThanOrEqual(MIN_REVIEWS)
    const s = deriveSemantics(STARDEW, m)
    expect(s.basis).toBe('tags+reviews')
    // в рукописной выборке половина отзывов про сложность — уютная ферма от этого сложнее
    expect(s.axes.challenge).toBeGreaterThan(deriveSemantics(STARDEW, null).axes.challenge)
    expect(s.timeToFun).toEqual({ bucket: 'slow', hours: 5 })
  })
})

describe('клиентобезопасность', () => {
  test('lib/semantics.ts берёт из других модулей только типы', () => {
    const src = fs.readFileSync(path.join(__dirname, 'semantics.ts'), 'utf8')
    const imports = src.match(/^import[^\n]*$/gm) ?? []
    expect(imports.length).toBeGreaterThan(0)
    for (const line of imports) expect(line, line).toMatch(/^import type /)
  })
})
