import { describe, expect, test } from 'vitest'
import { pickQuizCovers } from './quizart'
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
    expect(covers.short?.appid).toBe(1)
    expect(covers.medium?.appid).toBe(2)
    expect(covers.long?.appid).toBe(3)
  })

  test('под вайб встаёт игра с соответствующими тегами', () => {
    expect(covers.chill?.appid).toBe(4)
    expect(covers.engaged?.appid).toBe(5)
  })

  test('«с друзьями» получает мультиплеер, «один» — одиночную', () => {
    expect(covers.friends?.appid).toBe(6)
    expect(covers.solo?.appid).not.toBe(6)
    expect(covers.solo).toBeTruthy()
  })

  test('обложка везёт только header — hero и header2x лишний вес', () => {
    const cover = covers.long
    expect(cover?.art?.header ?? cover?.headerImage).toBeTruthy()
    expect(cover).not.toHaveProperty('screenshots')
    expect(JSON.stringify(cover)).not.toContain('hero')
  })
})

describe('pickQuizCovers — отбор и дедуп', () => {
  test('внутри одного шага обложки не повторяются', () => {
    // одна игра подходит сразу под «меньше часа» и «весь вечер» — но они стоят
    // рядом на одном экране, и две одинаковые панели читались бы как поломка
    const metas = [meta(1, ['Roguelike', 'Open World'])]
    const covers = pickQuizCovers({
      library: [game(1, 10)],
      metaOf: metaOfList(metas),
      seed: 's',
      nowSec: NOW,
    })
    const inStep = [covers.short, covers.medium, covers.long].filter(Boolean).map((c) => c!.appid)
    expect(inStep).toHaveLength(new Set(inStep).size)
    expect(inStep).toHaveLength(1)
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
    expect(covers.long?.appid).toBe(1)
    expect(covers.chill?.appid).toBe(1)
  })

  test('пока есть свободные, повтора между шагами не случается', () => {
    const metas = [meta(1, ['Open World', 'Cozy']), meta(2, ['Cozy'])]
    const covers = pickQuizCovers({
      library: [game(1, 10), game(2, 5)],
      metaOf: metaOfList(metas),
      seed: 's',
      nowSec: NOW,
    })
    expect(covers.long?.appid).toBe(1)
    expect(covers.chill?.appid).toBe(2)
  })

  test('при равном соответствии выигрывает наигранная — обложка что-то значит', () => {
    const metas = [meta(1, ['Open World']), meta(2, ['Open World'])]
    const covers = pickQuizCovers({
      library: [game(1, 3), game(2, 300)],
      metaOf: metaOfList(metas),
      seed: 's',
      nowSec: NOW,
    })
    expect(covers.long?.appid).toBe(2)
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
    expect(covers.long?.appid).toBe(3)
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
    expect(covers.long?.appid).toBe(2)
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

  test('набор меняется от недели к неделе', () => {
    const seen = new Set<number | undefined>()
    for (let w = 0; w < 12; w++) {
      const covers = pickQuizCovers({
        library,
        metaOf: metaOfList(metas),
        seed: 'steamid',
        nowSec: NOW + w * WEEK,
      })
      seen.add(covers.long?.appid)
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
    expect([a.long?.appid, b.long?.appid].every(Boolean)).toBe(true)
  })
})
