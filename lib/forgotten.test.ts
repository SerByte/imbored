import { describe, expect, test } from 'vitest'
import {
  buildLibraryView,
  dayKey,
  forgottenCandidates,
  parseLibraryFilter,
  pickForgotten,
} from './forgotten'
import type { GameMeta, LibraryGame } from './types'

const NOW = 1_700_000_000
const DAY = 86_400

function game(partial: Partial<LibraryGame> & { appid: number }): LibraryGame {
  return { name: `game-${partial.appid}`, playtimeForever: 0, playtime2Weeks: 0, ...partial }
}

function meta(appid: number, partial: Partial<GameMeta> = {}): GameMeta {
  return {
    appid,
    name: `game-${appid}`,
    tags: { Action: 100 },
    genres: [],
    categories: [2],
    headerImage: `https://example/${appid}.jpg`,
    ...partial,
  }
}

const sealed = Array.from({ length: 20 }, (_, i) => game({ appid: i + 1 }))
const sealedMetas = new Map(sealed.map((g) => [g.appid, meta(g.appid)]))
const metaOf = (id: number) => sealedMetas.get(id)

describe('pickForgotten', () => {
  test('полка не меняется при повторном рендере в тот же день', () => {
    const seed = 'u1:2026-08-13:shelf'
    expect(pickForgotten(sealed, seed)).toEqual(pickForgotten(sealed, seed))
  })

  test('на следующий день полка другая', () => {
    const a = pickForgotten(sealed, 'u1:2026-08-13:shelf').map((g) => g.appid)
    const b = pickForgotten(sealed, 'u1:2026-08-14:shelf').map((g) => g.appid)
    expect(a).not.toEqual(b)
  })

  test('у разных игроков полки разные', () => {
    const a = pickForgotten(sealed, 'u1:2026-08-13:shelf').map((g) => g.appid)
    const b = pickForgotten(sealed, 'u2:2026-08-13:shelf').map((g) => g.appid)
    expect(a).not.toEqual(b)
  })

  test('не зависит от порядка входа: /library и портрет сортируют по-разному', () => {
    const shuffled = [...sealed].reverse()
    const a = pickForgotten(sealed, 'u1:2026-08-13:shelf').map((g) => g.appid)
    const b = pickForgotten(shuffled, 'u1:2026-08-13:shelf').map((g) => g.appid)
    expect(a).toEqual(b)
  })

  test('без дублей', () => {
    const out = pickForgotten(sealed, 'u1:2026-08-13:shelf').map((g) => g.appid)
    expect(out).toEqual([...new Set(out)])
  })

  test('игр меньше размера полки — отдаёт все (демо-случай на четырёх)', () => {
    const four = sealed.slice(0, 4)
    expect(pickForgotten(four, 'u1:2026-08-13:shelf')).toHaveLength(4)
  })

  test('пустой вход не роняет', () => {
    expect(pickForgotten([], 'u1:2026-08-13:shelf')).toEqual([])
  })

  test('исходный массив не мутируется', () => {
    const input = [...sealed]
    pickForgotten(input, 'u1:2026-08-13:shelf')
    expect(input).toEqual(sealed)
  })
})

describe('dayKey', () => {
  test('YYYY-MM-DD, как сид «Игры дня»', () => {
    expect(dayKey(new Date(NOW * 1000))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('forgottenCandidates', () => {
  test('берёт только ни разу не запущенные', () => {
    const lib = [game({ appid: 1 }), game({ appid: 2, playtimeForever: 30 })]
    expect(forgottenCandidates(lib, metaOf).map((g) => g.appid)).toEqual([1])
  })

  test('мусор на полку не попадает', () => {
    const lib = [game({ appid: 1 }), game({ appid: 2, name: 'Celeste - Soundtrack' })]
    expect(forgottenCandidates(lib, metaOf).map((g) => g.appid)).toEqual([1])
  })

  test('записи не-Steam магазинов пропускаются: у них нет арта', () => {
    const lib = [game({ appid: 1 }), game({ appid: -101 })]
    expect(forgottenCandidates(lib, metaOf).map((g) => g.appid)).toEqual([1])
  })

  test('при наличии обложек предпочитает игры с обложкой', () => {
    const lib = [game({ appid: 1 }), game({ appid: 2 }), game({ appid: 99 })]
    expect(forgottenCandidates(lib, metaOf).map((g) => g.appid)).toEqual([1, 2])
  })

  test('если обложек почти нет — отдаёт всё, а не пустоту', () => {
    const lib = [game({ appid: 99 }), game({ appid: 98 })]
    expect(forgottenCandidates(lib, metaOf).map((g) => g.appid)).toEqual([99, 98])
  })
})

describe('forgottenCandidates: издания одной игры', () => {
  const BASE = "Hellblade: Senua's Sacrifice"
  const VR = "Hellblade: Senua's Sacrifice VR Edition"

  /** metaOf с обложками ровно для перечисленных appid */
  const withMetas = (...ids: number[]) => {
    const m = new Map(ids.map((id) => [id, meta(id)]))
    return (id: number) => m.get(id)
  }

  test('два издания — одна плитка, остаётся базовая игра', () => {
    // 414340 и 719950 стояли на полке рядом, с одинаковой обложкой
    const lib = [
      game({ appid: 414340, name: BASE }),
      game({ appid: 719950, name: VR }),
      game({ appid: 620, name: 'Portal 2' }),
    ]
    expect(forgottenCandidates(lib, withMetas(414340, 719950, 620)).map((g) => g.appid)).toEqual([
      414340, 620,
    ])
  })

  test('обратный порядок входа канон не меняет', () => {
    const lib = [
      game({ appid: 620, name: 'Portal 2' }),
      game({ appid: 719950, name: VR }),
      game({ appid: 414340, name: BASE }),
    ]
    const out = forgottenCandidates(lib, withMetas(414340, 719950, 620)).map((g) => g.appid)
    expect(out).toContain(414340)
    expect(out).not.toContain(719950)
  })

  test('сыгранное издание убирает запечатанного близнеца с полки', () => {
    // «Ты забыл, что они у тебя есть» — про VR-издание это неправда,
    // если в базовую игру наиграно двадцать часов
    const lib = [
      game({ appid: 414340, name: BASE, playtimeForever: 1200 }),
      game({ appid: 719950, name: VR }),
      game({ appid: 620, name: 'Portal 2' }),
    ]
    expect(forgottenCandidates(lib, withMetas(414340, 719950, 620)).map((g) => g.appid)).toEqual([
      620,
    ])
  })

  test('одной минуты в другом издании достаточно', () => {
    const lib = [
      game({ appid: 414340, name: BASE, playtimeForever: 1 }),
      game({ appid: 719950, name: VR }),
      game({ appid: 620, name: 'Portal 2' }),
    ]
    expect(forgottenCandidates(lib, withMetas(719950, 620)).map((g) => g.appid)).toEqual([620])
  })

  test('сыгранная копия из чужого магазина тоже считается', () => {
    // записи не-Steam магазинов лежат под отрицательными id и на полку не идут,
    // но доказательством «ты про неё помнишь» они быть обязаны
    const lib = [
      game({ appid: -101, name: BASE, playtimeForever: 600 }),
      game({ appid: 719950, name: VR }),
      game({ appid: 620, name: 'Portal 2' }),
    ]
    expect(forgottenCandidates(lib, withMetas(719950, 620)).map((g) => g.appid)).toEqual([620])
  })

  test('схлопывание считается ДО фильтра по обложкам', () => {
    // Иначе оптовый откат «обложек меньше двух — отдаём всё» вернул бы пару
    // обратно ровно на маленьких библиотеках, ради которых он и существует
    const lib = [
      game({ appid: 414340, name: BASE }),
      game({ appid: 719950, name: VR }),
      game({ appid: 620, name: 'Portal 2' }),
    ]
    expect(forgottenCandidates(lib, withMetas(414340, 719950)).map((g) => g.appid)).toEqual([
      414340, 620,
    ])
  })

  test('разные части серии обе остаются на полке', () => {
    const lib = [game({ appid: 400, name: 'Portal' }), game({ appid: 620, name: 'Portal 2' })]
    expect(forgottenCandidates(lib, withMetas(400, 620)).map((g) => g.appid)).toEqual([400, 620])
  })

  test('игра без метаданных выигрывает у прогретого издания', () => {
    // metaOf на /library возвращает undefined постоянно: обложки догреваются
    // прямо во время рендера. Молчание меты — не доказательство вторичности
    const lib = [game({ appid: 414340, name: BASE }), game({ appid: 719950, name: VR })]
    expect(forgottenCandidates(lib, withMetas(719950)).map((g) => g.appid)).toEqual([414340])
  })
})

describe('parseLibraryFilter', () => {
  test('known-значения проходят', () => {
    expect(parseLibraryFilter('untouched')).toBe('untouched')
    expect(parseLibraryFilter('comeback')).toBe('comeback')
  })

  test('мусор, массив и пустота падают в общую сетку', () => {
    expect(parseLibraryFilter('lol')).toBe('all')
    expect(parseLibraryFilter(undefined)).toBe('all')
    // ?state=a&state=b приезжает массивом — раньше такое было бы приведением типа
    expect(parseLibraryFilter(['untouched'])).toBe('all')
  })
})

describe('buildLibraryView', () => {
  const lib = [
    game({ appid: 1 }), // untouched
    game({ appid: 2, playtimeForever: 30 }), // unplayed
    game({ appid: 3, playtimeForever: 900, lastPlayed: NOW - 300 * DAY }), // comeback
    game({ appid: 4, playtimeForever: 900, playtime2Weeks: 60 }), // active
    game({ appid: 5, playtimeForever: 900, lastPlayed: NOW - 10 * DAY }), // played
  ]

  test('полка «все» — по часам вниз, как было', () => {
    const view = buildLibraryView(lib, metaOf, 'all', NOW)
    expect(view.games.map((g) => g.appid)).toEqual([3, 4, 5, 2, 1])
  })

  test('фильтр отбирает своё состояние', () => {
    expect(buildLibraryView(lib, metaOf, 'untouched', NOW).games.map((g) => g.appid)).toEqual([1])
    expect(buildLibraryView(lib, metaOf, 'unplayed', NOW).games.map((g) => g.appid)).toEqual([2])
    expect(buildLibraryView(lib, metaOf, 'comeback', NOW).games.map((g) => g.appid)).toEqual([3])
    expect(buildLibraryView(lib, metaOf, 'active', NOW).games.map((g) => g.appid)).toEqual([4])
  })

  test('счётчики считаются от всей библиотеки, а не от выбранного фильтра', () => {
    const view = buildLibraryView(lib, metaOf, 'untouched', NOW)
    expect(view.counts).toEqual({ all: 5, untouched: 1, unplayed: 1, comeback: 1, active: 1 })
  })

  test('полка «ни разу» ранжируется по вкусу, а не по порядку библиотеки', () => {
    const metas = new Map([
      [1, meta(1, { tags: { Farming: 100 } })],
      [2, meta(2, { tags: { Action: 100 } })],
    ])
    // профиль строится по наигранному: игра 9 задаёт вкус к Action
    const withTaste = [
      game({ appid: 1 }),
      game({ appid: 2 }),
      game({ appid: 9, playtimeForever: 6000, lastPlayed: NOW - DAY }),
    ]
    metas.set(9, meta(9, { tags: { Action: 100 } }))
    const view = buildLibraryView(withTaste, (id) => metas.get(id), 'untouched', NOW)
    expect(view.games.map((g) => g.appid)).toEqual([2, 1])
  })

  test('игра без метаданных на полке «ни разу» остаётся, но в конце', () => {
    const view = buildLibraryView([game({ appid: 99 }), game({ appid: 1 })], metaOf, 'untouched', NOW)
    expect(view.games.map((g) => g.appid)).toEqual([1, 99])
  })

  test('пустая библиотека — пустые полки и нули', () => {
    const view = buildLibraryView([], metaOf, 'all', NOW)
    expect(view.games).toEqual([])
    expect(view.counts).toEqual({ all: 0, untouched: 0, unplayed: 0, comeback: 0, active: 0 })
  })

  test('исходный массив не мутируется', () => {
    const input = [...lib]
    buildLibraryView(input, metaOf, 'all', NOW)
    expect(input).toEqual(lib)
  })
})
