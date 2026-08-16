import { describe, expect, test } from 'vitest'
import { countKey } from './quiz'
import { buildQuizCounts } from './quizcount'
import type { GameMeta, LibraryGame } from './types'

const NOW = 1_700_000_000
const DAY = 86_400
const H = 60

function meta(appid: number, tags: string[], extra: Partial<GameMeta> = {}): GameMeta {
  return {
    appid,
    name: `Game ${appid}`,
    tags: Object.fromEntries(tags.map((t) => [t, 100])),
    genres: [],
    categories: [2], // Single-player
    ...extra,
  }
}

/** По умолчанию — «ни разу не запускал», то есть бэклог */
function game(appid: number, over: Partial<LibraryGame> = {}): LibraryGame {
  return { appid, name: `Game ${appid}`, playtimeForever: 0, playtime2Weeks: 0, ...over }
}

function metaOfList(list: GameMeta[]) {
  const map = new Map(list.map((m) => [m.appid, m]))
  return (appid: number) => map.get(appid)
}

/** Достаточно бэклога, чтобы пройти порог MIN_BACKLOG */
function padding(from: number, count: number) {
  const metas: GameMeta[] = []
  const games: LibraryGame[] = []
  for (let i = 0; i < count; i++) {
    metas.push(meta(from + i, ['Walking Simulator']))
    games.push(game(from + i))
  }
  return { metas, games }
}

describe('countKey', () => {
  test('склеивает только данные ответы, по порядку осей', () => {
    expect(countKey({})).toBe('')
    expect(countKey({ time: 'short' })).toBe('short')
    expect(countKey({ time: 'short', vibe: 'chill' })).toBe('short:chill')
    expect(countKey({ time: 'short', vibe: 'chill', social: 'solo' })).toBe('short:chill:solo')
  })
})

describe('buildQuizCounts — форма карты', () => {
  const pad = padding(900, 10)
  const counts = buildQuizCounts({
    library: pad.games,
    metaOf: metaOfList(pad.metas),
    nowSec: NOW,
  })

  test('двадцать два числа: пусто + 3 + 6 + 12', () => {
    expect(counts).not.toBeNull()
    expect(Object.keys(counts!)).toHaveLength(22)
  })

  test('пустой ключ — весь бэклог', () => {
    expect(counts!['']).toBe(10)
  })
})

describe('buildQuizCounts — монотонность', () => {
  test('число не может вырасти при добавлении ответа', () => {
    const pad = padding(900, 12)
    const metas = [
      ...pad.metas,
      meta(1, ['Roguelike', 'Cozy']),
      meta(2, ['Open World', 'Difficult'], { categories: [1] }),
      meta(3, ['Metroidvania']),
    ]
    const library = [...pad.games, game(1), game(2), game(3)]
    const counts = buildQuizCounts({ library, metaOf: metaOfList(metas), nowSec: NOW })!

    for (const key of Object.keys(counts)) {
      if (!key) continue
      const parent = key.split(':').slice(0, -1).join(':')
      expect(counts[key]).toBeLessThanOrEqual(counts[parent])
    }
  })
})

describe('buildQuizCounts — конъюнкция по осям', () => {
  const pad = padding(900, 5)
  const metas = [
    ...pad.metas,
    meta(1, ['Roguelike', 'Cozy']), // короткая + расслабленная
    meta(2, ['Roguelike', 'Difficult']), // короткая + напряжённая
    meta(3, ['Open World', 'Cozy']), // длинная + расслабленная
  ]
  const library = [...pad.games, game(1), game(2), game(3)]
  const counts = buildQuizCounts({ library, metaOf: metaOfList(metas), nowSec: NOW })!

  test('одна ось считает всех, кто в её корзине', () => {
    expect(counts['short']).toBe(2) // 1 и 2
    expect(counts['long']).toBe(1) // 3
  })

  test('две оси считают только пересечение', () => {
    expect(counts['short:chill']).toBe(1) // только 1
    expect(counts['short:engaged']).toBe(1) // только 2
    expect(counts['long:chill']).toBe(1) // только 3
    expect(counts['long:engaged']).toBe(0)
  })

  test('игра с обоими вайбами сразу не считается ни за один', () => {
    // противоположный тег гасит совпадение — та же арифметика, что у обложек
    const both = [...pad.metas, meta(1, ['Roguelike', 'Cozy', 'Difficult'])]
    const c = buildQuizCounts({
      library: [...pad.games, game(1)],
      metaOf: metaOfList(both),
      nowSec: NOW,
    })!
    expect(c['short']).toBe(1)
    expect(c['short:chill']).toBe(0)
    expect(c['short:engaged']).toBe(0)
  })

  test('«с друзьями» отсекает одиночные игры', () => {
    const metasMp = [
      ...pad.metas,
      meta(1, ['Roguelike', 'Cozy']),
      meta(2, ['Roguelike', 'Cozy'], { categories: [1] }),
    ]
    const c = buildQuizCounts({
      library: [...pad.games, game(1), game(2)],
      metaOf: metaOfList(metasMp),
      nowSec: NOW,
    })!
    expect(c['short:chill']).toBe(2)
    expect(c['short:chill:solo']).toBe(1)
    expect(c['short:chill:friends']).toBe(1)
  })
})

describe('buildQuizCounts — множество кандидатов', () => {
  const pad = padding(900, 6)

  test('считается бэклог, а не вся библиотека', () => {
    const metas = [
      ...pad.metas,
      meta(1, ['Open World']), // играет прямо сейчас
      meta(2, ['Open World']), // прошёл недавно
      meta(3, ['Open World']), // заброшенная — считается
      meta(4, ['Open World']), // ни разу не запускал — считается
    ]
    const library = [
      ...pad.games,
      game(1, { playtimeForever: 50 * H, playtime2Weeks: 3 * H }),
      game(2, { playtimeForever: 50 * H, lastPlayed: NOW - 10 * DAY }),
      game(3, { playtimeForever: 50 * H, lastPlayed: NOW - 300 * DAY }),
      game(4),
    ]
    const c = buildQuizCounts({ library, metaOf: metaOfList(metas), nowSec: NOW })!
    expect(c['long']).toBe(2)
  })

  test('арт не требуется — это счётчик, а не полка обложек', () => {
    const metas = [...pad.metas, meta(1, ['Open World'], { headerImage: undefined, art: undefined })]
    const c = buildQuizCounts({
      library: [...pad.games, game(1)],
      metaOf: metaOfList(metas),
      nowSec: NOW,
    })!
    expect(c['long']).toBe(1)
  })

  test('мусор и чужие магазины не считаются', () => {
    const metas = [...pad.metas, meta(1, ['Open World']), meta(-2, ['Open World'])]
    const library = [
      ...pad.games,
      { ...game(1), name: 'Nice Game - Soundtrack' },
      { ...game(-2), name: 'Epic Game' },
    ]
    const c = buildQuizCounts({ library, metaOf: metaOfList(metas), nowSec: NOW })!
    expect(c['long']).toBe(0)
  })
})

describe('buildQuizCounts — когда лучше промолчать', () => {
  test('слишком маленький бэклог — числа нет вовсе', () => {
    const metas = [meta(1, ['Open World']), meta(2, ['Open World'])]
    const counts = buildQuizCounts({
      library: [game(1), game(2)],
      metaOf: metaOfList(metas),
      nowSec: NOW,
    })
    expect(counts).toBeNull()
  })

  test('непрогретая библиотека — числа нет вовсе, а не ноль', () => {
    // двадцать игр, мета приехала у пяти: число сказало бы неправду
    const metas = Array.from({ length: 5 }, (_, i) => meta(i + 1, ['Open World']))
    const library = Array.from({ length: 20 }, (_, i) => game(i + 1))
    expect(buildQuizCounts({ library, metaOf: metaOfList(metas), nowSec: NOW })).toBeNull()
  })

  test('пустая библиотека не роняет', () => {
    expect(buildQuizCounts({ library: [], metaOf: () => undefined, nowSec: NOW })).toBeNull()
  })

  test('покрытие считается без учёта чужих магазинов', () => {
    // у записей под отрицательными id меты нет никогда, и они не должны
    // утягивать покрытие вниз до отказа считать
    const pad = padding(900, 6)
    const library = [...pad.games, ...Array.from({ length: 20 }, (_, i) => game(-(i + 1)))]
    expect(buildQuizCounts({ library, metaOf: metaOfList(pad.metas), nowSec: NOW })).not.toBeNull()
  })
})
