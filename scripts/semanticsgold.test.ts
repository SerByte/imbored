import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { deriveSemantics, TAGS_MAX_CONFIDENCE } from '../lib/semantics'
import type { GameSemantics } from '../lib/types'
import {
  compareGolden,
  GOLDEN_FIELDS,
  labelsOf,
  parseGolden,
  summarize,
  type GoldenGame,
} from './semanticsgold'

/** Семантика с нужными корзинами — собранная руками, без приора */
function sem(over: {
  axes?: Partial<GameSemantics['axes']>
  session?: Partial<GameSemantics['session']>
  timeToFun?: GameSemantics['timeToFun']
  basis?: GameSemantics['basis']
  confidence?: number
}): GameSemantics {
  const base = deriveSemantics({}, null)
  return {
    ...base,
    axes: { ...base.axes, ...over.axes },
    session: { ...base.session, ...over.session },
    timeToFun: over.timeToFun ?? base.timeToFun,
    basis: over.basis ?? base.basis,
    confidence: over.confidence ?? base.confidence,
  }
}

describe('сверка с ручной разметкой', () => {
  test('сверяются только заполненные поля, согласие — доля совпавших меток', () => {
    const golden: GoldenGame[] = [
      { appid: 1, name: 'Короткая', session: 'short', challenge: 'high' },
      { appid: 2, name: 'Стратегия', session: 'long', timeToFun: 'slow', stopAnytime: true },
      { appid: 3, name: 'Нет в базе', session: 'long' },
    ]
    const got = new Map([
      [1, sem({ session: { bucket: 'short' }, axes: { challenge: 80 } })],
      [2, sem({ session: { bucket: 'medium', canStopAnytime: true }, timeToFun: { bucket: 'slow', hours: null } })],
    ])

    const r = compareGolden(golden, got)

    expect(r.compared).toBe(5)
    expect(r.agreed).toBe(4)
    expect(r.agreement).toBe(0.8)
    expect(r.byField.session).toEqual({ compared: 2, agreed: 1 })
    expect(r.byField.pace).toEqual({ compared: 0, agreed: 0 })
    expect(r.missing.map((g) => g.appid)).toEqual([3])
    expect(r.mismatches).toEqual([
      { appid: 2, name: 'Стратегия', field: 'session', expected: 'long', actual: 'medium' },
    ])
  })

  test('сверять нечего — согласие null, а не 100%', () => {
    const r = compareGolden([{ appid: 1, name: 'Без меток' }], new Map([[1, sem({})]]))
    expect(r.agreement).toBeNull()
  })

  test('«ни быстро, ни медленно» в разметке — это mid, в семантике — null', () => {
    expect(labelsOf(sem({ timeToFun: { bucket: null, hours: null } })).timeToFun).toBe('mid')
  })

  test('опечатка в метке — ошибка с именем игры, а не молча несравнимое поле', () => {
    const json = { games: [{ appid: 1, name: 'Hades', challenge: 'hgh' }] }
    expect(() => parseGolden(json)).toThrow(/Hades.*challenge/)
    expect(() => parseGolden({ games: [{ appid: 1, name: 'А' }, { appid: 1, name: 'Б' }] })).toThrow(/дважды/)
    expect(() => parseGolden({})).toThrow(/games/)
  })
})

describe('сводка по каталогу', () => {
  test('корзины, basis и уверенность считаются по каждой игре', () => {
    const s = summarize([
      sem({ session: { bucket: 'short', canStopAnytime: true }, axes: { pace: 90 }, confidence: 0.1 }),
      sem({ basis: 'tags+reviews', timeToFun: { bucket: 'slow', hours: 3 }, confidence: 0.8 }),
      // потолок одних тегов — ещё «только теги», а не «помогли отзывы»
      sem({ confidence: TAGS_MAX_CONFIDENCE }),
    ])
    expect(s.total).toBe(3)
    expect(s.basis).toEqual({ tags: 2, 'tags+reviews': 1 })
    expect(s.session.short).toBe(1)
    expect(s.stopAnytime).toBe(1)
    expect(s.timeToFun).toEqual({ fast: 0, mid: 2, slow: 1 })
    expect(s.ttfHours).toBe(1)
    expect(s.axes.pace).toEqual({ low: 0, mid: 2, high: 1 })
    expect(s.confidence).toEqual([1, 1, 0, 1])
  })
})

describe('scripts/semantics-golden.json', () => {
  const golden = parseGolden(
    JSON.parse(fs.readFileSync(path.join(__dirname, 'semantics-golden.json'), 'utf8')),
  )

  test('тридцать игр, у каждой хотя бы две метки', () => {
    // Одна метка на игру — это уже не сверка, а лотерея: согласие прыгало бы
    // от одной поправки
    expect(golden).toHaveLength(30)
    for (const g of golden) {
      const labels = GOLDEN_FIELDS.filter((f) => g[f] !== undefined)
      expect(labels.length, g.name).toBeGreaterThanOrEqual(2)
    }
  })

  test('в разметке есть все поля — иначе отчёт не скажет, где приор врёт', () => {
    for (const f of GOLDEN_FIELDS) {
      expect(golden.filter((g) => g[f] !== undefined).length, f).toBeGreaterThanOrEqual(5)
    }
  })
})
