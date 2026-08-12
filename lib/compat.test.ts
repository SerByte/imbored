import { describe, expect, test } from 'vitest'
import { compatibility } from './compat'
import type { GameMeta, LibraryGame } from './types'

function lib(appid: number, hours: number): LibraryGame {
  return { appid, name: `g${appid}`, playtimeForever: hours * 60, playtime2Weeks: 0 }
}

function meta(appid: number, tags: Record<string, number>): GameMeta {
  return { appid, name: `g${appid}`, tags, genres: [], categories: [1] }
}

const METAS = new Map<number, GameMeta>([
  [1, meta(1, { 'Co-op': 100, FPS: 80 })],
  [2, meta(2, { 'Story Rich': 100, RPG: 90 })],
  [3, meta(3, { MOBA: 100 })],
])
const metaOf = (id: number) => METAS.get(id)

describe('compatibility', () => {
  test('одинаковые библиотеки — 100% и общие игры с часами обоих', () => {
    const a = [lib(1, 100), lib(2, 50)]
    const b = [lib(1, 80), lib(2, 50)]
    const out = compatibility(a, b, metaOf)
    expect(out.percent).toBe(100)
    expect(out.commonGames[0]).toEqual({ appid: 1, name: 'g1', hoursA: 100, hoursB: 80 })
    expect(out.commonGames).toHaveLength(2)
  })

  test('непересекающиеся вкусы — 0% и без общих игр', () => {
    const out = compatibility([lib(1, 100)], [lib(2, 100)], metaOf)
    expect(out.percent).toBe(0)
    expect(out.commonGames).toEqual([])
  })

  test('общие теги — пересечение профилей, самые сильные первыми', () => {
    const a = [lib(1, 100), lib(2, 10)]
    const b = [lib(1, 100), lib(2, 200)]
    const out = compatibility(a, b, metaOf)
    expect(out.sharedTags[0]).toBe('Co-op')
    expect(out.sharedTags).toContain('Story Rich')
  })

  test('общие игры сортируются по суммарным часам', () => {
    const a = [lib(1, 10), lib(3, 500)]
    const b = [lib(1, 10), lib(3, 400)]
    const out = compatibility(a, b, metaOf)
    expect(out.commonGames[0].appid).toBe(3)
  })

  test('пустые библиотеки не роняют', () => {
    const out = compatibility([], [], metaOf)
    expect(out.percent).toBe(0)
    expect(out.commonGames).toEqual([])
    expect(out.sharedTags).toEqual([])
  })
})
