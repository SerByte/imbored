import { describe, expect, test } from 'vitest'
import { isJunk, looksLikeJunkName } from './junk'
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
