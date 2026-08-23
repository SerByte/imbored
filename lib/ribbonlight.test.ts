import { describe, expect, test } from 'vitest'
import {
  RIBBON_REST,
  RIBBON_SCORE,
  resolveStops,
  sampleRibbon,
  type SceneRange,
} from './ribbonlight'

/**
 * Сторож света ленты.
 *
 * Проверяет ровно то, ради чего эта шкала вообще написана: состояние ленты
 * зависит ТОЛЬКО от позиции прокрутки. Прежняя реализация двигала её
 * скрубленными твинами от каждой сцены, и на переходе между сценами лента
 * вспыхивала — твин возвращал своё запомненное начальное значение. Такой
 * дефект глазами ловится один раз из пяти; арифметикой — всегда.
 */

const RANGES: Record<string, SceneRange> = {
  pain: { start: 1000, end: 2000 },
  engine: { start: 3000, end: 5000 },
  compat: { start: 6000, end: 7000 },
  more: { start: 8000, end: 9000 },
  money: { start: 10000, end: 11000 },
}

describe('свет ленты', () => {
  const stops = resolveStops(RIBBON_SCORE, RANGES)

  test('точки идут по возрастанию позиции', () => {
    const ys = stops.map((s) => s.y)
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
  })

  test('в самом верху страницы лента в покое', () => {
    expect(sampleRibbon(0, stops)).toEqual(RIBBON_REST)
    expect(sampleRibbon(-500, stops)).toEqual(RIBBON_REST)
  })

  /** Аргумент сцены боли: лента замирает и седеет. */
  test('к концу сцены боли лента стоит и обесцвечена', () => {
    const at = 1000 + 1000 * 0.62
    const s = sampleRibbon(at, stops)
    expect(s.sat).toBe(0)
    expect(s.speed).toBeLessThan(0.1)
  })

  /** Обложки на обложках не читаются. */
  test('во всех сценах с обложками лента почти невидима', () => {
    for (const scene of ['engine', 'compat', 'more'] as const) {
      const r = RANGES[scene]
      const s = sampleRibbon(r.start + (r.end - r.start) * 0.5, stops)
      expect(s.opacity, scene).toBeLessThanOrEqual(0.16)
    }
  })

  /**
   * ТОТ САМЫЙ ДЕФЕКТ. На переходе от сцены к сцене яркость обязана меняться
   * плавно, а не прыгать обратно к покою.
   */
  test('на стыках сцен яркость не прыгает', () => {
    const boundaries = [3000, 6000, 8000, 10000]
    for (const y of boundaries) {
      const before = sampleRibbon(y - 1, stops)
      const after = sampleRibbon(y + 1, stops)
      expect(Math.abs(after.opacity - before.opacity), `стык на ${y}`).toBeLessThan(0.02)
    }
  })

  test('в финале свет возвращается к покою', () => {
    const s = sampleRibbon(10000 + 1000 * 0.55, stops)
    expect(s.opacity).toBeCloseTo(RIBBON_REST.opacity, 5)
    expect(s.sat).toBeCloseTo(RIBBON_REST.sat, 5)
  })

  test('ниже последней точки состояние удерживается, а не экстраполируется', () => {
    const s = sampleRibbon(99999, stops)
    expect(s.opacity).toBeCloseTo(RIBBON_REST.opacity, 5)
    expect(s.speed).toBeGreaterThan(0)
  })

  /**
   * Страница может быть ещё не разложена: закреплений нет, границ нет. Тогда
   * лента обязана остаться видимой, а не схлопнуться в ноль.
   */
  test('без единой посчитанной сцены лента в покое, а не выключена', () => {
    const bare = resolveStops(RIBBON_SCORE, {})
    expect(bare.length).toBe(1)
    expect(sampleRibbon(4000, bare)).toEqual(RIBBON_REST)
  })

  test('частично посчитанная страница не ломает шкалу', () => {
    const partial = resolveStops(RIBBON_SCORE, { pain: RANGES.pain })
    expect(partial.length).toBe(3)
    expect(sampleRibbon(50000, partial).sat).toBe(0)
  })

  /** Партитура описывает путь по странице; сцены в ней не должны потеряться. */
  test('в партитуре есть все пять закреплённых сцен', () => {
    const scenes = new Set(RIBBON_SCORE.map((s) => s.scene).filter(Boolean))
    expect([...scenes].sort()).toEqual(['compat', 'engine', 'money', 'more', 'pain'])
  })
})
