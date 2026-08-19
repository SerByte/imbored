import { describe, expect, test } from 'vitest'
import { gameJsonLd, ldScript } from './jsonld'
import type { Rating } from './rating'
import type { GameMeta } from './types'

const NOW = 1_700_000_000
const BASE = 'https://imbored.cc'

function game(over: Partial<GameMeta> = {}): GameMeta {
  return {
    appid: 730,
    name: 'Counter-Strike 2',
    tags: { FPS: 100, Shooter: 90 },
    genres: ['Action', 'Free To Play'],
    categories: [1, 9],
    shortDescription: 'Соревновательный шутер.',
    art: { header: 'https://cdn/h.jpg', header2x: 'https://cdn/h2x.jpg' },
    releaseYear: 2012,
    developer: 'Valve',
    publisher: 'Valve',
    ...over,
  }
}

const RATING: Rating = { percent: 86, total: 100, label: 'Very Positive', source: 'summary' }

function ld(over: Partial<GameMeta> = {}, rating: Rating | null = RATING) {
  return gameJsonLd({
    meta: game(over),
    rating,
    baseUrl: BASE,
    currency: 'USD',
    now: NOW,
  })
}

describe('gameJsonLd', () => {
  test('минимальная карточка — это VideoGame с адресом страницы', () => {
    const out = ld()
    expect(out['@context']).toBe('https://schema.org')
    expect(out['@type']).toBe('VideoGame')
    expect(out.name).toBe('Counter-Strike 2')
    expect(out.url).toBe('https://imbored.cc/game/730')
    expect(out.description).toBe('Соревновательный шутер.')
  })

  test('картинка — retina-обложка, потому что она же в og', () => {
    expect(ld().image).toBe('https://cdn/h2x.jpg')
  })

  test('без retina берётся обычная обложка, затем headerImage', () => {
    expect(ld({ art: { header: 'https://cdn/h.jpg' } }).image).toBe('https://cdn/h.jpg')
    expect(ld({ art: undefined, headerImage: 'https://cdn/legacy.jpg' }).image).toBe(
      'https://cdn/legacy.jpg',
    )
    expect(ld({ art: undefined, headerImage: undefined }).image).toBeUndefined()
  })

  test('оценка — тот же процент, что нарисован на странице', () => {
    // 86 из 100 отзывов положительные: на странице кольцо показывает 86 %,
    // и разметка обязана показывать ровно это же число.
    expect(ld().aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 86,
      bestRating: 100,
      worstRating: 0,
      ratingCount: 100,
    })
  })

  test('без отзывов блока оценки нет вовсе', () => {
    expect(ld({}, null).aggregateRating).toBeUndefined()
  })

  test('оценка из каталога размечается так же, как из сводки', () => {
    // 85,5 % карточек живут именно на этом источнике — см. lib/rating.
    expect(ld({}, { percent: 64, total: 5_000, source: 'catalog' }).aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 64,
      bestRating: 100,
      worstRating: 0,
      ratingCount: 5_000,
    })
  })

  test('цена без скидки едет как есть, в долларах', () => {
    const out = ld({ priceFinal: 1999, priceInitial: 1999, priceAt: NOW })
    expect(out.offers).toEqual({
      '@type': 'Offer',
      price: '19.99',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      seller: { '@type': 'Organization', name: 'Steam' },
      url: 'https://store.steampowered.com/app/730/',
    })
  })

  test('живая скидка ставит цену со скидкой и срок её годности', () => {
    const endsAt = NOW + 3 * 86_400
    const out = ld({
      priceFinal: 999,
      priceInitial: 1999,
      discountPercent: 50,
      discountEndsAt: endsAt,
      priceAt: NOW,
    })
    expect(out.offers).toMatchObject({
      price: '9.99',
      priceValidUntil: new Date(endsAt * 1000).toISOString().slice(0, 10),
    })
  })

  test('протухшая скидка не обещает выдаче срок годности цены', () => {
    // Тот же порог доверия, что и у витрины: замер старше PRICE_TRUST_SEC без
    // названного Steam срока скидке не верят. Цена при этом остаётся последней
    // замеренной — ровно её и рисует страница, — а вот priceValidUntil исчезает:
    // это обещание, и подкреплено оно было бы только нашей догадкой.
    const out = ld({
      priceFinal: 999,
      priceInitial: 1999,
      discountPercent: 50,
      priceAt: NOW - 4 * 86_400,
    })
    expect(out.offers).toMatchObject({ price: '9.99' })
    expect(out.offers).not.toHaveProperty('priceValidUntil')
  })

  test('бесплатная игра — это оффер с нулём, а не отсутствие цены', () => {
    expect(ld({ isFree: true, priceFinal: 0 }).offers).toMatchObject({ price: '0.00' })
  })

  test('«бесплатно» сильнее цены: у free-to-play в базе бывает и то и другое', () => {
    // Найдено на живом деплое: у CS2 одновременно is_free = 1 и
    // price_final = 1499 — это цена Prime. Страница рисует «бесплатно»
    // (PriceTag проверяет isFree первым), значит и оффер обязан быть нулевым:
    // расхождение видимого и размеченного стоит расширенного сниппета.
    expect(ld({ isFree: true, priceFinal: 1499, priceInitial: 1499 }).offers).toMatchObject({
      price: '0.00',
    })
  })

  test('скидка не перебивает «бесплатно»', () => {
    const out = ld({
      isFree: true,
      priceFinal: 999,
      priceInitial: 1999,
      discountPercent: 50,
      priceAt: NOW,
    })
    expect(out.offers).toMatchObject({ price: '0.00' })
  })

  test('free-to-play без price_final всё равно получает нулевой оффер', () => {
    // Steam для таких игр price_overview не присылает: в базе NULL, а игра
    // при этом бесплатная. Именно так лежат CS2, Dota 2 и Warframe — верх
    // каталога по онлайну.
    expect(ld({ isFree: true, priceFinal: undefined }).offers).toMatchObject({ price: '0.00' })
  })

  test('про цену ничего не известно — оффера нет', () => {
    expect(ld().offers).toBeUndefined()
  })

  test('чужой магазин уводит оффер на свою страницу', () => {
    const out = ld({
      appid: -12,
      store: 'epic',
      storeUrl: 'https://store.epicgames.com/p/fortnite',
      priceFinal: 0,
      isFree: true,
    })
    expect(out.offers).toMatchObject({
      url: 'https://store.epicgames.com/p/fortnite',
      seller: { '@type': 'Organization', name: 'Epic Games' },
    })
    expect(out.url).toBe('https://imbored.cc/game/-12')
  })

  test('жанры и режимы игры едут списками схемы', () => {
    const out = ld()
    expect(out.genre).toEqual(['Action', 'Free To Play'])
    // categories [1, 9] — Multi-player и Co-op
    expect(out.playMode).toEqual(['MultiPlayer', 'CoOp'])
    expect(out.gamePlatform).toBe('PC')
  })

  test('одиночная игра размечается как SinglePlayer', () => {
    expect(ld({ categories: [2] }).playMode).toEqual(['SinglePlayer'])
  })

  test('незнакомые категории не рождают пустой playMode', () => {
    expect(ld({ categories: [27, 36] }).playMode).toBeUndefined()
  })

  test('без жанров genre собирается из тегов — тех же, что чипсами в герое', () => {
    // В проде genres_json пуст почти везде: каталог собран из поиска магазина,
    // а тот жанров не отдаёт. Теги при этом есть у всех.
    expect(ld({ genres: [], tags: { 'Souls-like': 100, RPG: 90, Difficult: 80 } }).genre).toEqual([
      'Souls-like',
      'RPG',
      'Difficult',
    ])
  })

  test('genre из тегов упорядочен устойчиво: вес, потом имя', () => {
    // Страница пререндерится и кэшируется на сутки — порядок ключей после
    // пересборки каталога не гарантирован, а разметка меняться не должна.
    expect(ld({ genres: [], tags: { Roguelike: 50, Action: 50, Indie: 90 } }).genre).toEqual([
      'Indie',
      'Action',
      'Roguelike',
    ])
  })

  test('больше восьми тегов в genre не едет — их и на странице восемь', () => {
    const tags: Record<string, number> = {}
    for (let i = 0; i < 20; i++) tags['t' + String(i).padStart(2, '0')] = 100 - i
    expect(ld({ genres: [], tags }).genre).toHaveLength(8)
  })

  test('ни жанров, ни тегов — ключа genre нет вовсе', () => {
    expect(ld({ genres: [], tags: {} }).genre).toBeUndefined()
  })

  test('год выхода — это datePublished, потому что точной даты в базе нет', () => {
    expect(ld().datePublished).toBe('2012')
    expect(ld({ releaseYear: undefined }).datePublished).toBeUndefined()
  })

  test('разработчик и издатель — организации', () => {
    const out = ld()
    expect(out.author).toEqual({ '@type': 'Organization', name: 'Valve' })
    expect(out.publisher).toEqual({ '@type': 'Organization', name: 'Valve' })
    expect(ld({ developer: undefined, publisher: undefined }).author).toBeUndefined()
  })

  test('пустых ключей в разметке не остаётся', () => {
    const out = ld({
      shortDescription: undefined,
      art: undefined,
      headerImage: undefined,
      genres: [],
      categories: [],
      releaseYear: undefined,
      developer: undefined,
      publisher: undefined,
    }, null)
    expect(Object.values(out).every((v) => v !== undefined)).toBe(true)
  })
})

describe('ldScript', () => {
  test('закрывающий тег в названии игры не разрывает <script>', () => {
    // Название приезжает из Steam и в разметку попадает без экранирования
    // самим JSON.stringify: «</script>» внутри строки закрыл бы тег.
    const out = ldScript({ name: '</script><img src=x onerror=alert(1)>' })
    expect(out).not.toContain('</script>')
    expect(out).toContain('\\u003c/script\\u003e')
    expect(JSON.parse(out).name).toBe('</script><img src=x onerror=alert(1)>')
  })

  test('обычный текст переживает экранирование без потерь', () => {
    expect(JSON.parse(ldScript({ name: 'Counter-Strike 2' })).name).toBe('Counter-Strike 2')
  })
})
