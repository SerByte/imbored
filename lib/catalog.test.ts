import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getGameMeta, migrateDb, upsertGameMeta } from './db'
import {
  fetchAppDetails,
  fetchStoreItems,
  fetchStoreMedia,
  parseStoreMedia,
  mergeMeta,
  parseAppDetails,
  parseMostPlayed,
  parsePurchaseOption,
  parseStoreItems,
  parseTagDictionary,
  fetchTagDictionary,
  ensureMeta,
  parseStoreDescriptions,
  resetTagDictCache,
  englishDescription,
} from './catalog'
import type { GameMeta } from './types'

/*
 * Словарь тегов кэшируется на модуле. Без сброса тест языков получал словарь,
 * оставленный прогревом медиа ниже по файлу, и проходил только потому, что
 * объявлен выше него: перемешай порядок (--sequence.shuffle.tests) — и он
 * краснел, читаясь как поломка кэша. Сброс на уровне файла, а не одного
 * describe: прогрев, ensureMeta и регион тоже ходят за словарём.
 */
beforeEach(() => {
  resetTagDictCache()
})

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
      // регион этой цены и «продаётся»: цена в ответе — значит, в магазине есть
      priceCc: 'us',
      storeHidden: false,
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

describe('fetchTagDictionary', () => {
  /*
   * Кэш общий на процесс. Когда он был один на все языки, русский словарь,
   * спрошенный первым, возвращался и прогреву — а тот пишет имена тегов в
   * tags_json ключами, и Roguelike в базе становился «Рогаликом».
   */
  test('у каждого языка свой запрос и свой кэш', async () => {
    const urls: string[] = []
    const fake = (async (url: string) => {
      urls.push(url)
      const name = url.endsWith('/russian') ? 'Рогалик' : 'Roguelike'
      return new Response(JSON.stringify([{ tagid: 1716, name }]))
    }) as unknown as typeof fetch

    const ru = await fetchTagDictionary(fake, 'russian')
    const en = await fetchTagDictionary(fake)
    expect(ru.get(1716)).toBe('Рогалик')
    expect(en.get(1716)).toBe('Roguelike')
    // второй заход за тем же языком — из кэша
    expect((await fetchTagDictionary(fake, 'russian')).get(1716)).toBe('Рогалик')
    expect(urls).toEqual([
      'https://store.steampowered.com/tagdata/populartags/russian',
      'https://store.steampowered.com/tagdata/populartags/english',
    ])
  })

  test('пустой словарь — исключение, а не «тегов нет»', async () => {
    const empty = (async () => new Response('[]', { status: 200 })) as unknown as typeof fetch
    await expect(fetchTagDictionary(empty)).rejects.toThrow('populartags/english')
    // и не кэшируется: следующий заход спросит снова
    const ok = (async () => new Response(JSON.stringify([{ tagid: 19, name: 'Action' }]))) as unknown as typeof fetch
    expect((await fetchTagDictionary(ok)).get(19)).toBe('Action')
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

  test('без флагов медиа полей кадров и трейлера нет вовсе — не пустые', () => {
    // Пустое поле апсерт тоже не записал бы (keepFilledSql), но mergeMeta
    // отдал бы его вместо накопленного: отсутствие и пустота — разное
    const m = parseStoreItems(GETITEMS_RESPONSE, TAG_NAMES)[0]
    expect(m).not.toHaveProperty('screenshots')
    expect(m).not.toHaveProperty('trailer')
  })

  test('с флагами медиа приезжают кадры и трейлер', () => {
    const metas = parseStoreItems(MEDIA_RESPONSE, TAG_NAMES)
    const cs2 = metas.find((m) => m.appid === 730)
    expect(cs2?.screenshots?.[0]).toMatch(/\.1920x1080\.jpg\?t=\d+$/)
    expect(cs2?.trailer?.mp4).toMatch(/\/730\/.+\/microtrailer\.mp4$/)
    // у Half-Life трейлеров нет — поля нет, а кадры есть
    const hl = metas.find((m) => m.appid === 70)
    expect(hl).not.toHaveProperty('trailer')
    expect(hl?.screenshots?.length).toBeGreaterThan(0)
  })
})

/** Настоящий ответ GetItems с кадрами и трейлерами — см. lib/trailer.test.ts */
const MEDIA_RESPONSE: unknown = JSON.parse(
  readFileSync(path.join(__dirname, '__fixtures__', 'getitems-media.json'), 'utf8'),
)

describe('кадры и трейлеры из GetItems', () => {
  /** Стаб, который помнит data_request каждого запроса GetItems */
  function recording(body: unknown) {
    const requests: Array<Record<string, unknown>> = []
    const fetchFn = (async (url: string) => {
      if (String(url).includes('populartags')) {
        return new Response(JSON.stringify([{ tagid: 19, name: 'Action' }]), { status: 200 })
      }
      const input = new URL(String(url)).searchParams.get('input_json') ?? '{}'
      requests.push((JSON.parse(input) as { data_request: Record<string, unknown> }).data_request)
      return new Response(JSON.stringify(body), { status: 200 })
    }) as unknown as typeof fetch
    return { fetchFn, requests }
  }

  test('прогрев медиа не просит — ответ втрое тяжелее; промоут просит', async () => {
    const plain = recording(MEDIA_RESPONSE)
    await fetchStoreItems([730], { fetchFn: plain.fetchFn })
    expect(plain.requests[0]).not.toHaveProperty('include_trailers')
    expect(plain.requests[0]).not.toHaveProperty('include_screenshots')

    const media = recording(MEDIA_RESPONSE)
    const metas = await fetchStoreItems([730], { fetchFn: media.fetchFn, media: true })
    expect(media.requests[0]).toMatchObject({
      include_trailers: true,
      include_screenshots: true,
      include_assets: true,
      include_tag_count: 20,
    })
    expect(metas.find((m) => m.appid === 730)?.trailer).toBeDefined()
  })

  test('fetchStoreMedia: только флаги карточки и только игры, у которых что-то нашлось', async () => {
    const rec = recording(MEDIA_RESPONSE)
    const got = await fetchStoreMedia([730, 70, -5], { fetchFn: rec.fetchFn })
    // Кадры, трейлеры и языки — и ничего из прогрева: ни тегов, ни арта, ни
    // цены. Языки едут тем же запросом, см. STORE_MEDIA_DATA_REQUEST
    expect(rec.requests).toEqual([
      { include_screenshots: true, include_trailers: true, include_supported_languages: true },
    ])
    expect(got.get(730)?.trailer?.poster).toMatch(/movie_full\.jpg/)
    expect(got.get(70)?.trailer).toBeUndefined()
    expect(got.get(70)?.screenshots?.length).toBeGreaterThan(0)
    // отрицательный appid (другой магазин) в Steam не спрашиваем вовсе
    expect(await fetchStoreMedia([-5], { fetchFn: rec.fetchFn })).toEqual(new Map())
    expect(rec.requests).toHaveLength(1)
  })

  test('parseStoreMedia: невидимые и пустые пропускаются, мусор — пустая карта', () => {
    const got = parseStoreMedia({
      response: {
        store_items: [
          { appid: 1, visible: true },
          { appid: 2, visible: false, screenshots: { all_ages_screenshots: [{ filename: 'steam/apps/2/a.jpg' }] } },
        ],
      },
    })
    expect(got.size).toBe(0)
    expect(parseStoreMedia(null).size).toBe(0)
    expect(parseStoreMedia({ response: { store_items: 'нет' } }).size).toBe(0)
  })
})

/** Настоящий ответ GetItems с языками: CS2, Hades, Cyberpunk 2077, Apex, Balatro */
const LANGUAGES_RESPONSE: unknown = JSON.parse(
  readFileSync(path.join(__dirname, '__fixtures__', 'getitems-languages.json'), 'utf8'),
)

describe('русский язык из GetItems', () => {
  const ruOf = (json: unknown) =>
    new Map(parseStoreItems(json, TAG_NAMES).map((m) => [m.appid, m.ruLang]))

  test('ступень — самое сильное из трёх отметок Steam', () => {
    const ru = ruOf(LANGUAGES_RESPONSE)
    // CS2: русский интерфейс без озвучки и субтитров
    expect(ru.get(730)).toBe(1)
    // Hades: субтитры, озвучка только английская
    expect(ru.get(1145360)).toBe(2)
    // Cyberpunk 2077: полная озвучка и субтитры
    expect(ru.get(1091500)).toBe(3)
    // Apex Legends: озвучка без субтитров — всё равно озвучка
    expect(ru.get(1172470)).toBe(3)
    // Balatro: двенадцать языков, русского среди них нет — это ответ, а не «не знаем»
    expect(ru.get(2379780)).toBe(0)
  })

  test('без флага языков поля нет вовсе — «не знаем», а не «нет русского»', () => {
    // Прогрев языков не просит: ноль здесь стёр бы известное и повесил бы
    // «Без русского» на игру с полной озвучкой
    const m = parseStoreItems(GETITEMS_RESPONSE, TAG_NAMES)[0]
    expect(m).not.toHaveProperty('ruLang')
  })

  test('русский — только elanguage 8; номер 8 в дополнительных языках — другой язык', () => {
    // У Factorio в ответе есть и { elanguage: 8 }, и { elanguage: -1,
    // eadditionallanguage: 8 }: у дополнительных языков своя нумерация
    const item = (langs: unknown) => ({
      response: { store_items: [{ appid: 5, visible: true, name: 'X', supported_languages: langs }] },
    })
    const only = [
      { elanguage: 0, eadditionallanguage: -1, supported: true, full_audio: true, subtitles: true },
      { elanguage: -1, eadditionallanguage: 8, supported: true, full_audio: true, subtitles: true },
    ]
    expect(ruOf(item(only)).get(5)).toBe(0)
  })

  test('пустой список и мусор — «не знаем»; русский без единой отметки — «нет»', () => {
    const item = (langs: unknown) => ({
      response: { store_items: [{ appid: 5, visible: true, name: 'X', supported_languages: langs }] },
    })
    // Пустой список ничего не утверждает: судить «русского нет» не по чему
    expect(ruOf(item([])).get(5)).toBeUndefined()
    expect(ruOf(item('нет')).get(5)).toBeUndefined()
    expect(ruOf(item([null, 7])).get(5)).toBeUndefined()
    expect(
      ruOf(
        item([
          { elanguage: 0, supported: true },
          { elanguage: 8, supported: false, full_audio: false, subtitles: false },
        ]),
      ).get(5),
    ).toBe(0)
  })

  test('карточка и промоут просят языки, прогрев — нет: +46% к его ответу', async () => {
    const requests: Array<Record<string, unknown>> = []
    const fetchFn = (async (url: string) => {
      if (String(url).includes('populartags')) {
        return new Response(JSON.stringify([{ tagid: 19, name: 'Action' }]), { status: 200 })
      }
      const input = new URL(String(url)).searchParams.get('input_json') ?? '{}'
      requests.push((JSON.parse(input) as { data_request: Record<string, unknown> }).data_request)
      return new Response(JSON.stringify(LANGUAGES_RESPONSE), { status: 200 })
    }) as unknown as typeof fetch

    await fetchStoreItems([730], { fetchFn })
    expect(requests[0]).not.toHaveProperty('include_supported_languages')

    const promoted = await fetchStoreItems([730, 1145360], { fetchFn, media: true })
    expect(requests[1]).toMatchObject({ include_supported_languages: true, include_assets: true })
    expect(promoted.find((m) => m.appid === 1145360)?.ruLang).toBe(2)

    const media = await fetchStoreMedia([730, 2379780], { fetchFn })
    expect(requests[2]).toMatchObject({ include_supported_languages: true })
    // У этих игр в ответе ни кадров, ни трейлера — но язык есть, и это повод
    // записать строку: ноль у Balatro тоже знание
    expect(media.get(730)).toEqual({ ruLang: 1 })
    expect(media.get(2379780)).toEqual({ ruLang: 0 })
  })
})

describe('русский язык из appdetails', () => {
  const withLangs = (supported_languages: unknown) =>
    parseAppDetails(
      { '9': { success: true, data: { type: 'game', name: 'X', supported_languages } } },
      9,
    )

  test('звёздочка у русского — полная озвучка', () => {
    // Строка Cyberpunk 2077 с l=russian, как её отдаёт fetchAppDetails
    const s =
      'английский<strong>*</strong>, французский<strong>*</strong>, русский<strong>*</strong>, ' +
      'китайский (упр.)<strong>*</strong>, украинский<br><strong>*</strong>озвучивание доступно на этих языках'
    expect(withLangs(s)?.ruLang).toBe(3)
  })

  test('русского в списке нет — «нет»; белорусский русским не считается', () => {
    // Balatro
    expect(withLangs('английский, французский, японский, польский, китайский (трад.)')?.ruLang).toBe(0)
    expect(withLangs('английский, белорусский<strong>*</strong>, украинский')?.ruLang).toBe(0)
  })

  test('русский без звёздочки — не знаем: appdetails не отличает интерфейс от субтитров', () => {
    // Hades: в GetItems у русского субтитры, а здесь та же строка была бы и у
    // CS2 с одним интерфейсом. Догадка «1» затёрла бы точную «2» из GetItems
    // при слиянии в кроне карточек — молчание её сохраняет
    const s =
      'английский<strong>*</strong>, французский, русский, японский<br><strong>*</strong>озвучивание доступно на этих языках'
    expect(withLangs(s)).not.toHaveProperty('ruLang')
  })

  test('английская локаль тоже читается; пусто и мусор — не знаем', () => {
    expect(withLangs('English<strong>*</strong>, Russian<strong>*</strong>')?.ruLang).toBe(3)
    expect(withLangs('English, German')?.ruLang).toBe(0)
    expect(withLangs('')).not.toHaveProperty('ruLang')
    expect(withLangs(42)).not.toHaveProperty('ruLang')
    expect(withLangs(undefined)).not.toHaveProperty('ruLang')
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

  test('русский: ответ без языков известное не стирает, ответ с языками — побеждает', () => {
    const known: GameMeta = { ...existing, ruLang: 3 }
    // прогрев языков не просит — поля в свежей записи нет
    expect(mergeMeta(known, { appid: 620, name: 'Portal 2', tags: {}, genres: [], categories: [] }).ruLang).toBe(3)
    // ноль — это ответ Steam («русского нет»), а не пустота
    expect(
      mergeMeta(known, { appid: 620, name: 'Portal 2', tags: {}, genres: [], categories: [], ruLang: 0 }).ruLang,
    ).toBe(0)
  })

  describe('описание: русское не заменяется нерусским', () => {
    const РУС = 'Более двух десятилетий Counter-Strike служит примером'
    const АНГ = 'For over two decades, Counter-Strike has offered'
    const с = (shortDescription?: string) => ({
      appid: 730,
      name: 'Counter-Strike 2',
      tags: { FPS: 100 },
      genres: [],
      categories: [1],
      ...(shortDescription === undefined ? {} : { shortDescription }),
    })

    test('прогрев с английским не откатывает обогащённое русское', () => {
      expect(mergeMeta(с(РУС), с(АНГ)).shortDescription).toBe(РУС)
    })

    test('пустое и отсутствующее тоже не стирают русское', () => {
      expect(mergeMeta(с(РУС), с('')).shortDescription).toBe(РУС)
      expect(mergeMeta(с(РУС), с()).shortDescription).toBe(РУС)
    })

    test('английское английским и английское русским едут как прежде', () => {
      expect(mergeMeta(с(АНГ), с('Another English text')).shortDescription).toBe('Another English text')
      expect(mergeMeta(с(АНГ), с(РУС)).shortDescription).toBe(РУС)
    })

    test('русское русским едет — переводы в Steam правят', () => {
      expect(mergeMeta(с(РУС), с('Новый перевод')).shortDescription).toBe('Новый перевод')
    })
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
    // 300 — АКЦИОННАЯ цена (было 1000): без скидки рядом trustedPrice показал
    // бы её обычной, поэтому она уходит вместе со скидкой — «не знаю». Раньше
    // здесь было закреплено priceFinal 300, то есть ровно эта подмена
    expect(stored?.priceFinal).toBeUndefined()
    expect(stored?.priceInitial).toBeUndefined()
  })

  test('ответ без блока покупки бережёт обычную цену: «не назвал» и «подешевела» неразличимы', async () => {
    const db = await migrateDb(createClient({ url: ':memory:' }))
    await upsertGameMeta(
      db,
      {
        appid: 1145360,
        name: 'Hades',
        tags: { Action: 100 },
        genres: [],
        categories: [2],
        priceFinal: 2499,
        priceInitial: 2499,
        discountPercent: 0,
        priceAt: NOW - 20 * 86_400,
        art: { header: 'https://example/1145360.jpg' },
      },
      NOW - 20 * 86_400,
    )
    // бандл «лучшим предложением» — parsePurchaseOption отдаёт {}
    await ensureMeta(db, [1145360], {
      fetchFn: storeStub([
        { appid: 1145360, id: 1145360, name: 'Hades', visible: true, best_purchase_option: { bundleid: 1, final_price_in_cents: '3999' } },
      ]),
    })
    const stored = await getGameMeta(db, 1145360)
    expect(stored).toMatchObject({ priceFinal: 2499, priceInitial: 2499, discountPercent: 0 })
  })

  test('прогрев раз в две недели не кладёт английское описание поверх русского', async () => {
    // Русское кладёт обогащение карточки (appdetails с l=russian) и вернётся
    // к нему через полгода; прогрев ходит в GetItems по-английски
    const db = await migrateDb(createClient({ url: ':memory:' }))
    const РУС = 'Более двух десятилетий Counter-Strike служит примером'
    await upsertGameMeta(
      db,
      {
        appid: 730,
        name: 'Counter-Strike 2',
        tags: { Action: 100 },
        genres: ['Экшены'],
        categories: [1],
        shortDescription: РУС,
        screenshots: ['https://cdn.example/730-0.jpg'],
        art: { header: 'https://example/730.jpg' },
      },
      NOW - 20 * 86_400,
    )

    await ensureMeta(db, [730], {
      fetchFn: storeStub([
        {
          appid: 730,
          id: 730,
          name: 'Counter-Strike 2',
          visible: true,
          basic_info: { short_description: 'For over two decades, Counter-Strike has offered' },
        },
      ]),
    })

    const stored = await getGameMeta(db, 730)
    expect(stored?.shortDescription).toBe(РУС)
    expect(stored?.screenshots).toEqual(['https://cdn.example/730-0.jpg'])
    expect(stored?.genres).toEqual(['Экшены'])
  })

  /**
   * Сбой Steam не роняет запрос, но и не молчит: по false /api/prepare отдаёт
   * stalled, и прогрев перестаёт спрашивать тот же остаток по кругу.
   */
  test('Steam не отдал пачку — false и ни одной записи; разобрали или нечего — true', async () => {
    const db = await migrateDb(createClient({ url: ':memory:' }))
    const old = NOW - 20 * 86_400
    await upsertGameMeta(db, { appid: 730, name: 'App 730', tags: {}, genres: [], categories: [] }, old)
    const limited = (async () => new Response('', { status: 429 })) as unknown as typeof fetch

    expect(await ensureMeta(db, [730], { fetchFn: limited })).toBe(false)
    expect((await getGameMeta(db, 730))?.name).toBe('App 730')

    const ok = storeStub([{ appid: 730, id: 730, name: 'Counter-Strike 2', visible: true }])
    expect(await ensureMeta(db, [730], { fetchFn: ok })).toBe(true)
    expect((await getGameMeta(db, 730))?.name).toBe('Counter-Strike 2')

    // догружать нечего — это не сбой, даже если Steam сейчас лежит
    expect(await ensureMeta(db, [730], { fetchFn: limited })).toBe(true)
  })

  /**
   * Сбой сервисного метода Steam приходит тем же 200: пустой response, а код —
   * только в X-eresult (см. fetchWishlist в lib/steam.ts). Прочитанный как
   * ответ, он значил «Steam не показывает ни одной из двухсот»: новые игры
   * библиотеки ложились заглушками без тегов и категорий, старые «App N»
   * оставались «App N», и всем им ставилась свежесть на две недели — а true
   * гнал прогрев за следующей пачкой, так что за пару вызовов заглушками
   * становилась вся библиотека.
   */
  test('200 с пустым response — сбой, а не «Steam их не показывает»: false и ни одной записи', async () => {
    const db = await migrateDb(createClient({ url: ':memory:' }))
    const old = NOW - 20 * 86_400
    await upsertGameMeta(db, { appid: 730, name: 'App 730', tags: {}, genres: [], categories: [] }, old)
    const emptyAnswer = (eresult: string | null) =>
      (async (url: string) => {
        if (String(url).includes('populartags')) {
          return new Response(JSON.stringify([{ tagid: 19, name: 'Action' }]), { status: 200 })
        }
        const headers: Record<string, string> = eresult === null ? {} : { 'x-eresult': eresult }
        return new Response(JSON.stringify({ response: {} }), { status: 200, headers })
      }) as unknown as typeof fetch
    const updatedAt = async (appid: number) =>
      (await db.execute({ sql: 'SELECT updated_at FROM games WHERE appid = ?', args: [appid] })).rows[0]
        ?.updated_at

    // 20 — Busy: код сбоя есть, тело пустое
    const names = new Map([[1145360, 'Hades']])
    expect(await ensureMeta(db, [730, 1145360], { fetchFn: emptyAnswer('20'), names })).toBe(false)
    expect(await getGameMeta(db, 1145360)).toBeNull()
    expect(await updatedAt(730)).toBe(old)

    // Заголовка нет, а store_items нет тоже: тело без списка — форма сбоя,
    // а не ответа. «Никого не знаю» приходит списком, пусть и пустым (тест ниже)
    expect(await ensureMeta(db, [730, 1145360], { fetchFn: emptyAnswer(null), names })).toBe(false)
    expect(await getGameMeta(db, 1145360)).toBeNull()
    expect(await updatedAt(730)).toBe(old)
  })

  /**
   * Пустой список — ответ: Steam промолчал про игру (снята с продажи). На
   * запрос из одной игры — последней в прогреве — «про часть пачки» и «про
   * всю» одно и то же, и сочти мы это сбоем, ensureMeta отдавал бы false
   * вечно: remaining > 0 навсегда, /api/prepare без цен и онлайна, прогрев
   * у клиента всякий раз кончается stalled.
   */
  test('пустой список на одну игру — ответ: заглушка с отметкой, true', async () => {
    const db = await migrateDb(createClient({ url: ':memory:' }))
    const old = NOW - 20 * 86_400
    await upsertGameMeta(db, { appid: 1145360, name: 'Hades', tags: {}, genres: [], categories: [] }, old)

    expect(await ensureMeta(db, [1145360], { fetchFn: storeStub([]) })).toBe(true)
    const row = await db.execute({ sql: 'SELECT updated_at FROM games WHERE appid = ?', args: [1145360] })
    expect(Number(row.rows[0]?.updated_at)).toBeGreaterThan(old)
    expect(await getGameMeta(db, 1145360)).toMatchObject({ name: 'Hades', art: {} })
    // и из очереди прогрева она ушла: следующий заход в Steam не идёт вовсе
    const limited = (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch
    expect(await ensureMeta(db, [1145360], { fetchFn: limited })).toBe(true)
  })

  test('X-eresult 1 — обычный ответ: строка пишется', async () => {
    const db = await migrateDb(createClient({ url: ':memory:' }))
    const fetchFn = (async (url: string) => {
      if (String(url).includes('populartags')) {
        return new Response(JSON.stringify([{ tagid: 19, name: 'Action' }]), { status: 200 })
      }
      const body = { response: { store_items: [{ appid: 730, id: 730, name: 'Counter-Strike 2', visible: true }] } }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'x-eresult': '1' } })
    }) as unknown as typeof fetch
    expect(await ensureMeta(db, [730], { fetchFn })).toBe(true)
    expect((await getGameMeta(db, 730))?.name).toBe('Counter-Strike 2')
  })

  /**
   * Пустой словарь тегов — та же беда другой дорогой: игры легли бы с
   * tags {} и свежестью на две недели, мимо всех таблиц подбора.
   */
  test('словарь тегов пришёл пустым — false и ни одной записи', async () => {
    const db = await migrateDb(createClient({ url: ':memory:' }))
    const fetchFn = (async (url: string) => {
      if (String(url).includes('populartags')) return new Response('[]', { status: 200 })
      const body = { response: { store_items: [{ appid: 730, id: 730, name: 'Counter-Strike 2', visible: true, tags: [{ tagid: 19, weight: 100 }] }] } }
      return new Response(JSON.stringify(body), { status: 200 })
    }) as unknown as typeof fetch
    expect(await ensureMeta(db, [730], { fetchFn })).toBe(false)
    expect(await getGameMeta(db, 730)).toBeNull()
  })
})

describe('parseStoreDescriptions', () => {
  test('берёт описания по appid и пропускает пустые', () => {
    const json = {
      response: {
        store_items: [
          { appid: 10, basic_info: { short_description: 'Соревновательный шутер.' } },
          { id: 20, basic_info: { short_description: 'Кооперативное выживание.' } },
          { appid: 30, basic_info: { short_description: '   ' } },
          { appid: 40, basic_info: {} },
          { appid: 50 },
        ],
      },
    }
    const m = parseStoreDescriptions(json)
    expect(m.size).toBe(2)
    expect(m.get(10)).toBe('Соревновательный шутер.')
    expect(m.get(20)).toBe('Кооперативное выживание.')
  })

  test('мусор на входе — пустая карта, а не исключение', () => {
    // Ответ Steam без ожидаемой формы не должен ронять сборку каталога.
    expect(parseStoreDescriptions(null).size).toBe(0)
    expect(parseStoreDescriptions({}).size).toBe(0)
    expect(parseStoreDescriptions({ response: {} }).size).toBe(0)
    expect(parseStoreDescriptions({ response: { store_items: 'нет' } }).size).toBe(0)
  })
})

/**
 * Два региона (lib/steamregion): метаданные, отзывы и appdetails — всегда из
 * `us`, цены — из STEAM_STORE_CC. В российском магазине часть игр не видна
 * вовсе, и одна переменная на оба сломала бы каталог: прогрев сделал бы им
 * заглушки «App N», крон карточек — пустые карточки.
 */
describe('регион запросов к магазину', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  /** Стаб, который помнит адрес и context каждого запроса */
  function recording(items: unknown[]) {
    const contexts: Array<Record<string, unknown>> = []
    const urls: string[] = []
    const fetchFn = (async (url: string) => {
      urls.push(String(url))
      if (String(url).includes('populartags')) {
        return new Response(JSON.stringify([{ tagid: 19, name: 'Action' }]), { status: 200 })
      }
      if (String(url).includes('appdetails')) {
        return new Response(JSON.stringify(APPDETAILS_RESPONSE), { status: 200 })
      }
      const input = new URL(String(url)).searchParams.get('input_json') ?? '{}'
      contexts.push((JSON.parse(input) as { context: Record<string, unknown> }).context)
      return new Response(JSON.stringify({ response: { store_items: items } }), { status: 200 })
    }) as unknown as typeof fetch
    return { fetchFn, contexts, urls }
  }

  const BG3 = {
    appid: 1086940,
    id: 1086940,
    name: "Baldur's Gate 3",
    visible: true,
    best_purchase_option: { final_price_in_cents: '5999' },
  }

  test('цены из ru: метаданные всё равно из US, а долларовая цена в мету не попадает', async () => {
    vi.stubEnv('STEAM_STORE_CC', 'ru')
    const rec = recording([BG3])
    const [meta] = await fetchStoreItems([1086940], { fetchFn: rec.fetchFn })
    expect(rec.contexts.map((c) => c.country_code)).toEqual(['US'])
    expect(meta.name).toBe("Baldur's Gate 3")
    for (const key of ['priceFinal', 'priceInitial', 'discountPercent', 'discountEndsAt', 'priceAt', 'priceCc']) {
      expect(meta, key).not.toHaveProperty(key)
    }
  })

  test('цены из us: та же пачка несёт датированную цену со своим регионом', async () => {
    vi.stubEnv('STEAM_STORE_CC', 'us')
    const rec = recording([BG3])
    const before = Math.floor(Date.now() / 1000)
    const [meta] = await fetchStoreItems([1086940], { fetchFn: rec.fetchFn })
    expect(meta).toMatchObject({ priceFinal: 5999, priceCc: 'us', storeHidden: false, discountPercent: 0 })
    expect(meta.priceAt).toBeGreaterThanOrEqual(before)
  })

  test('appdetails всегда из us: при ценах из ru карточка приезжает без цены', async () => {
    vi.stubEnv('STEAM_STORE_CC', 'ru')
    const rec = recording([])
    const meta = await fetchAppDetails(620, rec.fetchFn)
    expect(rec.urls[0]).toContain('cc=us')
    expect(meta?.name).toBe('Portal 2')
    expect(meta).not.toHaveProperty('priceFinal')
    expect(meta).not.toHaveProperty('priceCc')
  })

  test('appdetails в чужой валюте ценой региона не считается', () => {
    // Steam назначает валюту и по адресу запроса: ответ в рублях при регионе
    // us — не цена американского магазина
    const rub = {
      '620': {
        success: true,
        data: {
          type: 'game',
          name: 'Portal 2',
          price_overview: { currency: 'RUB', initial: 39_900, final: 39_900, discount_percent: 0 },
        },
      },
    }
    expect(parseAppDetails(rub, 620)).not.toHaveProperty('priceFinal')
    expect(parseAppDetails(APPDETAILS_RESPONSE, 620)?.priceFinal).toBe(499)
  })
})

/**
 * Английское описание — свой слот (shortDescriptionEn), а не потеря.
 *
 * Прогрев ходит в GetItems по-английски, и правило «русское не заменяется
 * нерусским» его текст раньше просто выбрасывало. Для /en это самый частый
 * и дешёвый источник английского описания, и теперь он ложится рядом.
 */
describe('описание по-английски', () => {
  const РУС = 'Более двух десятилетий Counter-Strike служит примером'
  const АНГ = 'For over two decades, Counter-Strike has offered'
  const с = (over: Partial<GameMeta> = {}): GameMeta => ({
    appid: 730,
    name: 'Counter-Strike 2',
    tags: { FPS: 100 },
    genres: [],
    categories: [1],
    ...over,
  })

  test('прогрев с английским: русское остаётся, английское — в своём слоте', () => {
    const merged = mergeMeta(с({ shortDescription: РУС }), с({ shortDescription: АНГ }))
    expect(merged.shortDescription).toBe(РУС)
    expect(merged.shortDescriptionEn).toBe(АНГ)
    expect(/[А-Яа-яЁё]/.test(merged.shortDescriptionEn!)).toBe(false)
  })

  test('новая запись с английским описанием получает слот сразу', () => {
    expect(mergeMeta(null, с({ shortDescription: АНГ })).shortDescriptionEn).toBe(АНГ)
    // русское описание слота не создаёт: английского в нём нет
    expect(mergeMeta(null, с({ shortDescription: РУС }))).not.toHaveProperty('shortDescriptionEn')
  })

  test('appdetails по-русски не стирает английский слот', () => {
    const merged = mergeMeta(с({ shortDescription: АНГ, shortDescriptionEn: АНГ }), с({ shortDescription: РУС }))
    expect(merged).toMatchObject({ shortDescription: РУС, shortDescriptionEn: АНГ })
  })

  test('текст студии не по-английски в слот не идёт', () => {
    expect(mergeMeta(null, с({ shortDescription: '反恐精英：全球攻势的续作。' }))).not.toHaveProperty(
      'shortDescriptionEn',
    )
  })

  test('русское описание с латинскими именами — не английское, и слот оно не затирает', () => {
    // appdetails ходит с l=russian, и его русский текст по большинству букв
    // бывает латиницей: названия, студии, режимы. Раньше такое описание
    // ложилось в английский слот поверх настоящего и уезжало на /en
    const латинские = [
      "Tom Clancy's Rainbow Six® Siege X — тактический шутер.",
      'Warhammer 40,000: Space Marine 2 — экшен от Saber Interactive и Focus Entertainment.',
      'Counter-Strike 2: Free-to-play, Premier, CS Rating и новые карты.',
    ]
    for (const text of латинские) {
      expect(englishDescription(text), text).toBeUndefined()
      const merged = mergeMeta(с({ shortDescription: РУС, shortDescriptionEn: АНГ }), с({ shortDescription: text }))
      expect(merged.shortDescriptionEn, text).toBe(АНГ)
    }
  })

  test('китайский, японский, корейский и немецкий текст студии — не английский', () => {
    const чужие = [
      '一款以三国为背景的 RPG 游戏，支持 Steam 创意工坊。',
      'これはアクションRPGです。Steam版。',
      '한국어 MMORPG 게임 PvP',
      'Ein düsteres Abenteuer in einer Welt voller Gefahren und Geheimnisse.',
      'Una aventura épica en un mundo abierto lleno de peligros y secretos.',
    ]
    for (const text of чужие) {
      expect(englishDescription(text), text).toBeUndefined()
      expect(mergeMeta(с({ shortDescription: РУС }), с({ shortDescription: text })), text).not.toHaveProperty(
        'shortDescriptionEn',
      )
      const media = parseStoreMedia({
        response: { store_items: [{ appid: 99, visible: true, basic_info: { short_description: text } }] },
      })
      expect(media.get(99)?.shortDescriptionEn, text).toBeUndefined()
    }
    // а английский с именами собственными — английский
    expect(englishDescription('Explore the sunny metropolis of Los Santos with your crew.')).toBe(
      'Explore the sunny metropolis of Los Santos with your crew.',
    )
  })

  test('крон карточек просит описание тем же походом за медиа, доливка — нет', async () => {
    const requests: Array<Record<string, unknown>> = []
    const fetchFn = (async (url: string) => {
      const input = new URL(String(url)).searchParams.get('input_json') ?? '{}'
      requests.push((JSON.parse(input) as { data_request: Record<string, unknown> }).data_request)
      const body = {
        response: {
          store_items: [
            { appid: 730, visible: true, basic_info: { short_description: ` ${АНГ} ` } },
            { appid: 10, visible: true, basic_info: { short_description: РУС } },
          ],
        },
      }
      return new Response(JSON.stringify(body), { status: 200 })
    }) as unknown as typeof fetch

    const got = await fetchStoreMedia([730, 10], { fetchFn, description: true })
    expect(requests[0]).toEqual({
      include_screenshots: true,
      include_trailers: true,
      include_supported_languages: true,
      include_basic_info: true,
    })
    // описание — единственная находка у 730, и ради неё строка есть
    expect(got.get(730)).toEqual({ shortDescriptionEn: АНГ })
    // русский текст в английский слот не идёт — и записывать игре нечего
    expect(got.has(10)).toBe(false)

    await fetchStoreMedia([730], { fetchFn })
    expect(requests[1]).not.toHaveProperty('include_basic_info')
  })
})
