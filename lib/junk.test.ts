import { describe, expect, test } from 'vitest'
import { isJunk, looksLikeJunkName, looksLikeNonGame } from './junk'
import type { GameMeta, LibraryGame } from './types'

function game(appid: number, name: string): LibraryGame {
  return { appid, name, playtimeForever: 0, playtime2Weeks: 0 }
}

function meta(appid: number, partial: Partial<GameMeta> = {}): GameMeta {
  return {
    appid,
    name: `game-${appid}`,
    tags: { Action: 100 },
    genres: [],
    categories: [2],
    ...partial,
  }
}

describe('looksLikeJunkName', () => {
  test('саундтреки, демо, серверы и SDK отсекаются', () => {
    const junk = [
      'DOOM Eternal - Soundtrack',
      'Hades: Original Soundtrack',
      'Team Fortress 2 Dedicated Server',
      'Half-Life 2 Demo',
      'Deep Rock Galactic Playtest',
      'Source SDK',
      'Baldur’s Gate 3 — Digital Deluxe Upgrade',
      'Hollow Knight (Demo)',
      'Final Fantasy XV Benchmark',
      'App 12345',
    ]
    // пара [name, verdict], чтобы упавшее название было видно в диффе
    for (const name of junk) expect([name, looksLikeJunkName(name)]).toEqual([name, true])
  })

  test('настоящие игры со «страшными» словами в названии не отсеиваются', () => {
    const real = [
      'Tools Up!',
      "The Beginner's Guide",
      'Demolition Company',
      'Ghost of Tsushima',
      'Ostriv',
      'Betrayer',
      'Server Tycoon',
      'Democracy 4',
    ]
    for (const name of real) expect([name, looksLikeJunkName(name)]).toEqual([name, false])
  })
})

describe('isJunk', () => {
  test('без метаданных решение принимается по названию, игра не выбрасывается зря', () => {
    expect(isJunk(game(1, 'Celeste'), undefined)).toBe(false)
    expect(isJunk(game(2, 'Celeste - Soundtrack'), undefined)).toBe(true)
  })

  test('прогретая запись без тегов и категорий — это не игра', () => {
    const empty = meta(3, { tags: {}, categories: [] })
    expect(isJunk(game(3, 'Что-то странное'), empty)).toBe(true)
  })

  test('игра с тегами остаётся, даже если категорий нет', () => {
    const noCategories = meta(4, { categories: [] })
    expect(isJunk(game(4, 'Инди без appdetails'), noCategories)).toBe(false)
  })

  test('вердикт офлайн-каталога сильнее эвристик по имени', () => {
    // Каталог наполняется из раздела «Игры» магазина: если запись прошла через
    // него и жива — она игра, чем бы ни выглядело название
    const vetted = meta(5, { signalsAt: 1_700_000_000, alive: true })
    expect(isJunk(game(5, 'Ghostrunner Demo Disc'), vetted)).toBe(false)
  })

  test('помеченная мёртвой или заменённая на полку не идёт', () => {
    const dead = meta(6, { signalsAt: 1_700_000_000, alive: false })
    expect(isJunk(game(6, 'Мёртвый мультиплеер'), dead)).toBe(true)
    const superseded = meta(7, { signalsAt: 1_700_000_000, alive: true, supersededBy: 8 })
    expect(isJunk(game(7, 'Старое издание'), superseded)).toBe(true)
  })
})

describe('looksLikeNonGame — граница для счётчиков бэклога', () => {
  test('саундтрек, сервер и пустая запись — не игры, как и в isJunk', () => {
    expect(looksLikeNonGame(game(1, 'Celeste - Soundtrack'), undefined)).toBe(true)
    expect(looksLikeNonGame(game(2, 'Team Fortress 2 Dedicated Server'), meta(2))).toBe(true)
    expect(looksLikeNonGame(game(3, 'Что-то странное'), meta(3, { tags: {}, categories: [] }))).toBe(
      true,
    )
  })

  test('непрогретая игра и игра с тегами — игры', () => {
    expect(looksLikeNonGame(game(4, 'Celeste'), undefined)).toBe(false)
    expect(looksLikeNonGame(game(5, 'Инди без appdetails'), meta(5, { categories: [] }))).toBe(false)
  })

  test('мёртвая и заменённая игра — всё ещё игра: её купили, и она лежит', () => {
    // В отличие от isJunk: там это совет, который не сработает, а здесь — счёт
    const dead = meta(6, { signalsAt: 1_700_000_000, alive: false })
    expect(looksLikeNonGame(game(6, 'Мёртвый мультиплеер'), dead)).toBe(false)
    expect(isJunk(game(6, 'Мёртвый мультиплеер'), dead)).toBe(true)
    const superseded = meta(7, { signalsAt: 1_700_000_000, alive: true, supersededBy: 8 })
    expect(looksLikeNonGame(game(7, 'Старое издание'), superseded)).toBe(false)
  })

  test('вердикт каталога сильнее имени и здесь', () => {
    const vetted = meta(8, { signalsAt: 1_700_000_000, alive: true })
    expect(looksLikeNonGame(game(8, 'Ghostrunner Demo Disc'), vetted)).toBe(false)
  })

  test('всё, что не игра, — мусор и для isJunk: граница строже только на шаг', () => {
    const cases: Array<[LibraryGame, GameMeta | undefined]> = [
      [game(1, 'Celeste - Soundtrack'), undefined],
      [game(2, 'Source SDK'), meta(2)],
      [game(3, 'Пустая'), meta(3, { tags: {}, categories: [] })],
      [game(4, 'Celeste'), undefined],
      [game(5, 'Hades'), meta(5)],
    ]
    for (const [g, m] of cases) {
      if (looksLikeNonGame(g, m)) expect([g.name, isJunk(g, m)]).toEqual([g.name, true])
    }
  })
})
