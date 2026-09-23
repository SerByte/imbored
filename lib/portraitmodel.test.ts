import { describe, expect, test } from 'vitest'
import { buildPortraitModel, PURGATORY_MAX } from './portraitmodel'
import type { GameMeta, LibraryGame } from './types'

const NOW = 1_700_000_000

/** Те же четыре ряда, что у страницы: 2 + 4 + 12 + 24 плитки */
const PLAN = [
  { take: 2, step: 2 },
  { take: 4, step: 4 },
  { take: 12, step: 6 },
  { take: 24, step: 8 },
]

function lib(appid: number, hours: number): LibraryGame {
  return { appid, name: `g${appid}`, playtimeForever: hours * 60, playtime2Weeks: 0 }
}

function meta(appid: number, tags: Record<string, number>, priceFinal?: number): GameMeta {
  return {
    appid,
    name: `g${appid}`,
    tags,
    genres: [],
    categories: [2],
    headerImage: `https://cdn.example/${appid}.jpg`,
    art: { header: `https://cdn.example/${appid}/h.jpg` },
    screenshots: [`https://cdn.example/${appid}/1.jpg`],
    ...(priceFinal !== undefined ? { priceFinal } : {}),
  }
}

/**
 * Коллекционер: сотня наигранных игр и сорок тысяч нераспакованных — ровно
 * тот случай, ради которого модель и кэшируется.
 */
function collector(): { games: LibraryGame[]; metas: Map<number, GameMeta> } {
  const games: LibraryGame[] = []
  const metas = new Map<number, GameMeta>()
  for (let i = 1; i <= 100; i++) {
    games.push(lib(i, 500 - i))
    metas.set(i, meta(i, i % 2 ? { Automation: 100, Strategy: 40 } : { Roguelike: 100 }))
  }
  for (let i = 101; i <= 40_100; i++) {
    games.push(lib(i, 0))
    metas.set(i, meta(i, { Automation: 50 }, 999))
  }
  // Запись другого магазина: без арта, в мозаику и на стену не попадает
  games.push(lib(-101, 0))
  return { games, metas }
}

describe('buildPortraitModel', () => {
  test('модель переживает JSON без потерь: кэш Next хранит её строкой', () => {
    const { games, metas } = collector()
    const model = buildPortraitModel(games, (id) => metas.get(id), NOW, PLAN)
    expect(JSON.parse(JSON.stringify(model))).toEqual(model)
  })

  test('у библиотеки в сорок тысяч игр модель остаётся маленькой', () => {
    const { games, metas } = collector()
    const model = buildPortraitModel(games, (id) => metas.get(id), NOW, PLAN)
    // Полного списка нераспакованного в модели нет, только стена
    expect('unplayed' in model.wrapped).toBe(false)
    expect(model.wrapped.unplayedCount).toBe(40_001)
    expect(model.purgatory).toHaveLength(PURGATORY_MAX)
    expect(model.purgatory.every((g) => g.appid > 0)).toBe(true)
    // Запись в кэш Next свыше пары мегабайт не ложится вовсе
    expect(JSON.stringify(model).length).toBeLessThan(64_000)
  })

  test('обложка есть у каждой игры, которую страница рисует', () => {
    const { games, metas } = collector()
    const model = buildPortraitModel(games, (id) => metas.get(id), NOW, PLAN)
    const shown = [
      ...model.wrapped.top,
      ...model.evidence,
      ...model.mosaic.flat(),
      ...model.purgatory,
      ...(model.starter ? [model.starter] : []),
    ]
    expect(shown.length).toBeGreaterThan(0)
    for (const g of shown) {
      expect(model.covers[g.appid], `обложка ${g.appid}`).toEqual({
        headerImage: `https://cdn.example/${g.appid}.jpg`,
        art: { header: `https://cdn.example/${g.appid}/h.jpg` },
      })
    }
    // В модель не попадает ничего сверх показанного
    expect(Object.keys(model.covers).length).toBe(new Set(shown.map((g) => g.appid)).size)
  })

  test('диагноз и улики — по метаданным: заголовок из словаря, улики не повторяют подиум', () => {
    const { games, metas } = collector()
    const model = buildPortraitModel(games, (id) => metas.get(id), NOW, PLAN)
    expect(model.headline?.known).toBe(true)
    const podium = new Set(model.wrapped.top.map((g) => g.appid))
    expect(model.evidence.length).toBeGreaterThan(0)
    expect(model.evidence.some((g) => podium.has(g.appid))).toBe(false)
    expect(model.backlog.pricedCount).toBeGreaterThan(0)
  })

  test('без метаданных — страница-шаблон: числа и мозаика есть, диагноза и денег нет', () => {
    const { games } = collector()
    const model = buildPortraitModel(games, () => undefined, NOW, PLAN)
    expect(model.wrapped.gamesCount).toBe(games.length)
    expect(model.wrapped.top.length).toBeGreaterThan(0)
    expect(model.mosaic.length).toBeGreaterThan(0)
    expect(model.portrait.archetypes).toEqual([])
    expect(model.headline).toBeNull()
    expect(model.evidence).toEqual([])
    expect(model.starter).toBeNull()
    expect(model.backlog.pricedCount).toBe(0)
    // Обложки без ссылок: GameArt построит запасную по appid
    expect(Object.values(model.covers).every((c) => !c.headerImage && !c.art)).toBe(true)
  })
})
