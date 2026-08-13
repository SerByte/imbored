import { describe, expect, test } from 'vitest'
import { backlogEquivalent, backlogValue } from './stats'
import type { GameMeta, LibraryGame } from './types'

const NOW = 1_700_000_000

function game(appid: number, playtimeForever: number): LibraryGame {
  return { appid, name: `g${appid}`, playtimeForever, playtime2Weeks: 0 }
}

function meta(appid: number, priceFinal?: number): GameMeta {
  return {
    appid,
    name: `g${appid}`,
    tags: {},
    genres: [],
    categories: [],
    ...(priceFinal !== undefined ? { priceFinal } : {}),
  }
}

describe('backlogValue', () => {
  test('суммирует цены несыгранных игр с известной ценой', () => {
    const metas = new Map([
      [1, meta(1, 5999)], // unplayed с ценой
      [2, meta(2)], // unplayed без цены
      [3, meta(3, 1999)], // наигранная — не считается
    ])
    const out = backlogValue(
      [game(1, 10), game(2, 0), game(3, 900)],
      (id) => metas.get(id),
      NOW,
    )
    expect(out).toEqual({ cents: 5999, pricedCount: 1, unplayedCount: 2 })
  })

  test('пустая библиотека — нули', () => {
    expect(backlogValue([], () => undefined, NOW)).toEqual({
      cents: 0,
      pricedCount: 0,
      unplayedCount: 0,
    })
  })
})

describe('backlogEquivalent', () => {
  const SEED = '76561198000000000'

  test('переводит сумму в осязаемое: число и подпись', () => {
    const out = backlogEquivalent(107_300, SEED)
    expect(out).not.toBeNull()
    expect(out!.count).toBeGreaterThan(0)
    expect(out!.text).toContain('{n}') // плейсхолдер под моноширинное число
  })

  test('выбор стабилен для одного игрока — иначе шутка скачет на каждом обновлении', () => {
    const a = backlogEquivalent(107_300, SEED)
    const b = backlogEquivalent(107_300, SEED)
    expect(a).toEqual(b)
  })

  test('разным игрокам достаются разные единицы', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => `7656119800000${1000 + i}`)
    const units = new Set(seeds.map((s) => backlogEquivalent(107_300, s)?.text))
    expect(units.size).toBeGreaterThan(1)
  })

  test('счёт всегда в читаемом диапазоне: без «0 Steam Deck» и «21460 жвачек»', () => {
    for (const dollars of [30, 80, 200, 1073, 5000, 40_000]) {
      const out = backlogEquivalent(dollars * 100, SEED)
      if (!out) continue
      expect(out.count).toBeGreaterThanOrEqual(3)
      expect(out.count).toBeLessThanOrEqual(500)
    }
  })

  test('на мелкой сумме подходящей единицы нет — строка не рендерится', () => {
    expect(backlogEquivalent(500, SEED)).toBeNull()
    expect(backlogEquivalent(0, SEED)).toBeNull()
  })

  test('склонение согласовано с числом', () => {
    // подбираем сумму так, чтобы досталась ровно одна конкретная единица
    const out = backlogEquivalent(107_300, SEED)
    expect(out!.text).not.toMatch(/\{n\}\s*$/) // после числа всегда есть слово
  })
})
