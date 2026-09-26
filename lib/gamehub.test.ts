import { describe, expect, test } from 'vitest'
import {
  assembleHub,
  HUB_FETCH,
  HUB_GENRES,
  HUB_MIN_SHELF,
  HUB_PAGE,
  HUB_MIN_WEIGHT,
  HUB_SHELF,
  HUB_TAGS,
  hubPath,
  hubTagOf,
  type HubRow,
} from './gamehub'
import { GENERIC_TAGS } from './hook'
import { hasTagRu } from './tagsru'

/** Строки выборки одного тега: игры в том порядке, в каком их отдаёт база */
function rowsOf(tag: string, appids: number[], total = appids.length): HubRow[] {
  return appids.map((appid) => ({
    tag,
    total,
    appid,
    name: `Игра ${appid}`,
    headerImage: null,
    art: null,
  }))
}

const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i)

describe('список полок', () => {
  test('двадцать–тридцать жанров, без повторов', () => {
    expect(HUB_TAGS.length).toBeGreaterThanOrEqual(20)
    expect(HUB_TAGS.length).toBeLessThanOrEqual(30)
    expect(new Set(HUB_TAGS).size).toBe(HUB_TAGS.length)
  })

  test('у каждого жанра есть русская подпись — заголовок полки не встанет по-английски', () => {
    expect(HUB_TAGS.filter((t) => !hasTagRu(t))).toEqual([])
  })

  // Общие теги — это описание половины каталога, а не жанр: полка «Инди»
  // или «Одиночная игра» ничего не говорит о том, что на ней стоит.
  //
  // Исключение — с причиной, как везде в сторожах. Гонки попали в
  // GENERIC_TAGS как жанр Steam: «фишкой» игры жанр не бывает, он у неё и так
  // в жанрах. Но полка — не фишка, а жанр как раз то, что на ней ищут, и
  // Racing узкий: 173 игры из 5827 живых, а не половина каталога.
  test('ни одного общего тега', () => {
    const genreShelves = new Set(['Racing'])
    expect(HUB_TAGS.filter((t) => GENERIC_TAGS.has(t) && !genreShelves.has(t))).toEqual([])
  })

  test('запас кандидатов не меньше полки, порог — доля главного тега', () => {
    expect(HUB_FETCH).toBeGreaterThanOrEqual(HUB_SHELF)
    expect(HUB_MIN_SHELF).toBeLessThanOrEqual(HUB_SHELF)
    expect(HUB_MIN_WEIGHT).toBeGreaterThan(0)
    expect(HUB_MIN_WEIGHT).toBeLessThan(1000)
  })
})

describe('страницы жанров', () => {
  test('у каждой полки своя страница: адрес и заголовок', () => {
    expect(Object.keys(HUB_GENRES).sort()).toEqual([...HUB_TAGS].sort())
  })

  test('адреса — латиницей через дефис, без повторов, и обратно дают тот же тег', () => {
    const slugs = HUB_TAGS.map((t) => HUB_GENRES[t].slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const tag of HUB_TAGS) {
      const { slug } = HUB_GENRES[tag]
      expect(slug, tag).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(hubTagOf(slug), slug).toBe(tag)
      expect(hubPath(tag)).toBe(`/games/${slug}`)
    }
    // амперсанд не теряется: механический перевод дал бы point-click
    expect(hubPath('Point & Click')).toBe('/games/point-and-click')
  })

  test('чужой тег и чужой адрес — null, а не страница', () => {
    expect(hubPath('Indie')).toBeNull()
    expect(hubPath('constructor')).toBeNull()
    expect(hubTagOf('indie')).toBeNull()
    expect(hubTagOf('Open-World')).toBeNull()
    expect(hubTagOf('constructor')).toBeNull()
  })

  test('заголовок — по-русски и с большой буквы', () => {
    for (const tag of HUB_TAGS) expect(HUB_GENRES[tag].title, tag).toMatch(/^[А-ЯЁA-Z]/)
    expect(HUB_PAGE).toBeGreaterThanOrEqual(HUB_SHELF)
  })
})

describe('полки хаба', () => {
  test('полка — первые shelf игр тега, в порядке базы', () => {
    const hub = assembleHub(['A'], rowsOf('A', range(1, 20)), { shelf: 12, minShelf: 6 })
    expect(hub).toHaveLength(1)
    expect(hub[0].tag).toBe('A')
    expect(hub[0].games.map((g) => g.appid)).toEqual(range(1, 12))
  })

  test('на полку едет только игра, служебные поля выборки — нет', () => {
    const [shelf] = assembleHub(['A'], rowsOf('A', range(1, 6)), { minShelf: 1 })
    expect(Object.keys(shelf.games[0]).sort()).toEqual(['appid', 'art', 'headerImage', 'name'])
  })

  test('одна игра — одна полка, и достаётся она более узкому жанру', () => {
    // 1 и 2 стоят в верхушке обоих тегов; у «Узкого» игр вдвое меньше
    const rows = [
      ...rowsOf('Широкий', [1, 2, ...range(100, 10)], 400),
      ...rowsOf('Узкий', [1, 2, ...range(200, 10)], 90),
    ]
    const hub = assembleHub(['Широкий', 'Узкий'], rows, { shelf: 4, minShelf: 2 })
    // показ — в порядке списка, а не в порядке заполнения
    expect(hub.map((s) => s.tag)).toEqual(['Широкий', 'Узкий'])
    expect(hub[1].games.map((g) => g.appid)).toEqual([1, 2, 200, 201])
    expect(hub[0].games.map((g) => g.appid)).toEqual([100, 101, 102, 103])
  })

  test('при равной редкости раньше заполняется полка, что раньше в списке', () => {
    const rows = [...rowsOf('Б', [1, 2, 3], 50), ...rowsOf('А', [1, 4, 5], 50)]
    const hub = assembleHub(['А', 'Б'], rows, { shelf: 2, minShelf: 1 })
    expect(hub.find((s) => s.tag === 'А')?.games.map((g) => g.appid)).toEqual([1, 4])
    expect(hub.find((s) => s.tag === 'Б')?.games.map((g) => g.appid)).toEqual([2, 3])
  })

  test('короткая полка выпадает и возвращает свои игры соседям', () => {
    // У «Редкого» всего две игры: полкой это не будет, и игра 1 обязана
    // достаться «Частому», а не пропасть вместе с несостоявшейся полкой
    const rows = [...rowsOf('Редкий', [1, 2], 2), ...rowsOf('Частый', [1, ...range(10, 5)], 300)]
    const hub = assembleHub(['Частый', 'Редкий'], rows, { shelf: 3, minShelf: 3 })
    expect(hub.map((s) => s.tag)).toEqual(['Частый'])
    expect(hub[0].games.map((g) => g.appid)).toEqual([1, 10, 11])
  })

  test('жанр без строк — просто нет полки; строки чужих тегов не читаются', () => {
    const rows = [...rowsOf('Есть', range(1, 8)), ...rowsOf('Чужой', range(50, 8))]
    const hub = assembleHub(['Пустой', 'Есть'], rows)
    expect(hub.map((s) => s.tag)).toEqual(['Есть'])
    expect(hub[0].games.every((g) => g.appid < 50)).toBe(true)
  })

  test('пустая выборка — пустой хаб, а не исключение', () => {
    expect(assembleHub(HUB_TAGS, [])).toEqual([])
  })

  test('по умолчанию полка — HUB_SHELF, короче HUB_MIN_SHELF не показывается', () => {
    const hub = assembleHub(
      ['Полная', 'Куцая'],
      [...rowsOf('Полная', range(1, HUB_FETCH)), ...rowsOf('Куцая', range(100, HUB_MIN_SHELF - 1))],
    )
    expect(hub.map((s) => s.tag)).toEqual(['Полная'])
    expect(hub[0].games).toHaveLength(HUB_SHELF)
  })
})
