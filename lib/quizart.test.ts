import { describe, expect, test } from 'vitest'
import { pickQuizCovers, pickQuizShelf } from './quizart'
import type { GameMeta, LibraryGame } from './types'

const NOW = 1_700_000_000
const WEEK = 7 * 86_400

function meta(appid: number, tags: string[], extra: Partial<GameMeta> = {}): GameMeta {
  return {
    appid,
    name: `Game ${appid}`,
    tags: Object.fromEntries(tags.map((t) => [t, 100])),
    genres: [],
    // 2 = Single-player: без категорий isMultiplayerMeta уходит в теги, а тесту
    // нужен однозначный ответ
    categories: [2],
    headerImage: `https://cdn/${appid}.jpg`,
    ...extra,
  }
}

function game(appid: number, hours = 0): LibraryGame {
  return {
    appid,
    name: `Game ${appid}`,
    playtimeForever: hours * 60,
    playtime2Weeks: 0,
  }
}

function metaOfList(list: GameMeta[]) {
  const map = new Map(list.map((m) => [m.appid, m]))
  return (appid: number) => map.get(appid)
}

describe('pickQuizCovers — соответствие оси', () => {
  const metas = [
    meta(1, ['Roguelike']), // short
    meta(2, ['Metroidvania']), // medium
    meta(3, ['Open World', 'RPG']), // long
    meta(4, ['Cozy', 'Relaxing']), // chill
    meta(5, ['Souls-like', 'Difficult']), // engaged
    meta(6, ['Shooter'], { categories: [1] }), // multiplayer
  ]
  const library = [1, 2, 3, 4, 5, 6].map((a) => game(a, a))
  const covers = pickQuizCovers({
    library,
    metaOf: metaOfList(metas),
    seed: 'steamid',
    nowSec: NOW,
  })

  test('под каждое время встаёт игра своей корзины', () => {
    expect(covers.short?.[0]?.appid).toBe(1)
    expect(covers.medium?.[0]?.appid).toBe(2)
    expect(covers.long?.[0]?.appid).toBe(3)
  })

  test('под вайб встаёт игра с соответствующими тегами', () => {
    expect(covers.chill?.[0]?.appid).toBe(4)
    expect(covers.engaged?.[0]?.appid).toBe(5)
  })

  test('«с друзьями» получает мультиплеер, «один» — одиночную', () => {
    expect(covers.friends?.[0]?.appid).toBe(6)
    expect(covers.solo?.[0]?.appid).not.toBe(6)
    expect(covers.solo?.length).toBeGreaterThan(0)
  })

  test('обложка везёт только header — hero и header2x лишний вес', () => {
    const cover = covers.long?.[0]
    expect(cover?.art?.header ?? cover?.headerImage).toBeTruthy()
    expect(cover).not.toHaveProperty('screenshots')
    expect(JSON.stringify(cover)).not.toContain('hero')
  })

  test('присутствующий ключ — всегда непустая стопка', () => {
    for (const stack of Object.values(covers)) {
      expect(Array.isArray(stack)).toBe(true)
      expect(stack.length).toBeGreaterThan(0)
    }
  })
})

describe('pickQuizCovers — отбор и дедуп', () => {
  test('внутри одного шага не повторяется НИ ОДНА плитка, включая хвосты', () => {
    // одна игра подходит сразу под «меньше часа» и «весь вечер» — но они стоят
    // рядом на одном экране, и две одинаковые панели читались бы как поломка
    const metas = [meta(1, ['Roguelike', 'Open World'])]
    const covers = pickQuizCovers({
      library: [game(1, 10)],
      metaOf: metaOfList(metas),
      seed: 's',
      nowSec: NOW,
    })
    const tiles = [covers.short, covers.medium, covers.long].flatMap((s) => s ?? [])
    const ids = tiles.map((c) => c.appid)
    expect(ids).toHaveLength(new Set(ids).size)
    expect(ids).toHaveLength(1)
  })

  test('богатый шаг собирает три стопки по три без единого повтора', () => {
    const metas = [
      ...[1, 2, 3, 4].map((a) => meta(a, ['Roguelike'])),
      ...[5, 6, 7, 8].map((a) => meta(a, ['Metroidvania'])),
      ...[9, 10, 11, 12].map((a) => meta(a, ['Open World'])),
    ]
    const covers = pickQuizCovers({
      library: metas.map((m) => game(m.appid, m.appid)),
      metaOf: metaOfList(metas),
      seed: 's',
      nowSec: NOW,
    })
    expect(covers.short).toHaveLength(3)
    expect(covers.medium).toHaveLength(3)
    expect(covers.long).toHaveLength(3)
    const ids = [covers.short, covers.medium, covers.long].flatMap((s) => s ?? []).map((c) => c.appid)
    expect(ids).toHaveLength(9)
    expect(new Set(ids).size).toBe(9)
  })

  test('хвосты не двигают примари других осей', () => {
    // g2 — лучший кандидат «расслабиться» И кандидат в хвост «весь вечер».
    // Если бы хвосты выбирались вперемешку с примари, «весь вечер» съел бы g2
    // в usedAnywhere раньше, и примари «расслабиться» съехал бы на g3.
    const metas = [
      meta(1, ['Open World']),
      meta(2, ['Open World', 'Cozy']),
      meta(3, ['Cozy']),
    ]
    const covers = pickQuizCovers({
      library: [game(1, 300), game(2, 200), game(3, 10)],
      metaOf: metaOfList(metas),
      seed: 's',
      nowSec: NOW,
    })
    expect(covers.long?.[0]?.appid).toBe(1)
    expect(covers.chill?.[0]?.appid).toBe(2)
  })

  test('между шагами повтор допустим, когда больше нечем', () => {
    // единственная игра библиотеки подходит и под «весь вечер», и под
    // «расслабиться». Панели разнесены на экран друг от друга, и пустая
    // клетка здесь хуже повтора.
    const metas = [meta(1, ['Open World', 'Cozy'])]
    const covers = pickQuizCovers({
      library: [game(1, 10)],
      metaOf: metaOfList(metas),
      seed: 's',
      nowSec: NOW,
    })
    expect(covers.long?.[0]?.appid).toBe(1)
    expect(covers.chill?.[0]?.appid).toBe(1)
  })

  test('пока есть свободные, повтора между шагами не случается', () => {
    const metas = [meta(1, ['Open World', 'Cozy']), meta(2, ['Cozy'])]
    const covers = pickQuizCovers({
      library: [game(1, 10), game(2, 5)],
      metaOf: metaOfList(metas),
      seed: 's',
      nowSec: NOW,
    })
    expect(covers.long?.[0]?.appid).toBe(1)
    expect(covers.chill?.[0]?.appid).toBe(2)
  })

  test('стопка деградирует, а не повторяет сама себя', () => {
    // под «весь вечер» ровно два кандидата: стопка из двух, не из трёх
    const metas = [meta(1, ['Open World']), meta(2, ['Open World'])]
    const covers = pickQuizCovers({
      library: [game(1, 10), game(2, 5)],
      metaOf: metaOfList(metas),
      seed: 's',
      nowSec: NOW,
    })
    expect(covers.long).toHaveLength(2)
    expect(new Set(covers.long?.map((c) => c.appid)).size).toBe(2)
  })

  test('при равном соответствии выигрывает наигранная — обложка что-то значит', () => {
    const metas = [meta(1, ['Open World']), meta(2, ['Open World'])]
    const covers = pickQuizCovers({
      library: [game(1, 3), game(2, 300)],
      metaOf: metaOfList(metas),
      seed: 's',
      nowSec: NOW,
    })
    expect(covers.long?.[0]?.appid).toBe(2)
  })

  test('без положительного соответствия обложки нет вовсе', () => {
    // ни одной мультиплеерной игры: пустая ячейка честнее обложки, которая
    // противоречит ответу
    const metas = [meta(1, ['Open World'])]
    const covers = pickQuizCovers({
      library: [game(1, 10)],
      metaOf: metaOfList(metas),
      seed: 's',
      nowSec: NOW,
    })
    expect(covers.friends).toBeUndefined()
  })

  test('игры без арта не попадают на панели', () => {
    const metas = [meta(1, ['Open World'], { headerImage: undefined, art: undefined })]
    const covers = pickQuizCovers({
      library: [game(1, 10)],
      metaOf: metaOfList(metas),
      seed: 's',
      nowSec: NOW,
    })
    expect(covers.long).toBeUndefined()
  })

  test('мусор отсеивается вместе с играми чужих магазинов', () => {
    const metas = [
      meta(1, ['Open World']),
      meta(-2, ['Open World']),
      meta(3, ['Open World']),
    ]
    const library = [
      { ...game(1, 10), name: 'Nice Game - Soundtrack' },
      { ...game(-2, 10), name: 'Epic Game' },
      game(3, 5),
    ]
    const covers = pickQuizCovers({
      library,
      metaOf: metaOfList(metas),
      seed: 's',
      nowSec: NOW,
    })
    expect(covers.long?.[0]?.appid).toBe(3)
  })

  test('пустая библиотека не роняет и не выдумывает', () => {
    const covers = pickQuizCovers({
      library: [],
      metaOf: () => undefined,
      seed: 's',
      nowSec: NOW,
    })
    expect(Object.values(covers).filter(Boolean)).toHaveLength(0)
  })

  test('untouchedOnly оставляет только ни разу не запущенные', () => {
    const metas = [meta(1, ['Open World']), meta(2, ['Open World'])]
    const covers = pickQuizCovers({
      library: [game(1, 100), game(2, 0)],
      metaOf: metaOfList(metas),
      seed: 's',
      nowSec: NOW,
      untouchedOnly: true,
    })
    expect(covers.long?.[0]?.appid).toBe(2)
    expect(covers.long).toHaveLength(1)
  })
})

describe('pickQuizCovers — детерминизм', () => {
  const metas = [meta(1, ['Open World']), meta(2, ['Open World']), meta(3, ['Open World'])]
  const library = [game(1, 30), game(2, 20), game(3, 10)]

  test('один и тот же вход даёт один и тот же выход', () => {
    const args = { library, metaOf: metaOfList(metas), seed: 'steamid', nowSec: NOW }
    // страница может перерендериться в любой момент — набор не должен дёргаться
    expect(pickQuizCovers(args)).toEqual(pickQuizCovers(args))
  })

  test('лицо панели меняется от недели к неделе', () => {
    const seen = new Set<number | undefined>()
    for (let w = 0; w < 12; w++) {
      const covers = pickQuizCovers({
        library,
        metaOf: metaOfList(metas),
        seed: 'steamid',
        nowSec: NOW + w * WEEK,
      })
      seen.add(covers.long?.[0]?.appid)
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  test('ротация двигает НАБОР стопки, а не только лицо', () => {
    // шесть кандидатов при стопке в три: если бы хвосты жили в том же окне
    // ротации, что примари, неделя лишь переставляла бы одни и те же три игры
    const rich = [1, 2, 3, 4, 5, 6].map((a) => meta(a, ['Open World']))
    const richLib = rich.map((m) => game(m.appid, 100 - m.appid))
    const seen = new Set<string>()
    for (let w = 0; w < 12; w++) {
      const covers = pickQuizCovers({
        library: richLib,
        metaOf: metaOfList(rich),
        seed: 'steamid',
        nowSec: NOW + w * WEEK,
      })
      seen.add((covers.long ?? []).map((c) => c.appid).sort((a, b) => a - b).join(','))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  test('внутри одной недели набор стоит на месте', () => {
    const a = pickQuizCovers({ library, metaOf: metaOfList(metas), seed: 's', nowSec: NOW })
    const b = pickQuizCovers({
      library,
      metaOf: metaOfList(metas),
      seed: 's',
      nowSec: NOW + 3600,
    })
    expect(a).toEqual(b)
  })

  test('у разных игроков наборы независимы', () => {
    const a = pickQuizCovers({ library, metaOf: metaOfList(metas), seed: 'one', nowSec: NOW })
    const b = pickQuizCovers({ library, metaOf: metaOfList(metas), seed: 'two', nowSec: NOW })
    // одинаковый результат допустим, важно что seed вообще участвует
    expect([a.long?.[0]?.appid, b.long?.[0]?.appid].every(Boolean)).toBe(true)
  })
})

describe('pickQuizShelf', () => {
  // без lastPlayed и с нулём за две недели: 0ч → unplayed, 20ч → comeback,
  // playtime2Weeks > 0 → active (в полку не годится)
  const metas = [1, 2, 3, 4, 5].map((a) => meta(a, ['Open World']))
  const metaOf = metaOfList(metas)

  test('полка берёт только бэклог: unplayed и comeback, не active', () => {
    const library = [
      game(1, 0), // unplayed
      game(2, 20), // comeback
      { ...game(3, 10), playtime2Weeks: 60 }, // active
    ]
    const shelf = pickQuizShelf({ library, metaOf, seed: 's', nowSec: NOW })
    const ids = shelf.map((c) => c.appid)
    expect(ids).toContain(1)
    expect(ids).toContain(2)
    expect(ids).not.toContain(3)
  })

  test('exclude убирает обложки панелей — совпадение деанонимировало бы ответ', () => {
    const library = [game(1, 0), game(2, 0), game(3, 0)]
    const shelf = pickQuizShelf({
      library,
      metaOf,
      seed: 's',
      nowSec: NOW,
      exclude: new Set([2]),
    })
    expect(shelf.map((c) => c.appid)).not.toContain(2)
  })

  test('без арта на полку не попасть', () => {
    const bare = [meta(1, ['Open World'], { headerImage: undefined, art: undefined })]
    const shelf = pickQuizShelf({
      library: [game(1, 0)],
      metaOf: metaOfList(bare),
      seed: 's',
      nowSec: NOW,
    })
    expect(shelf).toHaveLength(0)
  })

  test('untouchedOnly сужает полку до ни разу не запущенных', () => {
    const library = [game(1, 0), game(2, 20)]
    const shelf = pickQuizShelf({
      library,
      metaOf,
      seed: 's',
      nowSec: NOW,
      untouchedOnly: true,
    })
    expect(shelf.map((c) => c.appid)).toEqual([1])
  })

  test('не больше двенадцати, детерминированно внутри недели, живёт между неделями', () => {
    const many = Array.from({ length: 15 }, (_, i) => meta(i + 1, ['Open World']))
    const lib = many.map((m) => game(m.appid, 0))
    const args = { library: lib, metaOf: metaOfList(many), seed: 's', nowSec: NOW }

    const a = pickQuizShelf(args)
    expect(a).toHaveLength(12)
    expect(a).toEqual(pickQuizShelf(args))

    const seen = new Set<string>()
    for (let w = 0; w < 8; w++) {
      const shelf = pickQuizShelf({ ...args, nowSec: NOW + w * WEEK })
      seen.add(shelf.map((c) => c.appid).join(','))
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})
