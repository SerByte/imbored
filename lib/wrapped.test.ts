import { describe, expect, test } from 'vitest'
import type { GameMeta, LibraryGame } from './types'
import { archetypeEvidence, buildWrapped, mosaicBlocks, pickStarter } from './wrapped'

function lib(appid: number, hours: number, weeks = 0): LibraryGame {
  return {
    appid,
    name: `g${appid}`,
    playtimeForever: Math.round(hours * 60),
    playtime2Weeks: Math.round(weeks * 60),
  }
}

function meta(
  appid: number,
  tags: Record<string, number>,
  categories: number[] = [2],
  extra: { priceFinal?: number; releaseDate?: string } = {},
): GameMeta {
  return { appid, name: `g${appid}`, tags, genres: [], categories, ...extra }
}

const METAS = new Map<number, GameMeta>([
  [1, meta(1, { Automation: 100 })],
  [2, meta(2, { Roguelike: 100 })],
  [3, meta(3, { 'Story Rich': 100 })],
])
const metaOf = (id: number) => METAS.get(id)

describe('buildWrapped — числа', () => {
  test('часы, сутки, количество игр', () => {
    const w = buildWrapped([lib(1, 300), lib(2, 100), lib(3, 50)], metaOf)
    expect(w.gamesCount).toBe(3)
    expect(w.totalHours).toBe(450)
    expect(w.days).toBe(19) // 450/24 = 18.75
  })

  test('правило 80/20: сколько игр набирают 80% времени', () => {
    // 450 всего, порог 360: 300 мало, 300+100=400 хватает
    expect(buildWrapped([lib(1, 300), lib(2, 100), lib(3, 50)], metaOf).pareto80).toBe(2)
    expect(buildWrapped([lib(1, 100)], metaOf).pareto80).toBe(1)
  })

  test('концентрация: одна игра — 100, четыре равные — 25', () => {
    expect(buildWrapped([lib(1, 100)], metaOf).concentration).toBe(100)
    const four = buildWrapped([lib(1, 10), lib(2, 10), lib(3, 10), lib(4, 10)], metaOf)
    expect(four.concentration).toBe(25)
  })

  test('топ отсортирован по часам и ограничен пятью', () => {
    const games = [lib(1, 10), lib(2, 90), lib(3, 50), lib(4, 70), lib(5, 30), lib(6, 20)]
    const w = buildWrapped(games, metaOf)
    expect(w.top).toHaveLength(5)
    expect(w.top.map((g) => g.appid)).toEqual([2, 4, 3, 5, 6])
    expect(w.top[0].hours).toBe(90)
    expect(w.top[0].sharePercent).toBe(33) // 90 из 270
  })

  test('непройденное: меньше двух часов и без активности за две недели', () => {
    const w = buildWrapped([lib(1, 300), lib(2, 1), lib(3, 0)], metaOf)
    expect(w.unplayedCount).toBe(2)
    expect(w.unplayed.map((g) => g.appid)).toEqual([2, 3])
  })

  test('игра с малым временем, но активная сейчас, непройденной не считается', () => {
    const w = buildWrapped([lib(1, 300), lib(2, 1, 1)], metaOf)
    expect(w.unplayedCount).toBe(0)
  })
})

describe('buildWrapped — деградация', () => {
  test('пустая библиотека не роняет и не даёт NaN', () => {
    const w = buildWrapped([], metaOf)
    expect(w.gamesCount).toBe(0)
    expect(w.totalHours).toBe(0)
    expect(w.days).toBe(0)
    expect(w.pareto80).toBe(0)
    expect(w.concentration).toBe(0)
    expect(w.top).toEqual([])
    expect(w.social).toBeNull()
  })

  test('нулевые часы у всех игр не дают NaN и не делят на ноль', () => {
    const w = buildWrapped([lib(1, 0), lib(2, 0)], metaOf)
    expect(w.totalHours).toBe(0)
    expect(w.concentration).toBe(0)
    expect(w.pareto80).toBe(0)
    expect(w.top).toEqual([])
    expect(Number.isNaN(w.concentration)).toBe(false)
  })

  test('маленькая библиотека из пяти игр отдаёт ровно пять в топ', () => {
    const w = buildWrapped([lib(1, 5), lib(2, 4), lib(3, 3), lib(4, 2), lib(5, 1)], metaOf)
    expect(w.top).toHaveLength(5)
  })
})

describe('buildWrapped — соло и кооп по часам', () => {
  test('доля считается по часам среди игр с метаданными', () => {
    const metas = new Map<number, GameMeta>([
      [1, meta(1, { 'Co-op': 100 }, [])], // мультиплеер по тегу
      [2, meta(2, { Roguelike: 100 }, [2])], // одиночная
    ])
    const w = buildWrapped([lib(1, 75), lib(2, 25)], (id) => metas.get(id))
    expect(w.social).not.toBeNull()
    expect(w.social!.percent).toBe(75)
  })

  test('игры без метаданных в знаменатель не попадают', () => {
    const metas = new Map<number, GameMeta>([[1, meta(1, { 'Co-op': 100 }, [])]])
    // вторая игра без меты: 500 часов, но она не должна размыть долю
    const w = buildWrapped([lib(1, 50), lib(2, 500)], (id) => metas.get(id))
    expect(w.social!.percent).toBe(100)
    expect(w.social!.coveredHours).toBe(50)
  })

  test('без единой меты доля не выдумывается', () => {
    const w = buildWrapped([lib(9, 100)], () => undefined)
    expect(w.social).toBeNull()
  })
})

describe('buildWrapped — годы выпуска', () => {
  const withYears = (years: Array<[number, string, number]>) => {
    // [appid, releaseDate, hours]
    const metas = new Map<number, GameMeta>(
      years.map(([appid, releaseDate]) => [appid, meta(appid, {}, [2], { releaseDate })]),
    )
    return buildWrapped(
      years.map(([appid, , hours]) => lib(appid, hours)),
      (id) => metas.get(id),
    )
  }

  test('медиана года взвешена по часам, а не по числу игр', () => {
    // 10 часов в старой игре против 300 в новой — медиана должна уехать к новой
    const w = withYears([
      [1, '2010-01-01', 10],
      [2, '2020-06-15', 300],
    ])
    expect(w.era?.medianYear).toBe(2020)
  })

  test('самая старая наигранная игра', () => {
    const w = withYears([
      [1, '1998-11-19', 50],
      [2, '2015-01-01', 50],
      [3, '2020-01-01', 50],
    ])
    expect(w.era?.oldest).toEqual({ appid: 1, name: 'g1', year: 1998 })
    expect(w.era?.medianYear).toBe(2015)
  })

  test('локализованная дата старого формата тоже парсится', () => {
    const w = withYears([[1, '10 мая 2015', 100]])
    expect(w.era?.medianYear).toBe(2015)
  })

  test('непройденные игры на медиану не влияют', () => {
    const w = withYears([
      [1, '2020-01-01', 100],
      [2, '1999-01-01', 0], // куплена, не запущена
    ])
    expect(w.era?.medianYear).toBe(2020)
    expect(w.era?.oldest?.year).toBe(2020)
  })

  test('при слабом покрытии дат блок не показывается', () => {
    const metas = new Map<number, GameMeta>([
      [1, meta(1, {}, [2], { releaseDate: '2020-01-01' })], // 10 часов из 310
    ])
    const w = buildWrapped([lib(1, 10), lib(2, 300)], (id) => metas.get(id))
    expect(w.era).toBeNull()
  })

  test('без дат вообще блок не показывается', () => {
    const w = buildWrapped([lib(1, 100)], metaOf)
    expect(w.era).toBeNull()
  })

  test('дата без года («скоро») не роняет и не считается', () => {
    const w = withYears([[1, 'скоро', 100]])
    expect(w.era).toBeNull()
  })
})

describe('mosaicBlocks', () => {
  const PLAN = [
    { take: 2, step: 2 },
    { take: 4, step: 4 },
    { take: 12, step: 6 },
  ]
  const many = (n: number) => Array.from({ length: n }, (_, i) => lib(i + 1, 100 - i))

  test('полная библиотека режется по плану', () => {
    const blocks = mosaicBlocks(many(30), PLAN)
    expect(blocks.map((b) => b.length)).toEqual([2, 4, 12])
  })

  test('каждый блок кратен своему шагу — иначе в ряду будет дыра', () => {
    for (const n of [1, 3, 5, 7, 9, 11, 13, 17, 23, 29]) {
      const blocks = mosaicBlocks(many(n), PLAN)
      blocks.forEach((b, i) => expect(b.length % PLAN[i].step).toBe(0))
    }
  })

  test('хвост, не заполняющий ряд, отбрасывается', () => {
    // 2 + 4 = 6 разложены, седьмая одна ряд из шести не заполнит
    expect(mosaicBlocks(many(7), PLAN).map((b) => b.length)).toEqual([2, 4])
  })

  test('маленькая библиотека даёт только первые блоки', () => {
    expect(mosaicBlocks(many(3), PLAN).map((b) => b.length)).toEqual([2])
    expect(mosaicBlocks(many(1), PLAN)).toEqual([])
  })

  test('пустая библиотека не роняет', () => {
    expect(mosaicBlocks([], PLAN)).toEqual([])
  })

  test('игры не повторяются между блоками и идут по порядку', () => {
    const blocks = mosaicBlocks(many(30), PLAN)
    const ids = blocks.flat().map((g) => g.appid)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
  })
})

describe('archetypeEvidence', () => {
  test('возвращает игры, которые действительно тянут архетип', () => {
    const metas = new Map<number, GameMeta>([
      [1, meta(1, { Automation: 100 })],
      [2, meta(2, { Automation: 100 })],
      [3, meta(3, { Roguelike: 100 })],
    ])
    const ev = archetypeEvidence([lib(1, 100), lib(2, 50), lib(3, 300)], (id) => metas.get(id), 'Automation', new Set(), 3)
    expect(ev.map((g) => g.appid)).toEqual([1, 2])
  })

  test('исключённые игры не попадают в улики', () => {
    const metas = new Map<number, GameMeta>([
      [1, meta(1, { Automation: 100 })],
      [2, meta(2, { Automation: 100 })],
    ])
    const ev = archetypeEvidence([lib(1, 100), lib(2, 50)], (id) => metas.get(id), 'Automation', new Set([1]), 3)
    expect(ev.map((g) => g.appid)).toEqual([2])
  })

  test('неизвестный тег даёт пустой список, а не падение', () => {
    expect(archetypeEvidence([lib(1, 100)], metaOf, 'Nonexistent', new Set(), 3)).toEqual([])
  })
})

describe('pickStarter', () => {
  test('выбирает непройденную игру, ближайшую по вкусу', () => {
    const metas = new Map<number, GameMeta>([
      [1, meta(1, { Automation: 100 })], // наигранная — формирует вкус
      [2, meta(2, { Automation: 100 })], // непройденная, попадает во вкус
      [3, meta(3, { Horror: 100 })], // непройденная, мимо
    ])
    const games = [lib(1, 300), lib(2, 0), lib(3, 0)]
    expect(pickStarter(games, (id) => metas.get(id))?.appid).toBe(2)
  })

  test('без непройденных игр возвращает null', () => {
    expect(pickStarter([lib(1, 300)], metaOf)).toBeNull()
  })

  test('пустая библиотека возвращает null', () => {
    expect(pickStarter([], metaOf)).toBeNull()
  })
})
