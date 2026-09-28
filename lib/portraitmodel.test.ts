import { describe, expect, test } from 'vitest'
import { buildPortraitModel, buildYearModel, portraitTag, PURGATORY_MAX } from './portraitmodel'
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

/**
 * Окно года для коллекционера: на отметке сотня игр была на десять часов
 * меньше, пары нетронутых не было вовсе, а две сотни лежали с нулём минут и
 * две из них с тех пор запущены.
 */
function yearWindowOf(games: LibraryGame[]) {
  const base = games
    .filter((g) => g.appid !== 40_100 && g.appid !== 40_099)
    .map((g) => (g.appid > 0 && g.appid <= 100 ? { ...g, playtimeForever: g.playtimeForever - 600 } : g))
  const end = games.map((g) => (g.appid === 101 || g.appid === 102 ? { ...g, playtimeForever: 45 } : g))
  return {
    year: 2023,
    closed: false,
    base: { takenAt: NOW - 90 * 86_400, games: base },
    end: { takenAt: NOW, games: end },
  }
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
    const model = buildPortraitModel(games, (id) => metas.get(id), NOW, PLAN, {
      yearWindow: yearWindowOf(games),
    })
    expect(model.year).not.toBeNull()
    const shown = [
      ...model.wrapped.top,
      ...model.evidence,
      ...model.mosaic.flat(),
      ...model.purgatory,
      ...(model.starter ? [model.starter] : []),
      ...(model.year?.top ?? []),
      ...(model.year?.unpacked.games ?? []),
      ...(model.year?.added.games ?? []),
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

  test('саундтреки не бэклог нигде на странице: три счётчика называют одно число', () => {
    const { games, metas } = collector()
    games.push({ appid: 50_001, name: 'g1 - Soundtrack', playtimeForever: 0, playtime2Weeks: 0 })
    metas.set(50_001, meta(50_001, {}, 999))
    games.push({ appid: 50_002, name: 'g2 Dedicated Server', playtimeForever: 0, playtime2Weeks: 0 })
    const model = buildPortraitModel(games, (id) => metas.get(id), NOW, PLAN)
    expect(model.wrapped.unplayedCount).toBe(40_001)
    expect(model.portrait.facts.unplayedCount).toBe(40_001)
    expect(model.backlog.unplayedCount).toBe(40_001)
    expect(model.purgatory.some((g) => g.appid > 50_000)).toBe(false)
  })

  test('стартовая обходит скрытое владельцем, а счётчики и стена — нет: игра куплена', () => {
    const { games, metas } = collector()
    const open = buildPortraitModel(games, (id) => metas.get(id), NOW, PLAN)
    expect(open.starter).not.toBeNull()
    const hidden = open.starter!.appid
    const model = buildPortraitModel(games, (id) => metas.get(id), NOW, PLAN, {
      banned: new Set([hidden]),
    })
    expect(model.starter).not.toBeNull()
    expect(model.starter!.appid).not.toBe(hidden)
    // Обложка новой стартовой в модели есть: страница рисует её из covers
    expect(model.covers[model.starter!.appid]).toBeDefined()
    expect(model.wrapped.unplayedCount).toBe(open.wrapped.unplayedCount)
    expect(model.backlog).toEqual(open.backlog)
  })

  test('тег кэша один на страницу и на роуты, которые его сбрасывают', () => {
    expect(portraitTag('76561197960287930')).toBe('portrait:76561197960287930')
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

describe('итоги года в модели', () => {
  test('без окна итогов нет, и шаблон без меты тоже без них', () => {
    const { games, metas } = collector()
    expect(buildPortraitModel(games, (id) => metas.get(id), NOW, PLAN).year).toBeNull()
    expect(buildPortraitModel(games, () => undefined, NOW, PLAN).year).toBeNull()
  })

  test('коллекционер с итогами — модель по-прежнему маленькая и переживает JSON', () => {
    const { games, metas } = collector()
    // пять тысяч новых игр одним бандлом
    const bundle = Array.from({ length: 5_000 }, (_, i) => lib(50_000 + i, 0))
    const w = yearWindowOf(games)
    const window = { ...w, end: { ...w.end, games: [...w.end.games, ...bundle] } }
    const model = buildPortraitModel([...games, ...bundle], (id) => metas.get(id), NOW, PLAN, {
      yearWindow: window,
    })
    expect(model.year?.added.count).toBe(5_002)
    expect(model.year?.unpacked.games.map((g) => g.appid)).toEqual([101, 102])
    expect(JSON.stringify(model).length).toBeLessThan(64_000)
    expect(JSON.parse(JSON.stringify(model))).toEqual(model)
  })

  test('модель страницы года: пустые итоги — null, иначе обложки ровно показанного', () => {
    const { games, metas } = collector()
    const same = { takenAt: NOW - 86_400, games }
    const metaOf = (id: number) => metas.get(id)
    const empty = { year: 2023, closed: false, base: same, end: { takenAt: NOW, games } }
    expect(buildYearModel(empty, metaOf)).toBeNull()
    const model = buildYearModel(yearWindowOf(games), metaOf)
    const year = model?.year
    const shown = [...(year?.top ?? []), ...(year?.unpacked.games ?? []), ...(year?.added.games ?? [])]
    const ids = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b)
    expect(ids(Object.keys(model?.covers ?? {}).map(Number))).toEqual(ids(shown.map((g) => g.appid)))
  })
})
