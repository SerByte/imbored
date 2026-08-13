import { describe, expect, test } from 'vitest'
import {
  mergeMeta,
  parseAppDetails,
  parseMostPlayed,
  parseSteamSpyTags,
  parseStoreItems,
  parseTagDictionary,
} from './catalog'

const APPDETAILS_RESPONSE = {
  '620': {
    success: true,
    data: {
      type: 'game',
      name: 'Portal 2',
      steam_appid: 620,
      is_free: false,
      short_description: 'The "Perpetual Testing Initiative"...',
      header_image: 'https://cdn.example/620/header.jpg',
      screenshots: [
        { id: 0, path_thumbnail: 't0', path_full: 'https://cdn.example/620/s0.jpg' },
        { id: 1, path_thumbnail: 't1', path_full: 'https://cdn.example/620/s1.jpg' },
      ],
      genres: [{ id: '4', description: 'Casual' }],
      categories: [
        { id: 2, description: 'Single-player' },
        { id: 9, description: 'Co-op' },
      ],
      price_overview: { currency: 'USD', initial: 999, final: 499, discount_percent: 50 },
      release_date: { coming_soon: false, date: '18 Apr, 2011' },
    },
  },
}

describe('parseAppDetails', () => {
  test('извлекает GameMeta из ответа магазина', () => {
    const meta = parseAppDetails(APPDETAILS_RESPONSE, 620)
    expect(meta).toEqual({
      appid: 620,
      name: 'Portal 2',
      tags: {},
      genres: ['Casual'],
      categories: [2, 9],
      shortDescription: 'The "Perpetual Testing Initiative"...',
      headerImage: 'https://cdn.example/620/header.jpg',
      screenshots: ['https://cdn.example/620/s0.jpg', 'https://cdn.example/620/s1.jpg'],
      isFree: false,
      priceFinal: 499,
      releaseDate: '18 Apr, 2011',
    })
  })

  test('success=false или не-игра дают null', () => {
    expect(parseAppDetails({ '99': { success: false } }, 99)).toBeNull()
    expect(
      parseAppDetails({ '77': { success: true, data: { type: 'dlc', name: 'X', steam_appid: 77 } } }, 77),
    ).toBeNull()
  })
})

/** Срез живого ответа IStoreBrowseService/GetItems от 12.08.2026. */
const GETITEMS_RESPONSE = {
  response: {
    store_items: [
      {
        item_type: 0,
        id: 3527290,
        success: 1,
        visible: true,
        name: 'PEAK',
        appid: 3527290,
        type: 0,
        tags: [
          { tagid: 3859, weight: 1002 },
          { tagid: 1685, weight: 800 },
          { tagid: 19, weight: 120 },
        ],
        categories: {
          supported_player_categoryids: [1, 9, 38],
          feature_categoryids: [29, 30],
        },
        reviews: {
          summary_filtered: { review_count: 280867, percent_positive: 94 },
        },
        basic_info: {
          short_description: 'Взберись на гору с друзьями.',
          developers: [{ name: 'Aggro Crab' }],
          publishers: [{ name: 'Aggro Crab' }],
          franchises: [],
        },
        assets: {
          asset_url_format: 'steam/apps/3527290/${FILENAME}?t=1786470571',
          header: '89f65be18915d2dc5566de1de322379d62c1dcac/header_alt_assets_3.jpg',
          main_capsule: 'b233cb6e95308a74fb8dac2cfc1c1cfcf14a20d5/capsule_616x353_alt_assets_3.jpg',
          library_hero: 'd75184257596a3d2b402c58db0ef28844804e952/library_hero.jpg',
        },
        release: { steam_release_date: 1750093261 },
        best_purchase_option: {
          final_price_in_cents: '399',
          original_price_in_cents: '799',
          discount_pct: 50,
        },
      },
      // Несуществующий appid: Valve не роняет батч, а помечает элемент невидимым.
      { item_type: 0, id: 9999999, success: 15, visible: false, name: '' },
    ],
  },
}

const TAG_NAMES = new Map([
  [3859, 'Multiplayer'],
  [1685, 'Co-op'],
  [19, 'Action'],
])

describe('parseTagDictionary', () => {
  test('строит карту id → название из ответа Steam', () => {
    const map = parseTagDictionary([
      { tagid: 492, name: 'Indie' },
      { tagid: 19, name: 'Action' },
    ])
    expect(map.get(492)).toBe('Indie')
    expect(map.size).toBe(2)
  })

  test('мусор не роняет разбор', () => {
    expect(parseTagDictionary(null).size).toBe(0)
    expect(parseTagDictionary([{ tagid: 1 }, { name: 'X' }]).size).toBe(0)
  })
})

describe('parseStoreItems', () => {
  test('собирает GameMeta с тегами по словарю и резолвленной обложкой', () => {
    const metas = parseStoreItems(GETITEMS_RESPONSE, TAG_NAMES)
    expect(metas).toHaveLength(1)
    const m = metas[0]
    expect(m.appid).toBe(3527290)
    expect(m.name).toBe('PEAK')
    expect(m.tags).toEqual({ Multiplayer: 1002, 'Co-op': 800, Action: 120 })
    expect(m.categories).toEqual([1, 9, 38])
    expect(m.shortDescription).toBe('Взберись на гору с друзьями.')
    expect(m.priceFinal).toBe(399)
    expect(m.releaseDate).toBe('2025-06-16')
  })

  test('обложка берётся из ассетов, а не из угаданного шаблона', () => {
    const m = parseStoreItems(GETITEMS_RESPONSE, TAG_NAMES)[0]
    expect(m.headerImage).toBe(
      'https://shared.steamstatic.com/store_item_assets/steam/apps/3527290/89f65be18915d2dc5566de1de322379d62c1dcac/header_alt_assets_3.jpg?t=1786470571',
    )
  })

  test('сохраняются все размеры, включая широкий арт для героя', () => {
    const m = parseStoreItems(GETITEMS_RESPONSE, TAG_NAMES)[0]
    expect(m.art?.hero).toContain('library_hero.jpg')
    expect(m.art?.capsule).toContain('capsule_616x353')
    expect(m.art?.header).toBe(m.headerImage)
  })

  test('невидимые и несуществующие приложения отбрасываются', () => {
    const metas = parseStoreItems(GETITEMS_RESPONSE, TAG_NAMES)
    expect(metas.map((m) => m.appid)).not.toContain(9999999)
  })

  test('тег без названия в словаре пропускается, остальные сохраняются', () => {
    const metas = parseStoreItems(GETITEMS_RESPONSE, new Map([[19, 'Action']]))
    expect(metas[0].tags).toEqual({ Action: 120 })
  })

  test('пустой или битый ответ даёт пустой список', () => {
    expect(parseStoreItems(null, TAG_NAMES)).toEqual([])
    expect(parseStoreItems({ response: {} }, TAG_NAMES)).toEqual([])
  })
})

describe('parseMostPlayed', () => {
  // ISteamChartsService/GetMostPlayedGames — работает без ключа, в отличие от SteamSpy
  const CHARTS = {
    response: {
      rollup_date: 1786406400,
      ranks: [
        { rank: 1, appid: 730, last_week_rank: 1, peak_in_game: 1179493 },
        { rank: 2, appid: 570, last_week_rank: 2, peak_in_game: 620131 },
      ],
    },
  }

  test('извлекает appid в порядке популярности', () => {
    expect(parseMostPlayed(CHARTS)).toEqual([730, 570])
  })

  test('битый ответ даёт пустой список, а не падение', () => {
    expect(parseMostPlayed(null)).toEqual([])
    expect(parseMostPlayed({ response: { ranks: [{ rank: 1 }] } })).toEqual([])
  })
})

describe('mergeMeta', () => {
  const existing = {
    appid: 620,
    name: 'Portal 2',
    tags: { Puzzle: 100 },
    genres: ['Casual'],
    categories: [2],
    screenshots: ['https://cdn.example/s0.jpg'],
    shortDescription: 'старое описание',
    medianForever: 540,
  }

  test('свежие данные побеждают, но накопленное не теряется', () => {
    const fresh = {
      appid: 620,
      name: 'Portal 2',
      tags: { Puzzle: 300, 'Co-op': 250 },
      genres: [],
      categories: [2, 9],
      shortDescription: 'новое описание',
    }
    const merged = mergeMeta(existing, fresh)
    expect(merged.tags).toEqual({ Puzzle: 300, 'Co-op': 250 })
    expect(merged.categories).toEqual([2, 9])
    expect(merged.shortDescription).toBe('новое описание')
    // GetItems не отдаёт скриншоты и медиану — затирать их нельзя
    expect(merged.screenshots).toEqual(['https://cdn.example/s0.jpg'])
    expect(merged.medianForever).toBe(540)
    // жанров в GetItems нет: пустой список не должен стереть накопленные
    expect(merged.genres).toEqual(['Casual'])
  })

  test('пустые теги не затирают уже известные', () => {
    const merged = mergeMeta(existing, {
      appid: 620,
      name: 'Portal 2',
      tags: {},
      genres: [],
      categories: [],
    })
    expect(merged.tags).toEqual({ Puzzle: 100 })
    expect(merged.categories).toEqual([2])
  })

  test('без предыдущей записи возвращает свежую как есть', () => {
    const fresh = { appid: 1, name: 'X', tags: {}, genres: [], categories: [] }
    expect(mergeMeta(null, fresh)).toEqual(fresh)
  })
})

describe('parseSteamSpyTags', () => {
  test('извлекает теги с голосами', () => {
    expect(parseSteamSpyTags({ appid: 620, tags: { Puzzle: 3212, 'Co-op': 2800 } })).toEqual({
      Puzzle: 3212,
      'Co-op': 2800,
    })
  })

  test('SteamSpy отдаёт [] вместо объекта, когда тегов нет', () => {
    expect(parseSteamSpyTags({ appid: 1, tags: [] })).toEqual({})
    expect(parseSteamSpyTags({})).toEqual({})
  })
})
