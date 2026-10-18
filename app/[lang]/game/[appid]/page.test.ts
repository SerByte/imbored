import fs from 'node:fs'
import path from 'node:path'
import Link from '@/components/Link'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { TilePending } from '@/components/TilePending'
import { GameNews } from '@/components/GameNews'
import { GameShots } from '@/components/GameShots'
import { OwnedLaunch } from '@/components/OwnedLaunch'
import { PlayersNow } from '@/components/PlayersNow'
import { DiscountEnds, PriceTag, PriceWhere } from '@/components/PriceTag'
import { ProgressRing } from '@/components/ProgressRing'
import { RefundNote } from '@/components/RefundNote'
import { ShownUntil } from '@/components/ShownUntil'
import { TrailerPreview } from '@/components/TrailerPreview'
import {
  replaceGameTags,
  setGameJson,
  setNewsDigest,
  setNewsDigestEn,
  upsertGameMeta,
  upsertNewsItems,
  type Db,
  type StoredNews,
} from '@/lib/db'
import { GAME_PAGE_REVALIDATE_SEC, PRERENDER_TOP } from '@/lib/gamecache'
import type { Locale } from '@/lib/i18n'
import { roomSeedHref } from '@/lib/presets'
import { flight as flightOf, islandsOf, textOf } from '@/lib/testing/flight'
import { freshDb } from '@/lib/testing/route'
import type { GameMeta } from '@/lib/types'
import GamePage, { generateMetadata, generateStaticParams, revalidate } from './page'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Язык клиентских островков, которые тест раскрывает вызовом (visible ниже).
 * useLocale вне рендера React не работает — у хука нет диспетчера, — поэтому
 * здесь он отвечает языком теста, как ответил бы LocaleProvider корневого
 * layout. Страница свой язык берёт из params и этого не видит.
 */
const lang = vi.hoisted(() => ({ locale: 'ru' as Locale }))
vi.mock('@/components/LocaleProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/LocaleProvider')>()),
  useLocale: () => lang.locale,
}))

/**
 * Бюджет ISR карточки игры (lib/gamecache): пререндер только в проде и
 * вывод, который не меняется от одних часов.
 *
 * Карточка живёт в кэше неделю, и перегенерация, давшая ту же страницу байт в
 * байт, ISR Writes не стоит. Значит, всё, что в разметке зависит от момента
 * рендера, а не от данных, — это запись на каждой перегенерации. Сломать это
 * легко и незаметно: страница рисуется так же, просто лимит тает. Поэтому
 * здесь настоящая страница на базе в памяти, отрисованная в двух моментах.
 */

const T0 = 1_760_000_000
const DAY = 86_400
const APPID = 730

let db: Db

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0 * 1000)
  db = await freshDb()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  lang.locale = 'ru'
})

const at = (sec: number) => vi.setSystemTime(sec * 1000)

function game(appid: number, over: Partial<GameMeta> = {}): GameMeta {
  const art = `https://cdn.example/${appid}`
  return {
    appid,
    name: `Игра ${appid}`,
    tags: { FPS: 1000, Shooter: 800, Competitive: 600 },
    genres: [],
    categories: [1, 2],
    headerImage: `${art}/header.jpg`,
    art: {
      header: `${art}/header.jpg`,
      header2x: `${art}/header_2x.jpg`,
      capsule: `${art}/capsule.jpg`,
      hero: `${art}/hero.jpg`,
      hero2x: `${art}/hero_2x.jpg`,
    },
    reviewsTotal: 1000,
    reviewsPercent: 80,
    ...over,
  }
}

function patch(gid: string, publishedAt: number, rank: number): StoredNews {
  return {
    appid: APPID,
    gid,
    title: `Обновление ${gid}`,
    url: `https://store.steampowered.com/news/app/${APPID}/view/${gid}`,
    publishedAt,
    kind: 'patch',
    scale: 'major',
    blocks: [{ kind: 'p', runs: [{ text: 'Починили сеть' }] }],
    bodyHash: `h${gid}`,
    imageUrl: `https://cdn.example/news/${gid}.jpg`,
    rank,
  }
}

/**
 * Карточка со всем, что в ней бывает зависящего от часов: скидка со сроком
 * (подпись), онлайн с отметкой замера, дата выхода (возврат), патчи с весом
 * игры, полка «Похожие» с артом.
 *
 * over — поля самой карточки поверх этих (английский слот описания у тестов
 * английской версии).
 */
async function seed(over: Partial<GameMeta> = {}): Promise<void> {
  await upsertGameMeta(
    db,
    game(APPID, {
      name: 'Counter-Strike 2',
      shortDescription: 'Шутер, в который играют миллионы.',
      screenshots: ['https://cdn.example/730/s1.jpg', 'https://cdn.example/730/s2.jpg'],
      trailer: { mp4: 'https://cdn.example/730/t.mp4', poster: 'https://cdn.example/730/t.jpg' },
      priceFinal: 999,
      priceInitial: 1999,
      discountPercent: 50,
      discountEndsAt: T0 + 5 * DAY,
      priceAt: T0 - 3600,
      releaseDate: '21 Aug, 2012',
      releaseYear: 2012,
      developer: 'Valve',
      publisher: 'Valve',
      ccu: 850_123,
      ccuAt: T0 - 3600,
      ...over,
    }),
    T0,
  )
  await replaceGameTags(db, APPID, [
    { tag: 'FPS', weight: 1000 },
    { tag: 'Shooter', weight: 800 },
  ])
  for (let appid = 10; appid < 18; appid++) {
    await upsertGameMeta(db, game(appid), T0)
    await replaceGameTags(db, appid, [{ tag: 'FPS', weight: 900 }])
  }
  // «Ещё у Valve»: в «Похожие» не попадают — тега FPS в game_tags у них нет
  for (const [appid, name] of [
    [400, 'Portal'],
    [620, 'Portal 2'],
  ] as const) {
    await upsertGameMeta(db, game(appid, { name, developer: 'Valve' }), T0)
  }
  await setGameJson(db, APPID, 'reviews_summary_json', {
    scoreDesc: 'Very Positive',
    totalPositive: 900,
    totalNegative: 100,
  })
  await setGameJson(db, APPID, 'pros_cons_json', { pros: ['стрельба'], cons: ['читеры'], source: 'claude' })
  await upsertNewsItems(db, [patch('1', T0 - 2 * DAY, 9000), patch('2', T0 - DAY, 9000)], T0)
  await setNewsDigest(db, APPID, '1', { tldr: 'Починили сеть.', scale: 'major' }, T0)
}

const params = { params: Promise.resolve({ appid: String(APPID) }) }

/**
 * Клиентские островки карточки: они сериализуются пропсами в RSC-часть
 * страницы, всё остальное раскрывается до разметки (lib/testing/flight).
 */
const ISLANDS = new Map<unknown, string>([
  [Link, 'Link'],
  [GameArt, 'GameArt'],
  [GameNews, 'GameNews'],
  [GameShots, 'GameShots'],
  [OwnedLaunch, 'OwnedLaunch'],
  [ProgressRing, 'ProgressRing'],
  [ShownUntil, 'ShownUntil'],
  [TrailerPreview, 'TrailerPreview'],
  // знак ожидания в плитках «Похожих» (components/GameLink)
  [TilePending, 'TilePending'],
  // Ценник, онлайн и строка возврата — клиентские ради языка (useLocale):
  // в кэш уходят их пропсы, и от часов они зависеть не должны
  [PriceTag, 'PriceTag'],
  [PriceWhere, 'PriceWhere'],
  [DiscountEnds, 'DiscountEnds'],
  [PlayersNow, 'PlayersNow'],
  [RefundNote, 'RefundNote'],
])

const flight = (node: unknown) => flightOf(node, ISLANDS)

/**
 * Островки, которые сервер дорисовывает в HTML той же страницы текстом, —
 * ценник, онлайн, возврат. Для кэша важны их пропсы (flight, snapshot), для
 * глаза — их текст: visible раскрывает их вызовом, как сервер в HTML, на
 * языке теста (lang выше).
 */
const PRINTED = new Set<unknown>([PriceTag, PriceWhere, DiscountEnds, PlayersNow, RefundNote])
const visible = (node: unknown) => flightOf(node, new Map([...ISLANDS].filter(([c]) => !PRINTED.has(c))))

/** Всё, что уходит в кэш: разметка с пропсами островков и метаданные */
async function snapshot(): Promise<string> {
  const page = await GamePage(params)
  return JSON.stringify({ page: flight(page), meta: await generateMetadata(params) })
}

describe('кэш карточки игры', () => {
  test('неделя — и та же неделя у OG-картинки', () => {
    expect(revalidate).toBe(GAME_PAGE_REVALIDATE_SEC)
    expect(revalidate).toBe(7 * DAY)
    // Next читает revalidate только литералом — импорта он не разберёт
    const og = fs.readFileSync(path.join(__dirname, 'opengraph-image.tsx'), 'utf8')
    const literal = og.match(/export const revalidate = ([\d_]+)\n/)?.[1]
    expect(Number(literal?.replace(/_/g, ''))).toBe(revalidate)
  })

  test('пререндер — только на продовой сборке: превью и локальная база пустые списки', async () => {
    await seed()
    const ru = { params: { lang: 'ru' } }
    vi.stubEnv('VERCEL_ENV', undefined)
    expect(await generateStaticParams(ru)).toEqual([])
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(await generateStaticParams(ru)).toEqual([])

    vi.stubEnv('VERCEL_ENV', 'production')
    const top = await generateStaticParams(ru)
    expect(top.length).toBeGreaterThan(0)
    expect(top.length).toBeLessThanOrEqual(PRERENDER_TOP)
    expect(top).toContainEqual({ appid: String(APPID) })
  })

  /**
   * Next зовёт generateStaticParams страницы на каждый язык корневого layout.
   * Тот же список на /en удвоил бы пререндер — и записи ISR каждой сборки, —
   * под которые и подбирали PRERENDER_TOP (lib/gamecache.ts).
   */
  test('на продовой сборке пререндерится только русская ветка: PRERENDER_TOP на все языки', async () => {
    await seed()
    vi.stubEnv('VERCEL_ENV', 'production')
    expect((await generateStaticParams({ params: { lang: 'ru' } })).length).toBeGreaterThan(0)
    expect(await generateStaticParams({ params: { lang: 'en' } })).toEqual([])
  })

  test('вывод не зависит от часов: через три дня — та же страница', async () => {
    // Ценник и онлайн — клиентские островки, и их пропсы входят в снимок: часы
    // онлайна (nowSec) от момента рендера зависеть не должны
    await seed()
    const first = await snapshot()

    // Три дня спустя: скидке осталось два дня (прежняя подпись сменилась бы на
    // «осталось 2 дня»), замер онлайна старше суток
    at(T0 + 3 * DAY)
    expect(await snapshot()).toBe(first)

    // И за миг до конца акции — всё ещё то же самое
    at(T0 + 5 * DAY - 1)
    expect(await snapshot()).toBe(first)
  })

  test('вес игры в ленте патчей сдвинулся — карточка та же', async () => {
    // rank переписывается у всех постов игры на каждом опросе, где сдвинулись
    // её отзывы; на карточке из него только «в каталоге ли игра»
    await seed()
    const first = await snapshot()
    await upsertNewsItems(db, [patch('1', T0 - 2 * DAY, 9500), patch('2', T0 - DAY, 9500)], T0 + 60)
    expect(await snapshot()).toBe(first)
  })

  test('сторож не слепой: кончилась акция — страница другая', async () => {
    await seed()
    const first = await snapshot()
    expect(textOf(visible(await GamePage(params)))).toContain('−50%')
    at(T0 + 5 * DAY + 1)
    expect(await snapshot()).not.toBe(first)
    expect(textOf(visible(await GamePage(params)))).not.toContain('−50%')
  })

  test('срок акции — датой, и цена со скидкой гаснет у читателя по нему же', async () => {
    await seed()
    const page = visible(await GamePage(params))
    // 1_760_000_000 — 9 октября 2025 UTC, акция кончается через пять суток
    expect(textOf(page)).toContain('до 14 октября')
    at(T0 + 4 * DAY)
    expect(textOf(visible(await GamePage(params)))).not.toMatch(/осталось|последний день/)
    // Строка цены — внутри ShownUntil со сроком конца акции
    const text = JSON.stringify(page)
    expect(text).toContain(`"island":"ShownUntil","key":null,"props":{"untilSec":${T0 + 5 * DAY}`)
  })

  test('«Ещё у Valve» — одна строка текстовых ссылок, без обложек и prefetch', async () => {
    await seed()
    const page = flight(await GamePage(params))
    expect(textOf(page)).toContain('Ещё у Valve: Portal · Portal 2')
    const text = JSON.stringify(page)
    for (const appid of [400, 620]) {
      expect(text).toContain(`{"island":"Link","key":null,"props":{"href":"/game/${appid}","prefetch":false`)
      // ни плитки, ни арта — только название
      expect(text).not.toContain(`"appid":${appid}`)
    }
  })

  test('«Похожие» — без префетча, но с переходом вглубь', async () => {
    // Соседи — в основном хвост каталога вне PRERENDER_TOP: с префетчем по
    // умолчанию каждая карточка, до «Похожих» которой доскроллили, будила бы
    // шесть холодных рендеров с записью ISR (components/GameLink)
    await seed()
    const links = islandsOf(flight(await GamePage(params)), 'Link').filter((l) =>
      /^\/game\/1\d$/.test(String(l.href)),
    )
    expect(links.length).toBeGreaterThan(0)
    for (const l of links) {
      expect(l).toMatchObject({ prefetch: false, transitionTypes: ['nav-forward'] })
    }
  })

  test('в островки GameArt уезжают только ссылки варианта card', async () => {
    // Герой и «Похожие» рисуют арт вариантом card: он читает header, header2x
    // и capsule. library_hero и hero_2x ехали в RSC и в HTML каждой из пяти
    // тысяч карточек мёртвым грузом — по ~380 символов на игру (lib/art,
    // trimArt «нужна на границе с клиентом»).
    await seed()
    const arts = islandsOf(flight(await GamePage(params)), 'GameArt')
    // две картинки героя и шесть соседей — сторож не слепой
    expect(arts.length).toBeGreaterThanOrEqual(8)
    for (const a of arts) {
      expect(a.variant ?? 'card').toBe('card')
      expect(Object.keys((a.art as object | null) ?? {}).sort()).toEqual(['capsule', 'header', 'header2x'])
    }
  })

  test('онлайн — прошедшим временем: «сейчас» из недельного кэша не бывает правдой', async () => {
    await seed()
    const text = textOf(visible(await GamePage(params)))
    expect(text).toContain('играли')
    expect(text).not.toContain('сейчас играют')
  })
})

/** JSON-LD страницы, как он уходит в HTML: первый <script type="application/ld+json"> */
function jsonLdOf(page: unknown): Array<Record<string, unknown>> {
  let html: string | undefined
  const walk = (node: unknown): void => {
    if (html !== undefined || !node || typeof node !== 'object') return
    const inner = (node as { dangerouslySetInnerHTML?: { __html?: unknown } }).dangerouslySetInnerHTML
    if (typeof inner?.__html === 'string') {
      html = inner.__html
      return
    }
    for (const v of Object.values(node)) walk(v)
  }
  walk(page)
  expect(html, 'ld+json на странице не найден').toBeDefined()
  return JSON.parse(html!) as Array<Record<string, unknown>>
}

describe('микроразметка говорит не больше страницы', () => {
  test('ноль без «бесплатно»: ни строки цены у героя, ни Offer в разметке', async () => {
    // Так лежат делисты вроде Ori and the Blind Forest: поиск магазина отдал
    // «0», is_free пуст. Герой молчит о цене — значит, и выдача не должна
    // услышать «бесплатно, в наличии»
    await upsertGameMeta(db, game(APPID, { name: 'Ori', priceFinal: 0 }), T0)
    const page = visible(await GamePage(params))
    expect(textOf(page)).not.toContain('бесплатно')
    const [video] = jsonLdOf(page)
    expect(video['@type']).toBe('VideoGame')
    expect(video).not.toHaveProperty('offers')
  })

  test('сторож не слепой: настоящая цена — и на странице, и в Offer', async () => {
    await upsertGameMeta(db, game(APPID, { priceFinal: 1999, priceInitial: 1999, priceAt: T0 }), T0)
    const [video] = jsonLdOf(flight(await GamePage(params)))
    expect(video.offers).toMatchObject({ '@type': 'Offer', price: '19.99' })
  })

  test('русский: строка — при любом ответе Steam, inLanguage — только при «есть»', async () => {
    await upsertGameMeta(db, game(APPID, { ruLang: 2 }), T0)
    let page = flight(await GamePage(params))
    expect(textOf(page)).toContain('субтитры — по данным Steam')
    expect(jsonLdOf(page)[0].inLanguage).toBe('ru')

    // «русского нет» — строка есть, а языка в разметке нет: других мы не знаем
    await upsertGameMeta(db, game(APPID, { ruLang: 0 }), T0)
    page = flight(await GamePage(params))
    expect(textOf(page)).toContain('нет — по данным Steam')
    expect(jsonLdOf(page)[0]).not.toHaveProperty('inLanguage')
  })

  test('русский неизвестен — ни строки, ни разметки', async () => {
    // Так у большинства карточек, пока крон или доливка медиа не принесли язык
    await upsertGameMeta(db, game(APPID), T0)
    const page = flight(await GamePage(params))
    expect(textOf(page)).not.toContain('по данным Steam')
    expect(jsonLdOf(page)[0]).not.toHaveProperty('inLanguage')
  })

  test('оценки Steam в разметке нет, хотя кольцо на странице её показывает', async () => {
    // Чужие оценки размечать нельзя (правила Google для review snippet) —
    // см. докблок lib/jsonld. Кольцо — видимое, ему это правило не мешает
    await seed()
    const page = flight(await GamePage(params))
    expect(JSON.stringify(jsonLdOf(page))).not.toContain('aggregateRating')
    expect(JSON.stringify(page)).toContain('"island":"ProgressRing"')
  })
})

describe('замещённая игра', () => {
  /*
   * /game/10 (Counter-Strike 1.6) — не дубликат /game/730: другие отзывы,
   * описание и цена. canonical на чужую игру Google к такой странице не
   * применит, а вместе с noindex это два противоречащих сигнала. og:url на
   * преемника хуже того: VK и Facebook строят карточку по og:url, и ссылка на
   * старую игру разворачивалась в чате карточкой сиквела.
   */
  test('noindex — да, но canonical и og:url — свои, а не преемника', async () => {
    await upsertGameMeta(db, game(10, { name: 'Counter-Strike' }), T0)
    // Вердикт курации читается целиком, по signals_at (rowToMeta) — как его
    // и пишет promote-catalog, одним UPDATE
    await db.execute({
      sql: 'UPDATE games SET superseded_by = ?, signals_at = ? WHERE appid = ?',
      args: [APPID, T0, 10],
    })
    const meta = await generateMetadata({ params: Promise.resolve({ appid: '10' }) })
    expect(meta.robots).toEqual({ index: false, follow: true })
    expect(meta.alternates?.canonical).toBe('/game/10')
    expect(meta.openGraph?.url).toBe('/game/10')
  })

  test('на английском canonical и og:url — английские, hreflang — обе версии', async () => {
    await upsertGameMeta(db, game(10, { name: 'Counter-Strike' }), T0)
    const meta = await generateMetadata({ params: Promise.resolve({ appid: '10', lang: 'en' }) })
    expect(meta.alternates?.canonical).toBe('/en/game/10')
    expect(meta.alternates?.languages).toEqual({ ru: '/game/10', en: '/en/game/10', 'x-default': '/game/10' })
    expect(meta.openGraph).toMatchObject({ url: '/en/game/10', locale: 'en_US', siteName: 'imbored' })
  })
})

/**
 * «Позвать в эту игру»: карточку игры чаще всего открывают, чтобы скинуть
 * друзьям, и «го в неё?» уходило в чат голой ссылкой. Кнопка ведёт в комнату
 * с этой игрой первой картой — но только у той, которую комната возьмёт
 * (seedable в lib/roomseed). Адрес один на всех: про сессию страница не знает,
 * и ISR от кнопки не меняется.
 */
describe('«Позвать в эту игру»', () => {
  const partyLinks = async (appid: number) =>
    islandsOf(flight(await GamePage({ params: Promise.resolve({ appid: String(appid) }) })), 'Link')
      .map((l) => String(l.href))
      .filter((href) => href.startsWith('/room/'))

  test('сетевая игра — ссылка на комнату с ней первой картой', async () => {
    await upsertGameMeta(db, game(APPID), T0)
    expect(await partyLinks(APPID)).toEqual([roomSeedHref(APPID)])
  })

  test('одиночная — кнопки нет: колода пати её не раздаст', async () => {
    await upsertGameMeta(db, game(20, { categories: [2], tags: { RPG: 900 } }), T0)
    expect(await partyLinks(20)).toEqual([])
  })

  test('вытесненная преемником и похороненная каталогом — кнопки нет', async () => {
    await upsertGameMeta(db, game(10, { name: 'Counter-Strike' }), T0)
    await upsertGameMeta(db, game(11, { name: 'Мёртвый сетевой' }), T0)
    await db.execute({ sql: 'UPDATE games SET superseded_by = ?, signals_at = ? WHERE appid = 10', args: [APPID, T0] })
    await db.execute({ sql: 'UPDATE games SET alive = 0, signals_at = ? WHERE appid = 11', args: [T0] })
    expect(await partyLinks(10)).toEqual([])
    expect(await partyLinks(11)).toEqual([])
  })

  /*
   * Каталог её не хоронит: alive — соло-вердикт, а одиночная кампания в соло
   * прощает любой онлайн, поэтому и вердикта «мёртвая» на странице нет. А
   * колода пати судит заново (filterActual → judgeLiveness 'party') и при
   * сотне игроков на весь мир сетевую игру без коопа снимает. Кнопка звала
   * бы в карту, которой в комнате не окажется. Кооп с той же сотней — с
   * кнопкой: в него садятся со своими, и онлайн колода у него не спрашивает.
   */
  test('PvP с одиночной кампанией и пустыми серверами — кнопки нет; кооп при той же сотне — есть', async () => {
    await upsertGameMeta(db, game(21, { categories: [2, 1, 49, 36], ccu: 100 }), T0)
    await upsertGameMeta(db, game(22, { categories: [2, 1, 9], ccu: 100 }), T0)
    expect(await partyLinks(21)).toEqual([])
    expect(await partyLinks(22)).toEqual([roomSeedHref(22)])
  })
})

/**
 * Английская карточка: /en/game/730 — та же страница на языке params.
 *
 * Русский вывод без языка прежний (тесты выше), а здесь — что на /en не
 * остаётся русского: ни в тексте, ни в метаданных, ни в разметке, ни в
 * пропсах островков. Блоки из текстов модели без английского слота
 * (плюсы/минусы) не показываются вовсе, а не показываются по-русски.
 */
describe('английская карточка', () => {
  const CYR = /[А-Яа-яЁё]/
  const en = (appid = APPID) => ({ params: Promise.resolve({ appid: String(appid), lang: 'en' }) })

  /** Карточка seed() с английскими слотами: описание, плюсы/минусы, пересказ патча */
  async function seedEn(): Promise<void> {
    await seed({ shortDescriptionEn: 'The shooter millions play.' })
    // Соседи по-английски: кириллица на /en — только в чужих данных, а здесь их нет
    await db.execute({ sql: "UPDATE games SET name = 'Game ' || appid WHERE appid BETWEEN 10 AND 17", args: [] })
    await setGameJson(db, APPID, 'pros_cons_json', {
      pros: ['стрельба'],
      cons: ['читеры'],
      source: 'claude',
      en: { pros: ['gunplay'], cons: ['cheaters'] },
    })
    await setNewsDigestEn(db, APPID, '1', { tldrEn: 'Fixed the netcode.' }, T0)
  }

  test('заголовок — вопросом своего языка, и описание без кириллицы', async () => {
    await seedEn()
    const meta = await generateMetadata(en())
    expect(meta.title).toBe('Is Counter-Strike 2 worth playing?')
    expect(meta.openGraph?.title).toBe('Is Counter-Strike 2 worth playing?')
    expect(meta.twitter?.title).toBe('Is Counter-Strike 2 worth playing?')
    expect(meta.description).toMatch(/Loved for: gunplay\./)
    expect(JSON.stringify(meta)).not.toMatch(CYR)
  })

  test('на странице, в разметке и в пропсах островков — ни буквы по-русски', async () => {
    await seedEn()
    lang.locale = 'en'
    const page = await GamePage(en())
    const text = textOf(visible(page))
    expect(text.match(new RegExp(`.{0,30}${CYR.source}.{0,30}`, 'g'))).toBeNull()
    // всё, что уходит в RSC-часть: пропсы островков (новости, кольцо, ценник)
    expect(JSON.stringify(flight(page))).not.toMatch(CYR)
    expect(JSON.stringify(jsonLdOf(flight(page)))).not.toMatch(CYR)
  })

  test('то, что видно: оценка, цена, онлайн, кнопки и подписи', async () => {
    await seedEn()
    lang.locale = 'en'
    const page = visible(await GamePage(en()))
    const text = textOf(page)
    for (const s of [
      'Very Positive',
      'of 1,000 reviews',
      '850,123',
      'were playing',
      'until Oct 14',
      'Steam page',
      'YouTube reviews',
      'Invite to this game',
      'Loved for',
      'Criticized for',
      'Summarized by AI from the most helpful Steam reviews',
      'The shooter millions play.',
      'More from Valve: Portal · Portal 2',
      'Similar games',
      'Find a game for your mood',
      'Similar to “Counter-Strike 2”, for your mood',
    ]) {
      expect(text, s).toContain(s)
    }
    const [ring] = islandsOf(page, 'ProgressRing')
    expect(ring.ariaLabel).toBe('90% of 1,000 reviews are positive')
    const youtube = JSON.stringify(page).match(/youtube\.com\/results\?search_query=([^"]+)/)?.[1]
    expect(decodeURIComponent(youtube ?? '')).toBe('Counter-Strike 2 review')
  })

  test('без английского слота плюсов и минусов — блока нет вовсе, и подписи ИИ тоже', async () => {
    // seed() кладёт только русские плюсы и минусы
    await seed({ shortDescriptionEn: 'The shooter millions play.' })
    lang.locale = 'en'
    const text = textOf(visible(await GamePage(en())))
    expect(text).not.toContain('Loved for')
    expect(text).not.toContain('Summarized by AI')
    expect(text).not.toMatch(/стрельба|читеры/)
  })

  test('без английского описания абзаца нет, а не русский абзац', async () => {
    await seed()
    lang.locale = 'en'
    const text = textOf(visible(await GamePage(en())))
    expect(text).not.toContain('Шутер, в который играют миллионы.')
  })

  test('без сводки Steam подпись кольца — фразой глоссария целиком', async () => {
    await upsertGameMeta(db, game(APPID, { name: 'Ori', reviewsPercent: 80, reviewsTotal: 1 }), T0)
    lang.locale = 'en'
    expect(textOf(visible(await GamePage(en())))).toContain('of 1 review is positive')
  })

  test('новости патчей — с английским заголовком и пересказом только при tldr_en', async () => {
    await seedEn()
    lang.locale = 'en'
    const [news] = islandsOf(flight(await GamePage(en())), 'GameNews')
    const items = news.items as Array<{ gid: string; title: string; tldr?: string }>
    expect(items.find((i) => i.gid === '1')?.tldr).toBe('Fixed the netcode.')
    expect(items.find((i) => i.gid === '2')).not.toHaveProperty('tldr')
    for (const i of items) expect(i.title).not.toMatch(CYR)
  })
})
