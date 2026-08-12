import { describe, expect, test } from 'vitest'
import { backlogValue } from './stats'
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
