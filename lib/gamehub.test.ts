import { describe, expect, test } from 'vitest'
import {
  assembleHub,
  facetPath,
  HUB_FACETS,
  HUB_FETCH,
  HUB_GENRES,
  HUB_MIN_SHELF,
  HUB_PAGE,
  HUB_MIN_WEIGHT,
  HUB_SHELF,
  HUB_TAGS,
  hubFacetOf,
  hubPath,
  hubTagOf,
  playsAgainst,
  inGenre,
  primaryGenre,
  SHORT_SESSION_MIN,
  storedTagWeights,
  TAGS_PER_GAME,
  type HubRow,
} from './gamehub'
import { sessionTrait, VERSUS_TAGS } from './gametraits'
import { GENERIC_TAGS } from './hook'
import { hasTagRu } from './tagsru'
import type { GameSemantics } from './types'

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

describe('главный жанр игры', () => {
  test('самый весомый из жанров со своей страницей', () => {
    expect(primaryGenre({ Action: 2000, Roguelike: 1800, 'Action Roguelike': 1700, Indie: 900 })).toBe('Roguelike')
  })

  test('жанр-метка не главный: легче половины главного тега — пути нет', () => {
    // у CS2 Tactical 453 при FPS 1000 — ровно тот случай из HUB_MIN_WEIGHT
    expect(primaryGenre({ Shooter: 1000, Tactical: 453, Cozy: 400 })).toBeNull()
    expect(primaryGenre({ Shooter: 1000, FPS: 500 })).toBe('FPS')
  })

  test('только среди двенадцати верхних тегов, как в game_tags', () => {
    const tags: Record<string, number> = {}
    for (let i = 0; i < 12; i++) tags[`Tag ${i}`] = 1000 - i
    tags.Roguelike = 700
    expect(primaryGenre(tags)).toBeNull()
  })

  test('порог — на том же округлённом числе, что в game_tags', () => {
    // 1001 / 2003 = 499,75 → в каталоге 500: игра стоит на странице жанра,
    // значит, и путь над названием ведёт туда же
    expect(storedTagWeights({ Action: 2003, Roguelike: 1001 })).toEqual([
      { tag: 'Action', weight: 1000 },
      { tag: 'Roguelike', weight: 500 },
    ])
    expect(primaryGenre({ Action: 2003, Roguelike: 1001 })).toBe('Roguelike')
  })

  test('при равных голосах — порядок тегов у игры, как в каталоге', () => {
    expect(primaryGenre({ Survival: 1000, 'Open World': 1000 })).toBe('Survival')
    expect(storedTagWeights({ B: 5, A: 5 }).map((t) => t.tag)).toEqual(['B', 'A'])
  })

  test('в game_tags — двенадцать верхних', () => {
    const tags: Record<string, number> = {}
    for (let i = 0; i < 20; i++) tags[`T${i}`] = 100 - i
    expect(storedTagWeights(tags)).toHaveLength(TAGS_PER_GAME)
  })

  test('пустые и нулевые теги — null', () => {
    expect(primaryGenre({})).toBeNull()
    expect(primaryGenre({ Roguelike: 0 })).toBeNull()
  })
})

/*
 * «Стоит ли на странице жанра» — правило, которым выдача «Подобрать рогалики
 * из своей библиотеки» отбирает свои (genre в lib/candidates). Не только
 * главный: у игры может быть два жанра, и на обеих страницах она стоит.
 */
describe('игра в жанре', () => {
  test('не легче половины главного и среди двенадцати — в жанре', () => {
    expect(inGenre({ Action: 1000, Roguelike: 900 }, 'Roguelike')).toBe(true)
    expect(inGenre({ Action: 1000, Roguelike: 499 }, 'Roguelike')).toBe(false)
    // тот же порог, что у главного жанра: CS2 — не «тактика»
    expect(inGenre({ Shooter: 1000, Tactical: 453 }, 'Tactical')).toBe(false)
    // двенадцать тегов тяжелее — Roguelike уходит за край game_tags
    const tail: Record<string, number> = { Roguelike: 990 }
    for (let i = 0; i < TAGS_PER_GAME; i++) tail[`Heavy${i}`] = 1000 + i
    expect(inGenre(tail, 'Roguelike')).toBe(false)
    expect(inGenre(undefined, 'Roguelike')).toBe(false)
    expect(inGenre({}, 'Roguelike')).toBe(false)
  })

  test('главный жанр игры — всегда и её жанр', () => {
    const tags = { Action: 2000, Roguelike: 1800, 'Action Roguelike': 1700, Indie: 900 }
    expect(inGenre(tags, primaryGenre(tags)!)).toBe(true)
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

describe('подборки по факту: /games/coop, /games/split-screen, /games/free, /games/short', () => {
  /*
   * Подборка живёт под тем же /games/<slug>, что и жанр, и тем же сегментом
   * (app/games/[tag]): совпади адрес подборки с адресом жанра — одна из двух
   * страниц пропала бы молча, а карта сайта назвала бы адрес дважды.
   */
  test('адреса — латиницей через дефис, без повторов и не совпадают с жанрами', () => {
    const slugs = HUB_FACETS.map((f) => f.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    const genres = new Set(Object.values(HUB_GENRES).map((g) => g.slug))
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(genres.has(slug), slug).toBe(false)
      expect(hubTagOf(slug), slug).toBeNull()
    }
  })

  test('адрес обратно даёт ту же подборку; чужой — null', () => {
    for (const f of HUB_FACETS) {
      expect(hubFacetOf(f.slug)).toBe(f)
      expect(facetPath(f)).toBe(`/games/${f.slug}`)
    }
    expect(hubFacetOf('roguelike')).toBeNull()
    expect(hubFacetOf('constructor')).toBeNull()
    expect(hubFacetOf('Coop')).toBeNull()
  })

  test('четыре подборки: с другом, на одном экране, бесплатные, на двадцать минут', () => {
    expect(HUB_FACETS.map((f) => f.slug)).toEqual(['coop', 'split-screen', 'free', 'short'])
  })

  test('тексты по-русски и с большой буквы; основание списка названо', () => {
    for (const f of HUB_FACETS) {
      expect(f.title, f.slug).toMatch(/^[А-ЯЁ]/)
      expect(f.heading.startsWith(f.title), f.slug).toBe(true)
      expect(f.label, f.slug).toMatch(/^[А-ЯЁ]/)
      // основание — продолжение фразы «40 игр — …», со строчной и с точкой в конце
      expect(f.basis, f.slug).toMatch(/^[а-яё].{40,}\.$/)
    }
  })

  test('«с другом» — кооператив Steam, без соперничества; «на одном экране» — и кооп, и дуэли', () => {
    const coop = hubFacetOf('coop')!
    expect(coop.query).toEqual({ kind: 'categories', ids: [9, 38] })
    expect(coop.drop).toBe('versus')
    expect(coop.party).toBe(true)
    const split = hubFacetOf('split-screen')!
    expect(split.query).toEqual({ kind: 'categories', ids: [24, 37, 39] })
    // диван с двумя геймпадами — это и Cuphead вдвоём, и TEKKEN друг против друга
    expect(split.drop).toBeUndefined()
    expect(split.party).toBe(true)
  })

  test('«на 20 минут» — заход короче получаса и не матч; бесплатные — по отметке Steam', () => {
    const short = hubFacetOf('short')!
    expect(short.query).toEqual({ kind: 'session', belowMinutes: SHORT_SESSION_MIN })
    expect(short.drop).toBe('match')
    expect(short.party).toBe(false)
    // минуты — теги, уточнённые отзывами, а не «по отзывам»: так и сказано
    expect(short.basis).toContain('по тегам и разобранным отзывам')
    expect(short.basis).not.toMatch(/сессия по отзывам/)
    expect(hubFacetOf('free')!.query).toEqual({ kind: 'free' })
  })
})

describe('играют ли друг против друга (playsAgainst)', () => {
  /*
   * Голоса тегов — как они лежат в tags_json у живых игр каталога, верхушки
   * «Кооператива» по отзывам (выписаны 13 октября). Правило сравнивает
   * суммы: и соперничество, и кооператив у игры размазаны по нескольким тегам.
   */
  const DOTA = {
    'Free to Play': 3010, MOBA: 1019, Multiplayer: 778, Strategy: 723, eSports: 598, 'Team-Based': 554,
    Competitive: 422, Action: 401, 'Online Co-Op': 378, PvP: 308, Difficult: 275, 'Co-op': 220,
  }
  const SIEGE = {
    FPS: 733, PvP: 678, Multiplayer: 673, Shooter: 672, Tactical: 671, eSports: 668, Competitive: 663,
    'Online Co-Op': 660, Action: 658, 'Hero Shooter': 655, 'Team-Based': 418, 'Co-op': 363,
  }
  const IT_TAKES_TWO = {
    'Co-op': 1486, Multiplayer: 1078, 'Split Screen': 892, 'Local Co-Op': 864, 'Online Co-Op': 733,
    Puzzle: 681, Adventure: 564, 'Story Rich': 468, 'Co-op Campaign': 407,
  }
  const DIVINITY_2 = {
    'Tactical RPG': 670, RPG: 670, 'Turn-Based Strategy': 657, 'Story Rich': 641, Fantasy: 630,
    'Character Customization': 624, CRPG: 623, Exploration: 615, 'Party-Based RPG': 611, 'Strategy RPG': 590,
    PvP: 563, 'Female Protagonist': 554, 'Co-op Campaign': 367, 'Local Co-Op': 336, 'Choices Matter': 324,
  }
  const TEKKEN_7 = {
    Fighting: 1976, Action: 1040, Multiplayer: 994, Competitive: 782, Arcade: 730, 'Local Multiplayer': 621,
    Controller: 510, '3D Fighter': 429, Singleplayer: 374, eSports: 350,
  }

  test('Dota 2 и Rainbow Six: за соперничество голосов больше — не «с другом»', () => {
    expect(playsAgainst(DOTA)).toBe(true)
    expect(playsAgainst(SIEGE)).toBe(true)
  })

  test('It Takes Two, HELLDIVERS 2 и Sea of Thieves — кооператив главнее', () => {
    expect(playsAgainst(IT_TAKES_TWO)).toBe(false)
    expect(playsAgainst({ 'Online Co-Op': 1000, PvE: 896, 'Co-op': 689, 'Third-Person Shooter': 600 })).toBe(false)
    // PvP есть, но кооператив перевешивает: корабль на двоих против моря
    expect(playsAgainst({ Adventure: 1000, 'Co-op': 727, 'Online Co-Op': 686, PvP: 616, Pirates: 600 })).toBe(false)
  })

  /*
   * Ради этого случая правило — суммой по всем тегам. Самым весомым из
   * двенадцати верхних (окно game_tags) Divinity уходила: её PvP-арена стоит
   * одиннадцатой, а оба кооперативных тега — тринадцатым и четырнадцатым.
   */
  test('Divinity: Original Sin 2 — кооператив за окном двенадцати тегов всё равно считается', () => {
    expect(playsAgainst(DIVINITY_2)).toBe(false)
  })

  test('файтинг — друг против друга', () => {
    expect(playsAgainst(TEKKEN_7)).toBe(true)
  })

  /*
   * Словарь соперничества — один с «Матчем» карточки (VERSUS_TAGS в
   * lib/gametraits). Своя копия здесь уже расходилась: в ней не было «Online
   * PvP» и тегов файтинга, и тег, дописанный для карточки, подборку не трогал.
   */
  test('каждый тег соперничества карточки весит и здесь', () => {
    expect(VERSUS_TAGS.size).toBeGreaterThan(0)
    for (const tag of VERSUS_TAGS) {
      expect(playsAgainst({ [tag]: 2, 'Co-op': 1 }), tag).toBe(true)
      expect(playsAgainst({ [tag]: 1, 'Co-op': 2 }), tag).toBe(false)
    }
  })

  /*
   * Ради чего общий словарь сдвинул подборку: на выгрузке прода от 24.09.2026
   * из восьмидесяти верхних «кооперативных» — одна игра, Brawlhalla. По
   * старой копии (Fighting и eSports) кооператив у неё перевешивал.
   */
  test('Brawlhalla — платформенный файтинг: «2D Fighter» тоже соперничество', () => {
    expect(
      playsAgainst({
        'Free to Play': 962, Multiplayer: 700, Fighting: 668, '2D Fighter': 513, '2D Platformer': 489,
        Casual: 468, 'Local Multiplayer': 462, Platformer: 458, 'Co-op': 457, Controller: 457, Action: 447,
        'Local Co-Op': 446, 'Online Co-Op': 444, Fantasy: 438, '4 Player Local': 436, 'Family Friendly': 431,
        eSports: 431, Cartoony: 430, Singleplayer: 429, Indie: 423,
      }),
    ).toBe(true)
  })

  /*
   * Вопросы разные, и разногласие подборки с карточкой бывает только в одну
   * сторону: «с другом» оставляет командную игру против людей, а карточка
   * зовёт её заход «Матчем» — и то и другое правда. Кампания на двоих матчем
   * не бывает нигде.
   */
  test('кампания на двоих — «с другом» и «Сессия»; командная против людей — «с другом» и «Матч»', () => {
    const semantics: GameSemantics = {
      v: 1,
      axes: { challenge: 50, complexity: 50, pace: 50 },
      session: { bucket: 'medium', minutes: 40, canStopAnytime: false },
      timeToFun: { bucket: null, hours: null },
      confidence: 0.7,
      n: 60,
      basis: 'tags+reviews',
    }
    expect(playsAgainst(IT_TAKES_TWO)).toBe(false)
    expect(sessionTrait({ semantics, categories: [1, 9, 38, 39, 24], tags: IT_TAKES_TWO })?.label).toBe('Сессия')
    const squad = { Horror: 1000, 'Online Co-Op': 900, Survival: 800, PvP: 600 }
    expect(playsAgainst(squad)).toBe(false)
    expect(sessionTrait({ semantics, categories: [1, 49, 36, 9, 38], tags: squad })?.label).toBe('Матч')
  })

  test('нет ни соперничества, ни кооператива в тегах — решают категории, не мешаем', () => {
    expect(playsAgainst({ Survival: 1000, Crafting: 800, 'Open World': 700 })).toBe(false)
    expect(playsAgainst({})).toBe(false)
  })
})
