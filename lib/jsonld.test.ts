import { describe, expect, test } from 'vitest'
import {
  gameBreadcrumbLd,
  gameJsonLd,
  genreBreadcrumbLd,
  genreItemListLd,
  ldScript,
  patchArticleLd,
  patchBreadcrumbLd,
  websiteJsonLd,
} from './jsonld'
import { SITE_DESCRIPTION, siteDescription } from './site'
import { regionCurrency } from './steamregion'
import { tagRu } from './tagsru'
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

function ld(over: Partial<GameMeta> = {}) {
  return gameJsonLd({
    meta: game(over),
    baseUrl: BASE,
    currency: 'USD',
    now: NOW,
  })
}

describe('gameJsonLd', () => {
  test('русский в игре есть — inLanguage ru; нет или не знаем — поля нет', () => {
    // Карточка в это же время показывает строку «Русский: …» (languageTrait):
    // разметка говорит то же, что видно, и не больше
    expect(ld({ ruLang: 1 }).inLanguage).toBe('ru')
    expect(ld({ ruLang: 3 }).inLanguage).toBe('ru')
    // «нет» — не повод назвать другой язык: остальных мы не храним
    expect(ld({ ruLang: 0 })).not.toHaveProperty('inLanguage')
    expect(ld()).not.toHaveProperty('inLanguage')
  })

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

  test('оценки Steam в разметке нет — даже у игры с тысячами отзывов', () => {
    // Доля положительных — отзывы Steam, а не наших посетителей. Правила
    // Google для review snippet прямо запрещают размечать оценки, собранные
    // на другом сайте; на пяти тысячах шаблонных страниц это узор ручной
    // санкции за «spammy structured markup», которая снимает и крошки, и
    // статьи патчей. Кольцо на странице остаётся — уходит только разметка.
    const out = ld({ reviewsTotal: 120_000, reviewsPercent: 86 })
    expect('aggregateRating' in out).toBe(false)
    expect(JSON.stringify(out)).not.toMatch(/Rating|review/i)
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

  test('живая скидка без названного срока не обещает выдаче priceValidUntil', () => {
    // Срок ставим только названный самим Steam: без него discountOf держит
    // скидку на доверии к возрасту замера, а такому сроку в выдаче не место —
    // priceValidUntil это обещание, а не оценка.
    const out = ld({
      priceFinal: 999,
      priceInitial: 1999,
      discountPercent: 50,
      priceAt: NOW,
    })
    expect(out.offers).toMatchObject({ price: '9.99' })
    expect(out.offers).not.toHaveProperty('priceValidUntil')
  })

  test('сгоревшая скидка убирает оффер целиком, а не только процент', () => {
    // price_final при заявленной скидке — акционное число. У Heavy Rain в
    // проде стояло $0.99 при настоящих $19.99; отдать такое в выдачу хуже,
    // чем показать на странице: Offer живёт в индексе дольше страницы.
    const out = ld({
      priceFinal: 99,
      priceInitial: 1999,
      discountPercent: 95,
      discountEndsAt: NOW - 1,
      priceAt: NOW,
    })
    expect(out.offers).toBeUndefined()
  })

  test('протухший замер скидки тоже убирает оффер', () => {
    const out = ld({
      priceFinal: 999,
      priceInitial: 1999,
      discountPercent: 50,
      priceAt: NOW - 4 * 86_400,
    })
    expect(out.offers).toBeUndefined()
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

  test('валюта оффера — валюта региона цены: рубли размечаются рублями', () => {
    const out = gameJsonLd({
      meta: game({ appid: 1086940, priceFinal: 199_900, priceCc: 'ru' }),
      baseUrl: BASE,
      currency: regionCurrency('ru'),
      now: NOW,
    })
    expect(out.offers).toMatchObject({ price: '1999.00', priceCurrency: 'RUB' })
  })

  test('«не продаётся в регионе» — оффера нет, даже бесплатного', () => {
    // InStock про игру, которую в этом магазине не взять, был бы неправдой, а
    // страница пишет «не продаётся в российском Steam»
    expect(ld({ storeHidden: true, priceCc: 'ru' }).offers).toBeUndefined()
    expect(ld({ storeHidden: true, isFree: true }).offers).toBeUndefined()
  })

  test('про цену ничего не известно — оффера нет', () => {
    expect(ld().offers).toBeUndefined()
  })

  test('ноль без «бесплатно» — не цена, а её отсутствие: оффера нет', () => {
    // Поиск магазина кладёт «0» в data-price-final игре, у которой цены нет
    // вовсе (снята с продажи, делист): так в базе лежат Ori and the Blind
    // Forest и Call of Duty, is_free у них пуст. Герой карточки такую цену не
    // рисует (условие «price > 0» в app/game/[appid]/page.tsx), и разметка
    // не вправе сказать больше — иначе в выдаче платная игра «бесплатна».
    expect(ld({ priceFinal: 0 }).offers).toBeUndefined()
    expect(
      ld({ isFree: false, priceFinal: 0, priceInitial: 0, discountPercent: 0, priceAt: NOW }).offers,
    ).toBeUndefined()
  })

  test('раздача −100% — оффера нет, как нет и строки цены у героя', () => {
    // discountOf честно отдаёт такую скидку (finalCents 0), но страница
    // прячет строку цены целиком — вместе с процентом и сроком. Разметка
    // идёт за страницей, а не за скидкой
    const out = ld({
      priceFinal: 0,
      priceInitial: 1999,
      discountPercent: 100,
      discountEndsAt: NOW + 86_400,
      priceAt: NOW,
    })
    expect(out.offers).toBeUndefined()
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
    // а тот жанров не отдаёт. Теги при этом есть у всех — и на чипсах они
    // русскими подписями, значит, и в разметке тоже
    expect(ld({ genres: [], tags: { 'Souls-like': 100, RPG: 90, Difficult: 80 } }).genre).toEqual(
      ['Souls-like', 'RPG', 'Difficult'].map(tagRu),
    )
  })

  test('genre из тегов упорядочен устойчиво: вес, потом имя', () => {
    // Страница пререндерится и кэшируется на неделю — порядок ключей после
    // пересборки каталога не гарантирован, а разметка меняться не должна.
    // Имя — английский ключ: порядок решается до перевода
    expect(ld({ genres: [], tags: { Roguelike: 50, Action: 50, Indie: 90 } }).genre).toEqual(
      ['Indie', 'Action', 'Roguelike'].map(tagRu),
    )
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
    })
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

describe('gameBreadcrumbLd', () => {
  test('главная → игра, полными адресами, и игра — тот же адрес, что у VideoGame', () => {
    const out = gameBreadcrumbLd({ meta: game(), baseUrl: BASE })
    expect(out['@type']).toBe('BreadcrumbList')
    expect(out.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'imbored', item: 'https://imbored.cc/' },
      { '@type': 'ListItem', position: 2, name: 'Counter-Strike 2', item: ld().url },
    ])
  })

  test('с главным жанром — через «Игры по жанрам» и жанр, как в строке над названием', () => {
    const out = gameBreadcrumbLd({
      meta: game(),
      baseUrl: BASE,
      genre: { title: 'Шутеры от первого лица', path: '/games/fps' },
    })
    expect(out.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'imbored', item: 'https://imbored.cc/' },
      { '@type': 'ListItem', position: 2, name: 'Игры по жанрам', item: 'https://imbored.cc/games' },
      { '@type': 'ListItem', position: 3, name: 'Шутеры от первого лица', item: 'https://imbored.cc/games/fps' },
      { '@type': 'ListItem', position: 4, name: 'Counter-Strike 2', item: ld().url },
    ])
  })
})

describe('websiteJsonLd', () => {
  test('сайт — WebSite с именем, адресом главной и тем же описанием, что в метаданных', () => {
    expect(websiteJsonLd(BASE)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'imbored',
      url: 'https://imbored.cc/',
      inLanguage: 'ru',
      description: SITE_DESCRIPTION,
    })
  })
})

describe('ldScript со списком сущностей', () => {
  test('массив переживает экранирование и остаётся валидным JSON', () => {
    const out = ldScript([ld({ name: '</script>' }), gameBreadcrumbLd({ meta: game({ name: '</script>' }), baseUrl: BASE })])
    expect(out).not.toContain('</script>')
    const parsed = JSON.parse(out) as Array<{ '@type': string }>
    expect(parsed.map((e) => e['@type'])).toEqual(['VideoGame', 'BreadcrumbList'])
  })
})

describe('страница жанра', () => {
  test('крошки: главная → игры по жанрам → жанр, как в строке над заголовком', () => {
    const out = genreBreadcrumbLd({ title: 'Рогалики', path: '/games/roguelike', baseUrl: 'https://imbored.cc' })
    expect(out.itemListElement.map((i) => [i.position, i.name, i.item])).toEqual([
      [1, 'imbored', 'https://imbored.cc/'],
      [2, 'Игры по жанрам', 'https://imbored.cc/games'],
      [3, 'Рогалики', 'https://imbored.cc/games/roguelike'],
    ])
  })

  test('список — в порядке страницы, с позициями с единицы и числом игр', () => {
    const out = genreItemListLd({
      title: 'Рогалики',
      games: [
        { appid: 1145360, name: 'Hades' },
        { appid: 646570, name: 'Slay the Spire' },
      ],
      baseUrl: 'https://imbored.cc',
    })
    expect(out.numberOfItems).toBe(2)
    expect(out.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, url: 'https://imbored.cc/game/1145360', name: 'Hades' },
      { '@type': 'ListItem', position: 2, url: 'https://imbored.cc/game/646570', name: 'Slay the Spire' },
    ])
  })
})

describe('страница патча', () => {
  const item = {
    appid: 730,
    gid: '5123894512345',
    title: 'Counter-Strike 2: Release Notes for 9/25/2026',
    url: 'https://store.steampowered.com/news/app/730/view/5123894512345',
    publishedAt: Date.parse('2026-09-25T18:00:00Z') / 1000,
    tldr: 'Поправили баланс AWP и карту Mirage.',
    imageUrl: 'https://clan.cloudflare.steamstatic.com/images/1/abc.png',
  }

  test('статья — только из видимого: заголовок как в h1, пересказ, кадр, игра, оригинал', () => {
    const out = patchArticleLd({ item, game: { name: 'Counter-Strike 2' }, baseUrl: BASE })
    expect(out).toMatchObject({
      '@type': 'NewsArticle',
      url: 'https://imbored.cc/game/730/news/5123894512345',
      mainEntityOfPage: 'https://imbored.cc/game/730/news/5123894512345',
      datePublished: '2026-09-25T18:00:00.000Z',
      inLanguage: 'ru',
      description: item.tldr,
      image: [item.imageUrl],
      about: { '@type': 'VideoGame', name: 'Counter-Strike 2', url: 'https://imbored.cc/game/730' },
      isBasedOn: item.url,
    })
    // название игры в заголовке не повторяется — как в h1 (newsHeading)
    expect(out.headline).not.toMatch(/^Counter-Strike 2:/)
  })

  test('нет пересказа, кадра или игры — нет и полей', () => {
    const out = patchArticleLd({ item: { ...item, tldr: null, imageUrl: null }, game: null, baseUrl: BASE })
    expect(out).not.toHaveProperty('description')
    expect(out).not.toHaveProperty('image')
    expect(out).not.toHaveProperty('about')
  })

  test('крошки: главная → игра → патч; без игры — два уровня', () => {
    const withGame = patchBreadcrumbLd({ item, game: { name: 'Counter-Strike 2' }, baseUrl: BASE })
    expect(withGame.itemListElement.map((i) => i.item)).toEqual([
      'https://imbored.cc/',
      'https://imbored.cc/game/730',
      'https://imbored.cc/game/730/news/5123894512345',
    ])
    expect(patchBreadcrumbLd({ item, game: null, baseUrl: BASE }).itemListElement).toHaveLength(2)
  })
})

/**
 * Разметка /en-страницы обязана называть ту же страницу, что её canonical
 * (/en/…). Русский url и mainEntityOfPage при английском canonical — две
 * разные страницы для робота.
 */
describe('адреса разметки на языке страницы', () => {
  const item = {
    appid: 730,
    gid: '5123894512345',
    title: 'Counter-Strike 2: Release Notes for 9/25/2026',
    url: 'https://store.steampowered.com/news/app/730/view/5123894512345',
    publishedAt: Date.parse('2026-09-25T18:00:00Z') / 1000,
  }

  test('сайт на /en — английская версия: адрес /en, язык и описание английские', () => {
    expect(websiteJsonLd(BASE, 'en')).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'imbored',
      url: 'https://imbored.cc/en',
      inLanguage: 'en',
      description: siteDescription('en'),
    })
    expect(websiteJsonLd(BASE, 'ru')).toEqual(websiteJsonLd(BASE))
  })

  test('карточка, её крошки, жанр и патч — под /en', () => {
    expect(gameJsonLd({ meta: game(), baseUrl: BASE, locale: 'en', currency: 'USD', now: NOW }).url).toBe(
      'https://imbored.cc/en/game/730',
    )
    expect(
      gameBreadcrumbLd({ meta: game(), baseUrl: BASE, locale: 'en', genre: { title: 'Шутеры', path: '/games/fps' } })
        .itemListElement.map((i) => i.item),
    ).toEqual(['https://imbored.cc/en', 'https://imbored.cc/en/games', 'https://imbored.cc/en/games/fps', 'https://imbored.cc/en/game/730'])
    expect(
      genreBreadcrumbLd({ title: 'Шутеры', path: '/games/fps', baseUrl: BASE, locale: 'en' }).itemListElement.map((i) => i.item),
    ).toEqual(['https://imbored.cc/en', 'https://imbored.cc/en/games', 'https://imbored.cc/en/games/fps'])
    expect(
      genreItemListLd({ title: 'Шутеры', games: [{ appid: 730, name: 'CS2' }], baseUrl: BASE, locale: 'en' }).itemListElement[0].url,
    ).toBe('https://imbored.cc/en/game/730')

    const article = patchArticleLd({ item, game: { name: 'Counter-Strike 2' }, baseUrl: BASE, locale: 'en' })
    expect(article.url).toBe('https://imbored.cc/en/game/730/news/5123894512345')
    expect(article.mainEntityOfPage).toBe(article.url)
    expect(article.about?.url).toBe('https://imbored.cc/en/game/730')
    // язык ТЕКСТА статьи: пересказа нет — текст статьи составляют подписи
    // страницы, а они на /en английские
    expect(article.inLanguage).toBe('en')
    expect(
      patchBreadcrumbLd({ item, game: { name: 'Counter-Strike 2' }, baseUrl: BASE, locale: 'en' }).itemListElement.map((i) => i.item),
    ).toEqual(['https://imbored.cc/en', 'https://imbored.cc/en/game/730', 'https://imbored.cc/en/game/730/news/5123894512345'])
  })
})

/**
 * Язык статьи патча — язык её текста, то есть пересказа. Пока чтение патча не
 * отдаёт tldr_en, /en получает русский пересказ: назвать его английским —
 * сказать роботу неправду о description, который он покажет сниппетом.
 */
describe('язык статьи патча — язык пересказа', () => {
  const base = {
    appid: 730,
    gid: '5123894512345',
    title: 'Counter-Strike 2 Update',
    url: 'https://store.steampowered.com/news/app/730/view/5123894512345',
    publishedAt: Date.parse('2026-09-25T18:00:00Z') / 1000,
  }
  const game = { name: 'Counter-Strike 2' }

  test('русский пересказ на /en — статья русская, description тот же, что на странице', () => {
    const ld = patchArticleLd({ item: { ...base, tldr: 'Поправили баланс AWP и карту Mirage.' }, game, baseUrl: BASE, locale: 'en' })
    expect(ld.inLanguage).toBe('ru')
    expect(ld.description).toBe('Поправили баланс AWP и карту Mirage.')
  })

  test('английский пересказ на /en — статья английская', () => {
    const ld = patchArticleLd({ item: { ...base, tldr: 'AWP rebalanced, Mirage reworked.' }, game, baseUrl: BASE, locale: 'en' })
    expect(ld.inLanguage).toBe('en')
    expect(ld.description).toBe('AWP rebalanced, Mirage reworked.')
  })

  test('пустой пересказ на /en — язык страницы', () => {
    expect(patchArticleLd({ item: { ...base, tldr: '   ' }, game, baseUrl: BASE, locale: 'en' }).inLanguage).toBe('en')
    expect(patchArticleLd({ item: { ...base, tldr: null }, game, baseUrl: BASE, locale: 'en' }).inLanguage).toBe('en')
  })

  test('на русской странице — ru при любом пересказе, как было', () => {
    for (const tldr of ['Поправили баланс AWP.', 'AWP rebalanced.', '1.0.3', null, undefined]) {
      expect(patchArticleLd({ item: { ...base, tldr }, game, baseUrl: BASE }).inLanguage).toBe('ru')
    }
  })
})

/** Ни одной русской буквы: английская разметка обязана совпадать с английской страницей */
const CYRILLIC = /[А-Яа-яЁё]/

describe('тексты разметки на языке страницы', () => {
  const en = (over: Partial<GameMeta> = {}) =>
    gameJsonLd({ meta: game(over), baseUrl: BASE, locale: 'en', currency: 'USD', now: NOW })

  test('genre на /en — теги ключами Steam, как чипсы, даже когда жанры Steam есть', () => {
    // жанры у игры русские (appdetails с l=russian) — английской странице они не годятся
    expect(en({ genres: ['Экшены', 'Бесплатные'] }).genre).toEqual(['FPS', 'Shooter'])
    expect(en({ genres: [], tags: { 'Souls-like': 100, RPG: 90, 'Dystopian ': 80 } }).genre).toEqual([
      'Souls-like',
      'RPG',
      'Dystopian',
    ])
    // на русской — как было: жанры Steam, а без них — русские подписи тегов
    expect(ld({ genres: ['Экшены'] }).genre).toEqual(['Экшены'])
  })

  test('описание на /en — только нерусское', () => {
    expect(en({ shortDescription: 'Соревновательный шутер.' })).not.toHaveProperty('description')
    expect(en({ shortDescription: 'A competitive shooter.' }).description).toBe('A competitive shooter.')
    // на русской — как лежит, на любом языке
    expect(ld({ shortDescription: 'A competitive shooter.' }).description).toBe('A competitive shooter.')
  })

  test('inLanguage игры на /en не ставится: строки «Русский» там нет', () => {
    expect(en({ ruLang: 3 })).not.toHaveProperty('inLanguage')
    expect(ld({ ruLang: 3 }).inLanguage).toBe('ru')
  })

  test('английская карточка игры — без кириллицы при латинских названиях и тегах', () => {
    const out = en({ shortDescription: 'A competitive shooter.', genres: ['Экшены'], ruLang: 2 })
    expect(JSON.stringify(out)).not.toMatch(CYRILLIC)
  })

  test('крошки: «Games by genre» и жанр, как в строке над названием', () => {
    const game_ = gameBreadcrumbLd({
      meta: game(),
      baseUrl: BASE,
      locale: 'en',
      genre: { title: 'First-person shooters', path: '/games/fps' },
    })
    expect(game_.itemListElement.map((i) => i.name)).toEqual([
      'imbored',
      'Games by genre',
      'First-person shooters',
      'Counter-Strike 2',
    ])
    const genre = genreBreadcrumbLd({ title: 'Roguelikes', path: '/games/roguelike', baseUrl: BASE, locale: 'en' })
    expect(genre.itemListElement.map((i) => [i.position, i.name, i.item])).toEqual([
      [1, 'imbored', 'https://imbored.cc/en'],
      [2, 'Games by genre', 'https://imbored.cc/en/games'],
      [3, 'Roguelikes', 'https://imbored.cc/en/games/roguelike'],
    ])
    expect(JSON.stringify([game_, genre])).not.toMatch(CYRILLIC)
    // без языка — русская подпись
    expect(genreBreadcrumbLd({ title: 'Рогалики', path: '/games/roguelike', baseUrl: BASE }).itemListElement[1].name).toBe(
      'Игры по жанрам',
    )
  })

  test('статья патча на /en — английский пересказ и язык en', () => {
    const item = {
      appid: 730,
      gid: '5123894512345',
      title: 'Counter-Strike 2: Release Notes for 9/25/2026',
      url: 'https://store.steampowered.com/news/app/730/view/5123894512345',
      publishedAt: Date.parse('2026-09-25T18:00:00Z') / 1000,
      tldr: 'AWP rebalanced and Mirage tweaked.',
    }
    const out = patchArticleLd({ item, game: { name: 'Counter-Strike 2' }, baseUrl: BASE, locale: 'en' })
    expect(out.inLanguage).toBe('en')
    expect(out.description).toBe('AWP rebalanced and Mirage tweaked.')
    expect(JSON.stringify(out)).not.toMatch(CYRILLIC)
    // на русской — ru, как было
    expect(patchArticleLd({ item, game: null, baseUrl: BASE }).inLanguage).toBe('ru')
  })
})
