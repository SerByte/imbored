import { describe, expect, test } from 'vitest'
import { assignEdges, EDGE_BADGE, EDGE_LINE, PICK_EDGES, type EdgeItem } from './badges'
import type { ScoreParts } from './types'

function parts(p: Partial<ScoreParts> = {}): ScoreParts {
  return { taste: 0.5, mood: 1, source: 1, deal: 1, lean: 1, cooldown: 1, ...p }
}

function item(appid: number, p: Partial<ScoreParts> = {}, extra: Partial<EdgeItem> = {}): EdgeItem {
  return { appid, parts: parts(p), ...extra }
}

describe('подписи преимуществ', () => {
  test('у каждого преимущества есть бейдж и фраза, и они не повторяются', () => {
    for (const e of PICK_EDGES) {
      expect(EDGE_BADGE[e].trim().length).toBeGreaterThan(0)
      expect(EDGE_LINE[e].trim().length).toBeGreaterThan(0)
    }
    expect(new Set(PICK_EDGES.map((e) => EDGE_BADGE[e])).size).toBe(PICK_EDGES.length)
  })
})

describe('assignEdges', () => {
  test('меньше трёх карточек — сравнивать не с чем', () => {
    const two = [item(1, { taste: 0.9, mood: 1.4 }), item(2, { taste: 0.1 })]
    expect(assignEdges(two).size).toBe(0)
  })

  test('вкус достаётся лидеру, когда он обгоняет вторую на пять процентов', () => {
    const edges = assignEdges([item(1, { taste: 0.5 }), item(2, { taste: 0.8 }), item(3, { taste: 0.7 })])
    expect(edges.get(2)).toBe('taste')
  })

  test('вкус по сотой доле — жребий, а не преимущество', () => {
    const edges = assignEdges([item(1, { taste: 0.8 }), item(2, { taste: 0.79 }), item(3, { taste: 0.2 })])
    expect([...edges.values()]).not.toContain('taste')
  })

  test('без профиля вкуса бейджа вкуса нет: там не вкус, а популярность', () => {
    const edges = assignEdges(
      [item(1, { taste: 0.9 }), item(2, { taste: 0.2 }), item(3, { taste: 0.1 })],
      { taste: false },
    )
    expect([...edges.values()]).not.toContain('taste')
  })

  test('настроение — лучшая из оставшихся и только если лучше нейтрального', () => {
    const edges = assignEdges([
      item(1, { taste: 0.9, mood: 1 }),
      item(2, { taste: 0.3, mood: 1.25 }),
      item(3, { taste: 0.3, mood: 1.4 }),
    ])
    expect(edges.get(1)).toBe('taste')
    expect(edges.get(3)).toBe('mood')
    expect(edges.has(2)).toBe(false)
  })

  test('нейтральное настроение не преимущество', () => {
    const edges = assignEdges([item(1, { mood: 1 }), item(2, { mood: 0.9 }), item(3, { mood: 0.75 })])
    expect([...edges.values()]).not.toContain('mood')
  })

  test('делёж первого места по настроению бейджа не даёт', () => {
    const edges = assignEdges([
      item(1, { taste: 0.9, mood: 1 }),
      item(2, { taste: 0.3, mood: 1.4 }),
      item(3, { taste: 0.3, mood: 1.4 }),
    ])
    expect([...edges.values()]).not.toContain('mood')
  })

  /**
   * Превосходная степень обязана быть правдой на всём экране: если карточка
   * с бейджем вкуса ещё и лучше всех под настроение, «лучше всего под
   * настроение» у второй по настроению было бы ложью.
   */
  test('никто на экране не обгоняет обладательницу бейджа настроения', () => {
    const beaten = assignEdges([
      item(1, { taste: 0.9, mood: 1.4 }),
      item(2, { taste: 0.3, mood: 1.25 }),
      item(3, { taste: 0.3, mood: 1 }),
    ])
    expect(beaten.get(1)).toBe('taste')
    expect([...beaten.values()]).not.toContain('mood')

    const shared = assignEdges([
      item(1, { taste: 0.9, mood: 1.4 }),
      item(2, { taste: 0.3, mood: 1.4 }),
      item(3, { taste: 0.3, mood: 1 }),
    ])
    expect(shared.get(2)).toBe('mood')
  })

  test('недооценённая: мало отзывов, почти все хвалят, меньше всех — побеждает', () => {
    const edges = assignEdges([
      item(1, {}, { reviewsTotal: 1500, reviewsPercent: 95 }),
      item(2, {}, { reviewsTotal: 400, reviewsPercent: 92 }),
      item(3, {}, { reviewsTotal: 50_000, reviewsPercent: 98 }),
    ])
    expect(edges.get(2)).toBe('underrated')
    expect(edges.size).toBe(1)
  })

  test('недооценённая не бывает у хвоста, у известной и у спорной', () => {
    const edges = assignEdges([
      item(1, {}, { reviewsTotal: 29, reviewsPercent: 100 }),
      item(2, {}, { reviewsTotal: 2001, reviewsPercent: 97 }),
      item(3, {}, { reviewsTotal: 300, reviewsPercent: 89 }),
      item(4, {}, {}),
    ])
    expect(edges.size).toBe(0)
  })

  test('у карточки одно преимущество, и каждое — у одной карточки', () => {
    const list = [
      item(1, { taste: 0.9, mood: 1.4 }, { reviewsTotal: 100, reviewsPercent: 97 }),
      item(2, { taste: 0.4, mood: 1.4 }, { reviewsTotal: 200, reviewsPercent: 96 }),
      item(3, { taste: 0.3, mood: 1.1 }, { reviewsTotal: 300, reviewsPercent: 95 }),
      item(4, { taste: 0.2, mood: 1 }),
    ]
    const edges = assignEdges(list)
    expect(edges.get(1)).toBe('taste')
    expect(edges.get(2)).toBe('mood')
    // Самая малоизвестная уже занята вкусом — недооценённой становится следующая
    expect(edges.get(3)).toBe('underrated')
    expect(new Set(edges.values()).size).toBe(edges.size)
  })

  test('карточка без частей скора сравнивается только по отзывам', () => {
    const edges = assignEdges([
      { appid: 1, reviewsTotal: 120, reviewsPercent: 94 },
      { appid: 2 },
      { appid: 3 },
    ])
    expect(edges.get(1)).toBe('underrated')
    expect(edges.size).toBe(1)
  })
})
