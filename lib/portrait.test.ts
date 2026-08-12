import { describe, expect, test } from 'vitest'
import { buildPortrait } from './portrait'
import type { GameMeta, LibraryGame } from './types'

function lib(appid: number, hours: number): LibraryGame {
  return { appid, name: `g${appid}`, playtimeForever: hours * 60, playtime2Weeks: 0 }
}

function meta(appid: number, tags: Record<string, number>): GameMeta {
  return { appid, name: `g${appid}`, tags, genres: [], categories: [2] }
}

const METAS = new Map<number, GameMeta>([
  [1, meta(1, { Automation: 100, Indie: 90 })], // Indie — стоп-тег
  [2, meta(2, { Roguelike: 100 })],
  [3, meta(3, { 'Story Rich': 100 })],
  [4, meta(4, { Zorkovka: 100 })], // неизвестный тег — фолбэк-лейбл
])
const metaOf = (id: number) => METAS.get(id)

describe('buildPortrait', () => {
  test('архетипы: проценты в сумме ~100, известные лейблы по-русски', () => {
    const p = buildPortrait([lib(1, 300), lib(2, 100), lib(3, 50)], metaOf)
    const sum = p.archetypes.reduce((s, a) => s + a.percent, 0)
    expect(sum).toBeGreaterThanOrEqual(98)
    expect(sum).toBeLessThanOrEqual(102)
    expect(p.archetypes[0].label).toBe('строитель фабрик') // Automation доминирует
    expect(p.archetypes[0].percent).toBeGreaterThan(p.archetypes[1].percent)
  })

  test('теги с одинаковой подписью схлопываются в один архетип', () => {
    const metas = new Map<number, GameMeta>([
      [10, meta(10, { FPS: 100, Shooter: 90 })], // оба → «стрелок»
      [11, meta(11, { Roguelike: 50 })],
    ])
    const p = buildPortrait([lib(10, 100), lib(11, 50)], (id) => metas.get(id))
    const labels = p.archetypes.map((a) => a.label)
    expect(labels.filter((l) => l === 'стрелок')).toHaveLength(1)
    expect(new Set(labels).size).toBe(labels.length)
  })

  test('стоп-теги (Indie и т.п.) не становятся архетипами', () => {
    const p = buildPortrait([lib(1, 300)], metaOf)
    expect(p.archetypes.some((a) => a.tag === 'Indie')).toBe(false)
  })

  test('неизвестный тег получает фолбэк-лейбл', () => {
    const p = buildPortrait([lib(4, 100)], metaOf)
    expect(p.archetypes[0].label).toBe('фанат Zorkovka')
  })

  test('факты: игры, часы, бэклог, топ-игра с долей', () => {
    const p = buildPortrait([lib(1, 300), lib(2, 100), lib(3, 0)], metaOf)
    expect(p.facts.gamesCount).toBe(3)
    expect(p.facts.totalHours).toBe(400)
    expect(p.facts.unplayedCount).toBe(1)
    expect(p.facts.topGame).toEqual({ name: 'g1', hours: 300, sharePercent: 75 })
  })

  test('пустая библиотека не роняет', () => {
    const p = buildPortrait([], metaOf)
    expect(p.archetypes).toEqual([])
    expect(p.facts.gamesCount).toBe(0)
    expect(p.facts.topGame).toBeNull()
  })
})
