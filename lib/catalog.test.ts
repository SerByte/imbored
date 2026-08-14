import { createClient } from '@libsql/client'
import { describe, expect, test } from 'vitest'
import { getGameMeta, migrateDb, upsertGameMeta } from './db'
import {
  mergeMeta,
  parseAppDetails,
  parseMostPlayed,
  parsePurchaseOption,
  parseSteamSpyTags,
  parseStoreItems,
  parseTagDictionary,
  ensureMeta,
} from './catalog'
import type { GameMeta } from './types'

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
      priceInitial: 999,
      discountPercent: 50,
      releaseDate: '18 Apr, 2011',
    })
  })

  test('без распродажи скидка равна нулю, а не отсутствует', () => {
    const meta = parseAppDetails(
      {
        '7': {
          success: true,
          data: {
            type: 'game',
            name: 'Полная цена',
            price_overview: { currency: 'USD', initial: 1999, final: 1999, discount_percent: 0 },
          },
        },
      },
      7,
    )
    // Явный ноль — это ответ «распродажи нет», и он обязан доехать до записи:
    // на нём гасится вчерашняя скидка, см. ON CONFLICT в upsertGameMeta
    expect(meta?.discountPercent).toBe(0)
    expect(meta?.priceInitial).toBe(1999)
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

  test('издатель и разработчик сохраняются — по ним определяется серия', () => {
    const m = parseStoreItems(GETITEMS_RESPONSE, TAG_NAMES)[0]
    expect(m.developer).toBe('Aggro Crab')
    expect(m.publisher).toBe('Aggro Crab')
  })

  test('скидка доезжает вместе с ценой, а не теряется по дороге', () => {
    const m = parseStoreItems(GETITEMS_RESPONSE, TAG_NAMES)[0]
    expect(m.priceFinal).toBe(399)
    expect(m.priceInitial).toBe(799)
    expect(m.discountPercent).toBe(50)
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

describe('parsePurchaseOption', () => {
  test('распродажа: цена, старая цена, процент и срок', () => {
    // Срез живого ответа: цены приходят строками, срок — в active_discounts
    expect(
      parsePurchaseOption({
        final_price_in_cents: '974',
        original_price_in_cents: '1499',
        discount_pct: 35,
        active_discounts: [{ discount_end_date: 1_787_850_009 }],
      }),
    ).toEqual({
      priceFinal: 974,
      priceInitial: 1499,
      discountPercent: 35,
      discountEndsAt: 1_787_850_009,
    })
  })

  test('полная цена: скидка приходит явным нулём', () => {
    // Steam при полной цене не присылает ни discount_pct, ни original_price.
    // Если так же промолчать при записи, в базе останется вчерашняя скидка —
    // у кончившейся распродажи нет своего события, есть только этот ответ.
    expect(parsePurchaseOption({ final_price_in_cents: '1499' })).toEqual({
      priceFinal: 1499,
      priceInitial: 1499,
      discountPercent: 0,
    })
  })

  test('из нескольких акций берётся самая ранняя — на ней цена и вырастет', () => {
    const info = parsePurchaseOption({
      final_price_in_cents: '100',
      original_price_in_cents: '200',
      discount_pct: 50,
      active_discounts: [{ discount_end_date: 300 }, { discount_end_date: 200 }],
    })
    expect(info.discountEndsAt).toBe(200)
  })

  test('вариант-бандл не выдаётся за цену игры', () => {
    // Срез живого ответа 14.08.2026: «лучшим» предложением для Drug Dealer
    // Simulator 2 Steam называет набор «Thieves'n'Dealers» за $24.10 вместо
    // $40.48 — с честным discount_pct: 40. Сама игра при этом стоит полную
    // цену, и «−40%» на её карточке было бы обещанием чужого ценника.
    expect(
      parsePurchaseOption({
        bundleid: 42237,
        purchase_option_name: "Thieves'n'Dealers",
        final_price_in_cents: '2410',
        original_price_in_cents: '4048',
        discount_pct: 40,
      } as Parameters<typeof parsePurchaseOption>[0]),
    ).toEqual({})
  })

  test('бандл без скидки тоже не цена игры', () => {
    // Forever Skies: Deluxe Edition за $16.00 при цене игры $29.99
    expect(
      parsePurchaseOption({
        bundleid: 52538,
        final_price_in_cents: '1600',
      } as Parameters<typeof parsePurchaseOption>[0]),
    ).toEqual({})
  })

  test('обычная покупка пакетом — цена игры, её берём', () => {
    expect(
      parsePurchaseOption({
        packageid: 82712,
        final_price_in_cents: '1499',
      } as Parameters<typeof parsePurchaseOption>[0]),
    ).toEqual({ priceFinal: 1499, priceInitial: 1499, discountPercent: 0 })
  })

  test('нет блока покупки — нет и цены: free-to-play и снятое с продажи', () => {
    expect(parsePurchaseOption(undefined)).toEqual({})
    expect(parsePurchaseOption({ final_price_in_cents: 'не число' })).toEqual({})
  })

  test('процент без реальной разницы в цене игнорируется', () => {
    // Защита от битой строки: «−50%» при равных ценах — не скидка
    const info = parsePurchaseOption({
      final_price_in_cents: '500',
      original_price_in_cents: '500',
      discount_pct: 50,
      active_discounts: [{ discount_end_date: 999 }],
    })
    expect(info.discountPercent).toBe(0)
    expect(info.discountEndsAt).toBeUndefined()
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

describe('ensureMeta', () => {
  const NOW = 1_700_000_000

  /** Стаб магазина: словарь тегов и ответ GetItems по одному и тому же fetch */
  function storeStub(items: unknown[]): typeof fetch {
    return (async (url: string) => {
      if (String(url).includes('populartags')) {
        return new Response(JSON.stringify([{ tagid: 19, name: 'Action' }]), { status: 200 })
      }
      return new Response(JSON.stringify({ response: { store_items: items } }), { status: 200 })
    }) as unknown as typeof fetch
  }

  test('игра стала бесплатной — вчерашняя скидка гаснет, а не переезжает в новую запись', async () => {
    // mergeMeta переносит в новую запись всё, чего нет в свежем ответе. Для
    // скидки это означало «−70%» навсегда: у кончившейся акции нет своего
    // события, есть только ответ Steam без блока покупки.
    const db = await migrateDb(createClient({ url: ':memory:' }))
    const stale: GameMeta = {
      appid: 730,
      name: 'Counter-Strike 2',
      tags: { Action: 100 },
      genres: [],
      categories: [1],
      priceFinal: 300,
      priceInitial: 1000,
      discountPercent: 70,
      priceAt: NOW,
      art: { header: 'https://example/730.jpg' },
    }
    await upsertGameMeta(db, stale, NOW - 20 * 86_400)

    await ensureMeta(db, [730], {
      fetchFn: storeStub([
        { appid: 730, id: 730, name: 'Counter-Strike 2', visible: true, is_free: true },
      ]),
    })

    const stored = await getGameMeta(db, 730)
    expect(stored?.discountPercent).toBe(0)
    expect(stored?.isFree).toBe(true)
    // цена остаётся: «Steam не назвал цену» и «игра подешевела» неразличимы
    expect(stored?.priceFinal).toBe(300)
  })
})
