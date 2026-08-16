import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { buildTrivia, TRIVIA_COUNT, type TriviaCatalogGame, type TriviaParty } from './trivia'
import type { LibraryGame } from './types'

function game(appid: number, name: string, over: Partial<TriviaCatalogGame> = {}): TriviaCatalogGame {
  return {
    appid,
    name,
    ccu: 1000 + appid,
    art: { header: `https://cdn/${appid}.jpg` },
    headerImage: `https://cdn/${appid}.jpg`,
    tags: { Action: 100, Multiplayer: 80, Indie: 60 },
    ...over,
  }
}

const CATALOG: TriviaCatalogGame[] = Array.from({ length: 24 }, (_, i) =>
  game(100 + i, `Игра ${i}`, { ccu: (i + 1) * 5000 }),
)

function lib(...rows: Array<[number, string, number]>): LibraryGame[] {
  return rows.map(([appid, name, h]) => ({
    appid,
    name,
    playtimeForever: h * 60,
    playtime2Weeks: 0,
  }))
}

const PARTY: TriviaParty[] = [
  { steamid: 'a', name: 'Аня', library: lib([1, 'Dota 2', 300], [2, 'Portal 2', 10], [3, 'Factorio', 90]) },
  { steamid: 'b', name: 'Боря', library: lib([1, 'Dota 2', 20], [4, 'Terraria', 200], [5, 'Valheim', 50]) },
]

describe('buildTrivia', () => {
  test('пустой каталог и комната на одного — пустой список, без исключений', () => {
    // Викторина обязана уметь не показываться: локальная база и свежий каталог
    // могут не дать ни одного пригодного вопроса
    expect(buildTrivia({ seed: 'r:1:0', catalog: [], party: [] })).toEqual([])
  })

  test('в одиночку набирает вопросы из каталога', () => {
    const qs = buildTrivia({ seed: 'r:1:0', catalog: CATALOG, party: [PARTY[0]] })
    expect(qs).toHaveLength(TRIVIA_COUNT)
    // вопросы про «у кого больше часов» в одиночку невозможны
    expect(qs.every((q) => ['ccu', 'cover', 'nottag'].includes(q.kind))).toBe(true)
  })

  test('в пати появляются вопросы про своих, но не забивают весь список', () => {
    const qs = buildTrivia({ seed: 'r:1:0', catalog: CATALOG, party: PARTY })
    const partyKinds = qs.filter((q) => q.kind === 'hours' || q.kind === 'toptrio')
    expect(partyKinds.length).toBeGreaterThan(0)
    // иначе комната на двоих получила бы десять «у кого больше часов» подряд
    expect(partyKinds.length).toBeLessThanOrEqual(Math.ceil(TRIVIA_COUNT / 2))
  })

  test('один и тот же сид даёт тот же набор, другой — другой', () => {
    const a = buildTrivia({ seed: 'r:1:0', catalog: CATALOG, party: PARTY }).map((q) => q.id)
    const b = buildTrivia({ seed: 'r:1:0', catalog: CATALOG, party: PARTY }).map((q) => q.id)
    const c = buildTrivia({ seed: 'r:1:1', catalog: CATALOG, party: PARTY }).map((q) => q.id)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  test('у каждого вопроса валидный ответ и нет повторов', () => {
    const qs = buildTrivia({ seed: 'r:1:0', catalog: CATALOG, party: PARTY })
    for (const q of qs) {
      expect(q.options.length).toBeGreaterThanOrEqual(2)
      expect(q.answer).toBeGreaterThanOrEqual(0)
      expect(q.answer).toBeLessThan(q.options.length)
      // варианты не должны повторяться — иначе «правильных» ответов два
      expect(new Set(q.options.map((o) => o.label)).size).toBe(q.options.length)
    }
    expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length)
  })

  test('ccu: правильный ответ — тот, где игроков больше', () => {
    const qs = buildTrivia({ seed: 'r:1:0', catalog: CATALOG, party: [] })
    for (const q of qs.filter((x) => x.kind === 'ccu')) {
      const winner = q.options[q.answer].label
      const other = q.options.find((_, i) => i !== q.answer)!.label
      const w = CATALOG.find((g) => g.name === winner)!
      const o = CATALOG.find((g) => g.name === other)!
      expect(w.ccu!).toBeGreaterThan(o.ccu!)
    }
  })

  test('ccu не спрашивается, когда онлайн неизвестен', () => {
    const noCcu = CATALOG.map((g) => ({ ...g, ccu: null }))
    const qs = buildTrivia({ seed: 'r:1:0', catalog: noCcu, party: [] })
    expect(qs.some((q) => q.kind === 'ccu')).toBe(false)
  })

  test('nottag: верный вариант отсутствует у игры, остальные есть', () => {
    const varied: TriviaCatalogGame[] = CATALOG.map((g, i) => ({
      ...g,
      tags: (i % 2
        ? { Action: 90, Co_op: 70, RPG: 50 }
        : { Strategy: 90, Indie: 70, Puzzle: 50 }) as Record<string, number>,
    }))
    const qs = buildTrivia({ seed: 'r:9:0', catalog: varied, party: [] })
    for (const q of qs.filter((x) => x.kind === 'nottag')) {
      const target = varied.find((g) => q.prompt.includes(g.name))!
      q.options.forEach((o, i) => {
        const has = Object.keys(target.tags).includes(o.label)
        expect(has).toBe(i !== q.answer)
      })
    }
  })

  test('hours: побеждает тот, кто наиграл больше', () => {
    const qs = buildTrivia({ seed: 'r:1:0', catalog: CATALOG, party: PARTY })
    for (const q of qs.filter((x) => x.kind === 'hours')) {
      expect(q.options[q.answer].label).toBe('Аня') // 300ч в Dota 2 против 20ч
    }
  })

  test('дословный предикат частичного индекса не потерян', () => {
    // Без него SQLite не возьмёт idx_games_ccu, и выборка для викторины
    // превратится в полный скан каталога — см. lib/noscan.test.ts
    const src = readFileSync('lib/trivia.ts', 'utf8')
    expect(src).toContain('alive = 1 AND superseded_by IS NULL AND tag_count > 0')
    // Комментарии выкидываем: в них про запрет RANDOM() как раз и написано
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/ORDER BY\s+RANDOM\(\)/i)
  })
})
