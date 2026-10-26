import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Link from '@/components/Link'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { TilePending } from '@/components/TilePending'
import { GameNews } from '@/components/GameNews'
import { GameShots, shotLabels } from '@/components/GameShots'
import { OwnedLaunch } from '@/components/OwnedLaunch'
import { PlayersNow } from '@/components/PlayersNow'
import { DiscountEnds, PriceTag, PriceWhere } from '@/components/PriceTag'
import { ProgressRing } from '@/components/ProgressRing'
import { RefundNote } from '@/components/RefundNote'
import { ShownUntil } from '@/components/ShownUntil'
import { TrailerPreview } from '@/components/TrailerPreview'
import { PULSE_RESHOW_SEC } from '@/lib/catalogsignals'
import {
  getGameMeta,
  replaceGameTags,
  setGameJson,
  setNewsDigest,
  setNewsDigestEn,
  updateReviewPulse,
  upsertGameMeta,
  upsertNewsItems,
  type Db,
  type StoredNews,
} from '@/lib/db'
import { PRICE_TRUST_SEC } from '@/lib/discount'
import { GAME_PAGE_REVALIDATE_SEC, PRERENDER_TOP } from '@/lib/gamecache'
import type { Locale } from '@/lib/i18n'
import { quizHref, roomSeedHref } from '@/lib/presets'
import { classOfTag, flight as flightOf, islandsOf, textOf } from '@/lib/testing/flight'
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
  // Ценник и строка возврата — клиентские ради языка (useLocale): в кэш
  // уходят их пропсы, и от часов они зависеть не должны
  [PriceTag, 'PriceTag'],
  [PriceWhere, 'PriceWhere'],
  [DiscountEnds, 'DiscountEnds'],
  [RefundNote, 'RefundNote'],
  // Онлайна среди островков быть не должно: строку карточки рисует сервер
  // ступенью (PlayersAtCheck), а живой PlayersNow с точным числом и часами —
  // для экранов вне кэша. Здесь он, чтобы его возвращение было видно
  // островком, а не падением теста на хуке
  [PlayersNow, 'PlayersNow'],
])

const flight = (node: unknown) => flightOf(node, ISLANDS)

/**
 * Островки, которые сервер дорисовывает в HTML той же страницы текстом, —
 * ценник и возврат. Для кэша важны их пропсы (flight, snapshot), для глаза —
 * их текст: visible раскрывает их вызовом, как сервер в HTML, на языке теста
 * (lang выше).
 */
const PRINTED = new Set<unknown>([PriceTag, PriceWhere, DiscountEnds, RefundNote])
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
    // Ценник — клиентский островок, и его пропсы входят в снимок; онлайн часов
    // не берёт вовсе (PlayersAtCheck), хотя замер в seed старше суток
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

  test('онлайн — прошедшим временем и ступенью: «сейчас» из недельного кэша не бывает правдой', async () => {
    await seed()
    const text = textOf(visible(await GamePage(params)))
    expect(text).toMatch(/онлайн при замере: больше 500\s000/)
    expect(text).not.toMatch(/сейчас (играют|онлайн)/)
    // точное число — только на живых экранах (components/PlayersNow)
    expect(text).not.toMatch(/850\s123/)
  })

  /*
   * Онлайн переписывают без порога и сверка каталога раз в неделю, и догрев
   * /api/prepare каждые шесть часов у игр из библиотек. Точное число делало
   * бы новой страницей почти каждую перегенерацию совместной игры — запись
   * ISR у половины каталога каждую неделю. Ступень ряда 1–2–5 стоит неделями.
   */
  test('новый замер онлайна в той же ступени — та же страница, в следующей — другая', async () => {
    await seed()
    const first = await snapshot()
    const measure = (ccu: number) =>
      db.execute({ sql: 'UPDATE games SET ccu = ?, ccu_at = ? WHERE appid = ?', args: [ccu, T0, APPID] })
    await measure(912_345)
    expect(await snapshot()).toBe(first)
    // Живой клиентский PlayersNow на страницу не вернулся: его пропсы с
    // точным числом и часами легли бы в RSC-часть
    expect(islandsOf(flight(await GamePage(params)), 'PlayersNow')).toEqual([])

    // Сторож не слепой: перевалило за миллион — это уже другая строка
    await measure(1_200_000)
    expect(await snapshot()).not.toBe(first)
    expect(textOf(visible(await GamePage(params)))).toMatch(/онлайн при замере: больше 1\s000\s000/)
  })

  /*
   * Кольцо — все языки из сверки каталога, а под ним пульс: месяц, который
   * разошёлся со всем временем, и отзывы на русском. Подписи датой, а не «месяц
   * назад», — и вывод за неделю кэша не меняется от одних часов.
   */
  test('кольцо — все языки, под ним месяц и русские; через три дня — та же страница', async () => {
    await seed()
    await db.execute({
      sql: `UPDATE games SET reviews_total = 142783, reviews_percent = 98,
              reviews_all_total = 309180, reviews_all_percent = 97, reviews_all_score = 9,
              reviews_ru_total = 16893, reviews_ru_percent = 96,
              reviews_recent_total = 7948, reviews_recent_percent = 71, reviews_recent_at = ?
            WHERE appid = ?`,
      args: [T0 - DAY, APPID],
    })
    const text = textOf(flight(await GamePage(params)))
    expect(text).toContain('Крайне положительные')
    expect(text).toMatch(/из 309\s180 отзывов/)
    // англоязычная шкала порогов людям не показывается
    expect(text).not.toMatch(/142\s783/)
    // 1_760_000_000 — 9 октября 2025 UTC, замер — сутками раньше
    expect(text).toMatch(/За 30 дней до 8 октября:71% положительных из 7\s948 отзывов — ниже, чем за всё время/)
    expect(text).toMatch(/На русском:96% положительных из 16\s893 отзывов/)

    const first = await snapshot()
    at(T0 + 3 * DAY)
    expect(await snapshot()).toBe(first)
  })

  /*
   * Пульс меряется раз в неделю, и каждый замер чуть другой: на пункт другая
   * доля, на пару сотен другой счёт и всегда другая дата. Перепиши он строку
   * под кольцом — карточка верха пула, самая читаемая, была бы новой
   * страницей в ISR каждую неделю. Мелочь показанный замер не трогает
   * (updateReviewPulse), а подпись датой честна и про прежний.
   */
  test('пульс не дёргает карточку от мелочи: два недельных замера на пункт врозь — та же страница', async () => {
    await seed()
    await db.execute({
      sql: 'UPDATE games SET reviews_all_total = 309180, reviews_all_percent = 97, reviews_all_score = 9 WHERE appid = ?',
      args: [APPID],
    })
    const pulse = (nowSec: number, total: number, positive: number) =>
      updateReviewPulse(db, [{ appid: APPID, pulse: { total, positive } }], nowSec, {
        reshowBefore: nowSec - PULSE_RESHOW_SEC,
      })
    await pulse(T0 - DAY, 7948, 5643) // 71%

    // Неделя спустя — 72% из 8 211: тот же месяц на глаз. Часы одни и те же
    // у обоих снимков: здесь проверяется замер, а не время
    const week = T0 + 6 * DAY
    at(week)
    const first = await snapshot()
    expect(textOf(flight(await GamePage(params)))).toMatch(/За 30 дней до 8 октября:71% положительных из 7\s948/)
    await pulse(week, 8211, 5912)
    expect(await snapshot()).toBe(first)

    // Сторож не слепой: доля ушла на пять пунктов — это уже новость
    await pulse(week, 8211, 5420) // 66%
    expect(await snapshot()).not.toBe(first)
    expect(textOf(flight(await GamePage(params)))).toMatch(/За 30 дней до 15 октября:66% положительных из 8\s211/)
  })

  test('ноль онлайна — «онлайн при замере: 0», а не «0 играли»', async () => {
    // /game/711810: «0 играли» рядом с «72% из 1 886 отзывов» читалось как
    // «в неё не играл никто». И у игры без студии ноль не выпадает литералом
    await upsertGameMeta(db, game(APPID, { ccu: 0, ccuAt: T0 - 3 * DAY }), T0)
    const text = textOf(visible(await GamePage(params)))
    expect(text).toContain('онлайн при замере: 0')
    expect(text).not.toMatch(/0\s*играли/)
    // ниже нуля ступени нет — и «больше» перед ним тоже
    expect(text).not.toContain('больше 0')
  })

  test('ноль онлайна на /en — «online at last check: 0», а не русская строка', async () => {
    // Ветка нуля пришла из main по-русски, а страница ставит её всегда
    // (typeof ccu === 'number'): на /en печаталось «онлайн при замере: 0»
    await upsertGameMeta(db, game(APPID, { ccu: 0, ccuAt: T0 - 3 * DAY }), T0)
    lang.locale = 'en'
    const text = textOf(visible(await GamePage({ params: Promise.resolve({ appid: String(APPID), lang: 'en' }) })))
    expect(text).toContain('online at last check: 0')
    expect(text).not.toMatch(/онлайн|0\s*were playing/)
  })

  test('ступень на /en — английским числом и словами, не русскими', async () => {
    await upsertGameMeta(db, game(APPID, { name: 'Counter-Strike 2', ccu: 1234, ccuAt: T0 - 3 * DAY }), T0)
    lang.locale = 'en'
    const text = textOf(visible(await GamePage({ params: Promise.resolve({ appid: String(APPID), lang: 'en' }) })))
    expect(text).toContain('online at last check: more than 1,000')
    expect(text).not.toMatch(/1,234|больше|при замере/)
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

  /*
   * Погасшая распродажа: замер пришёлся на акцию, а она кончилась. Сама цена
   * — акционная, и показывать её нельзя (trustedPrice), но герой без цены и
   * с «Steam возвращает деньги» под кнопками читался сбоем — так неделями
   * стояли Hades и ICARUS, пока сверка не переснимет цену. Обычную цену мы
   * знаем — «было» той же пары, — и подписанная как обычная, она правдива,
   * кончилась акция или продлена. Ценой она не названа, поэтому Offer нет.
   */
  test('погасшая распродажа: в герое — обычная цена с подписью, в разметке Offer нет', async () => {
    // Оба случая, что прячет trustedPrice: срок, названный Steam, вышел — и
    // срока не было, а замер старше срока доверия
    for (const lapsed of [
      { discountEndsAt: T0 - DAY, priceAt: T0 - 10 * DAY },
      { discountEndsAt: undefined, priceAt: T0 - PRICE_TRUST_SEC - DAY },
    ]) {
      await upsertGameMeta(
        db,
        game(APPID, { priceFinal: 999, priceInitial: 1999, discountPercent: 50, ...lapsed }),
        T0,
      )
      const tree = await GamePage(params)
      const page = flight(tree)
      // ценник — островок (useLocale): его цифры видно раскрытым, как в HTML
      const text = textOf(visible(tree))
      expect(text).toContain('обычная цена')
      expect(text).toContain('19,99')
      // Подпись — видимым текстом (title не видят ни телефон, ни скринридер), и
      // без «кончилась»: продлённую акцию отсюда от кончившейся не отличить
      expect(text).toContain('идёт ли она ещё, мы не знаем — в Steam может быть дешевле')
      expect(JSON.stringify(page)).not.toMatch(/кончилась/)
      // акционное число не всплывает ни в каком виде
      expect(text).not.toMatch(/(^|[^\d])9,99/)
      expect(jsonLdOf(page)[0]).not.toHaveProperty('offers')
    }
  })

  test('сторож не слепой: у живой скидки и у обычной цены подписи «обычная цена» нет', async () => {
    await seed()
    expect(textOf(flight(await GamePage(params)))).not.toContain('обычная цена')
    await upsertGameMeta(db, game(APPID, { priceFinal: 1999, priceInitial: 1999, discountPercent: 0, priceAt: T0 }), T0)
    expect(textOf(flight(await GamePage(params)))).not.toContain('обычная цена')
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

  test('русское название — вторым рядом под заголовком и alternateName; нет его — ни того, ни другого', async () => {
    // Заголовок — английское название магазина (nameSql в lib/db). До правила
    // двух названий крон карточек клал русское прямо в name, и у верха
    // каталога оно стояло в H1 и <title>; теперь оно второе, но со страницы
    // не пропадает
    await upsertGameMeta(db, game(APPID, { name: 'The Witcher 3: Wild Hunt' }), T0)
    let page = flight(await GamePage(params))
    expect(textOf(page)).not.toContain('Ведьмак')
    expect(jsonLdOf(page)[0]).not.toHaveProperty('alternateName')

    // Карточка (appdetails с l=russian) принесла русское — апсерт кладёт его вторым
    await upsertGameMeta(db, game(APPID, { name: 'Ведьмак 3: Дикая Охота' }), T0 + 10)
    page = flight(await GamePage(params))
    expect(textOf(page)).toContain('Ведьмак 3: Дикая Охота')
    expect(jsonLdOf(page)[0]).toMatchObject({
      name: 'The Witcher 3: Wild Hunt',
      alternateName: 'Ведьмак 3: Дикая Охота',
    })
    expect((await generateMetadata(params)).title).toBe('The Witcher 3: Wild Hunt — стоит ли играть')
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
    expect(meta.alternates?.languages).toEqual({ ru: '/game/10', en: '/en/game/10', 'x-default': '/en/game/10' })
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

  /*
   * alt файловой карточки один на все языки, поэтому /en ставит свой images —
   * ту же карточку с английской подписью, а русская своего images не задаёт и
   * получает файловую до байта (enCard в page.tsx). Размеры и тип в page.tsx —
   * копия: если карточка сменит формат, тест это поймает.
   */
  test('превью на /en — та же карточка маршрута, но с английским alt', async () => {
    await seedEn()
    const { size, contentType } = await import('./opengraph-image')
    const meta = await generateMetadata(en())
    expect(meta.openGraph?.images).toEqual([
      {
        url: `/en/game/${APPID}/opengraph-image`,
        width: size.width,
        height: size.height,
        type: contentType,
        alt: 'Is it worth playing? — imbored',
      },
    ])
    // twitter:image Next дозаполняет из openGraph сам — своего тут не нужно
    expect(meta.twitter).not.toHaveProperty('images')
  })

  test('русская страница своего images не задаёт — карточку и её alt ставит файл', async () => {
    await seedEn()
    const { alt } = await import('./opengraph-image')
    expect(alt).toBe('Стоит ли играть — imbored')
    const meta = await generateMetadata({ params: Promise.resolve({ appid: String(APPID) }) })
    expect(meta.openGraph).not.toHaveProperty('images')
    expect(meta.twitter).not.toHaveProperty('images')
  })

  /*
   * 404 под /en/game/<appid>. Голову, которую видит браузер, клиент ставит
   * из обычного прохода метаданных: файловая карточка сегмента плюс то, что
   * вернул generateMetadata (докблок missingMeta в page.tsx). Пустой объект
   * оставлял в ней на /en русский alt файла.
   */
  test('нет такой игры: на /en — та же карточка с английским alt, на русской — пустой объект, как был', async () => {
    const { size, contentType } = await import('./opengraph-image')
    for (const appid of ['999999999', 'abc']) {
      const meta = await generateMetadata({ params: Promise.resolve({ appid, lang: 'en' }) })
      expect(meta.openGraph, appid).toEqual({
        type: 'website',
        siteName: 'imbored',
        locale: 'en_US',
        url: `/en/game/${appid}`,
        images: [
          {
            url: `/en/game/${appid}/opengraph-image`,
            width: size.width,
            height: size.height,
            type: contentType,
            alt: 'Is it worth playing? — imbored',
          },
        ],
      })
      expect(JSON.stringify(meta)).not.toMatch(CYR)
      expect(await generateMetadata({ params: Promise.resolve({ appid }) }), appid).toEqual({})
    }
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
      'online at last check: more than 500,000',
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
    await upsertGameMeta(db, game(APPID, { name: 'Ori' }), T0)
    // кольцо — все языки сверки каталога (reviewFacts); слова Steam у замера нет
    await db.execute({
      sql: 'UPDATE games SET reviews_all_total = 1, reviews_all_percent = 80 WHERE appid = ?',
      args: [APPID],
    })
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

  /*
   * Голова /en с русским именем магазина: title, description, og, twitter,
   * JSON-LD. У тегов головы своего lang нет, а название — данные (п. 6
   * docs/i18n.md): страница его не выбрасывает и не подменяет — почему, в
   * page.tsx у заголовка. Строку, испорченную до правила двух названий
   * (русское в name, name_ru пуст), лечит первая английская запись — прогрев
   * или заливка каталога (nameSql в lib/db), — и голова /en после неё
   * английская целиком; крон карточек с l=russian русское обратно не кладёт.
   */
  test('русское имя магазина в name: голова /en с ним, пока английская запись не вернёт своё', async () => {
    await seedEn()
    // Так строку оставил крон карточек до правила двух названий
    await db.execute({
      sql: "UPDATE games SET name = 'God of War Рагнарёк', name_ru = NULL WHERE appid = ?",
      args: [APPID],
    })
    let meta = await generateMetadata(en())
    expect(meta.title).toBe('Is God of War Рагнарёк worth playing?')

    // Прогрев или заливка каталога: GetItems по-английски
    const row = await getGameMeta(db, APPID)
    await upsertGameMeta(db, { ...row!, name: 'God of War Ragnarök' }, T0 + 10)
    // Крон карточек (appdetails с l=russian): русское встаёт вторым, а не в name
    await upsertGameMeta(db, { ...row!, name: 'God of War Рагнарёк' }, T0 + 20, { ruStore: true })

    meta = await generateMetadata(en())
    expect(meta.title).toBe('Is God of War Ragnarök worth playing?')
    expect(meta.openGraph?.title).toBe(meta.title)
    expect(meta.twitter?.title).toBe(meta.title)
    expect(JSON.stringify(meta)).not.toMatch(CYR)
    lang.locale = 'en'
    expect(JSON.stringify(jsonLdOf(flight(await GamePage(en()))))).not.toMatch(CYR)
    // Русская страница русское название не потеряла: оно второе
    lang.locale = 'ru'
    expect(jsonLdOf(flight(await GamePage(params)))[0]).toMatchObject({
      name: 'God of War Ragnarök',
      alternateName: 'God of War Рагнарёк',
    })
  })
})

/** Класс h1 раскрытой страницы — заголовок героя у карточки один */
function h1ClassOf(page: unknown): string {
  const cls = classOfTag(page, 'h1')
  expect(cls, 'h1 на карточке не найден — сторож ослеп').toBeDefined()
  return cls!
}

/**
 * Длинное название не уводит кнопки героя за первый экран. Замер на проде при
 * 1440×900: /game/3191050 (108 знаков) — h1 в 8 строк display-lg, «Страница
 * в Steam» на y=1063. Порог и его вывод — lib/titlesize.
 */
describe('кегль названия в герое', () => {
  const LONG =
    'BRAZILIAN DRUG DEALER 3: I OPENED A PORTAL TO HELL IN THE FAVELA TRYING TO REVIVE MIT AIA I NEED TO CLOSE IT'

  test('обычное имя — кегль героя', async () => {
    await upsertGameMeta(db, game(APPID, { name: 'Counter-Strike 2' }), T0)
    const cls = h1ClassOf(flight(await GamePage(params)))
    expect(cls).toMatch(/\btext-display-lg\b/)
  })

  test('108 знаков — титул экрана, а не стена из восьми строк', async () => {
    await upsertGameMeta(db, game(APPID, { name: LONG }), T0)
    const cls = h1ClassOf(flight(await GamePage(params)))
    expect(cls).toMatch(/\btext-display-md\b/)
    expect(cls).not.toMatch(/\btext-display-lg\b/)
  })

  test('длинное слово — ступенью ниже, а не разрыв посреди слова', async () => {
    // 34 знака, но «TROUBLESHOOTER:» в display-lg шире колонки: 611 из 556 при
    // 1440, и с одним лишь разрывом h1 читался «TROUBLESHOOTE / R»
    await upsertGameMeta(db, game(APPID, { name: 'TROUBLESHOOTER: Abandoned Children' }), T0)
    const cls = h1ClassOf(flight(await GamePage(params)))
    expect(cls).toMatch(/\btext-display-md\b/)
    // разрыв остаётся последним рубежом — для того, что не влезло и так
    expect(cls).toContain('[overflow-wrap:anywhere]')
  })
})

/*
 * «Что нового» на карточке — восемь последних патчей, а хранится до
 * тридцати: остальные — в архиве обновлений игры (/game/<appid>/news,
 * lib/patcharchive). Ссылка туда — только когда патчей больше, чем мест: при
 * трёх, да и при ровно восьми архив повторил бы те же строки.
 */
describe('ссылка на архив обновлений', () => {
  const archiveLinks = async () =>
    islandsOf(flight(await GamePage(params)), 'Link').filter((l) => l.href === `/game/${APPID}/news`)

  test('девятый патч не влез на карточку — «Все обновления», без префетча', async () => {
    await upsertGameMeta(db, game(APPID, { name: 'Counter-Strike 2' }), T0)
    await upsertNewsItems(
      db,
      Array.from({ length: 9 }, (_, i) => patch(String(i + 1), T0 - (i + 1) * DAY, 9000)),
      T0,
    )
    const links = await archiveLinks()
    expect(links).toHaveLength(1)
    expect(links[0]?.prefetch).toBe(false)
    expect(textOf(links[0]?.children)).toContain('Все обновления «Counter-Strike 2»')
  })

  /*
   * Полная лента — ещё не повод: восемь патчей из восьми выглядят так же, как
   * восемь из тридцати, а архив в первом случае — те же восемь строк.
   */
  test('ровно восемь патчей — лента полна, но ссылки нет: архиву нечего добавить', async () => {
    await upsertGameMeta(db, game(APPID), T0)
    await upsertNewsItems(
      db,
      Array.from({ length: 8 }, (_, i) => patch(String(i + 1), T0 - (i + 1) * DAY, 9000)),
      T0,
    )
    expect(await archiveLinks()).toEqual([])
  })

  test('патчей меньше, чем мест на карточке, — ссылки нет: все и так здесь', async () => {
    await upsertGameMeta(db, game(APPID), T0)
    await upsertNewsItems(db, [patch('1', T0 - DAY, 9000), patch('2', T0 - 2 * DAY, 9000)], T0)
    expect(await archiveLinks()).toEqual([])
  })
})

/**
 * Правки цикла 3 на английской карточке: кольцо из всех языков, пульс под
 * ним, обычная цена погасшей распродажи, ссылка на архив обновлений и
 * русское название. Русский вывод тех же правок — тестами выше.
 */
describe('английская карточка: пульс, цена, архив и второе название', () => {
  const CYR = /[А-Яа-яЁё]/
  const en = { params: Promise.resolve({ appid: String(APPID), lang: 'en' }) }

  test('кольцо и пульс по-английски, строки «На русском» нет', async () => {
    await seed()
    await db.execute({
      sql: `UPDATE games SET reviews_all_total = 309180, reviews_all_percent = 97, reviews_all_score = 9,
              reviews_ru_total = 16893, reviews_ru_percent = 96,
              reviews_recent_total = 7948, reviews_recent_percent = 71, reviews_recent_at = ?
            WHERE appid = ?`,
      args: [T0 - DAY, APPID],
    })
    // Соседи по-английски: кириллица на /en — только в чужих данных, а здесь их нет
    await db.execute({ sql: "UPDATE games SET name = 'Game ' || appid WHERE appid BETWEEN 10 AND 17", args: [] })
    lang.locale = 'en'
    const text = textOf(visible(await GamePage(en)))
    expect(text).toContain('Overwhelmingly Positive')
    expect(text).toContain('of 309,180 reviews')
    // 1_760_000_000 — 9 октября 2025 UTC, замер — сутками раньше
    expect(text).toContain('30 days through October 8:71% of 7,948 reviews are positive — lower than overall')
    expect(text).not.toMatch(/16,893|16\s893/)
    expect(text).not.toMatch(CYR)
  })

  test('погасшая распродажа: «regular price» с подписью по-английски', async () => {
    await upsertGameMeta(
      db,
      game(APPID, {
        name: 'Hades',
        priceFinal: 999,
        priceInitial: 1999,
        discountPercent: 50,
        discountEndsAt: T0 - DAY,
        priceAt: T0 - 10 * DAY,
      }),
      T0,
    )
    lang.locale = 'en'
    const text = textOf(visible(await GamePage(en)))
    expect(text).toContain('regular price')
    expect(text).toContain("We checked this price during a sale and don't know if the sale is still on — it may be cheaper on Steam")
    expect(text).not.toContain('обычная цена')
  })

  test('ссылка на архив обновлений — по-английски и без префетча', async () => {
    await upsertGameMeta(db, game(APPID, { name: 'Counter-Strike 2' }), T0)
    await upsertNewsItems(
      db,
      Array.from({ length: 9 }, (_, i) => patch(String(i + 1), T0 - (i + 1) * DAY, 9000)),
      T0,
    )
    const links = islandsOf(flight(await GamePage(en)), 'Link').filter((l) => l.href === `/game/${APPID}/news`)
    expect(links).toHaveLength(1)
    expect(links[0]?.prefetch).toBe(false)
    expect(textOf(links[0]?.children)).toBe('All Counter-Strike 2 updates')
  })

  /*
   * Название — данные: у части верха каталога games.name держит русское имя
   * магазина, пока его не перепишет английская запись (nameSql в lib/db).
   * Переводить его нельзя (docs/i18n.md, п. 6), но там, где его рисует сама
   * страница, — в h1 и в обеих ссылках link-more — на /en оно помечено
   * lang="ru" (WCAG 3.1.2). Русская страница и латинское название — без
   * атрибута и без лишнего <span>, как были.
   */
  describe('русское название из данных', () => {
    // Русское имя магазина из базы: кириллица перевешивает латиницу (textLangOn)
    const NAME = 'Marvel Человек-Паук 2'
    const quiz = quizHref(null, APPID)

    /** Пропсы первого h1 раскрытой страницы */
    function h1Of(page: unknown): { lang?: unknown; children?: unknown } {
      let found: { lang?: unknown; children?: unknown } | undefined
      const walk = (n: unknown): void => {
        if (found || n === null || typeof n !== 'object') return
        const rec = n as { tag?: string; props?: { lang?: unknown; children?: unknown } }
        if (rec.tag === 'h1') found = rec.props ?? {}
        else Object.values(n).forEach(walk)
      }
      walk(page)
      expect(found, 'h1 на карточке не найден — сторож ослеп').toBeDefined()
      return found!
    }

    function linkOf(page: unknown, href: string): Record<string, unknown> {
      const [link] = islandsOf(page, 'Link').filter((l) => l.href === href)
      expect(link, href).toBeDefined()
      return link
    }

    /** Тексты всех <span lang="ru"> внутри узла */
    function ruSpans(node: unknown): string[] {
      const out: string[] = []
      const walk = (n: unknown): void => {
        if (n === null || typeof n !== 'object') return
        const rec = n as { tag?: string; props?: { lang?: unknown; children?: unknown } }
        if (rec.tag === 'span' && rec.props?.lang === 'ru') out.push(textOf(rec.props.children))
        Object.values(n).forEach(walk)
      }
      walk(node)
      return out
    }

    test('на /en — lang="ru" в h1 и на самом названии в обеих ссылках', async () => {
      await seed({ name: NAME })
      // девять патчей — больше, чем мест на карточке: есть ссылка на архив
      await upsertNewsItems(
        db,
        Array.from({ length: 7 }, (_, i) => patch(String(i + 3), T0 - (i + 3) * DAY, 9000)),
        T0,
      )
      lang.locale = 'en'
      const page = flight(await GamePage(en))
      expect(h1Of(page)).toMatchObject({ lang: 'ru', children: NAME })
      const archive = linkOf(page, `/game/${APPID}/news`)
      expect(textOf(archive.children)).toBe(`All ${NAME} updates`)
      expect(ruSpans(archive.children)).toEqual([NAME])
      const similar = linkOf(page, quiz)
      expect(textOf(similar.children)).toBe(`Similar to “${NAME}”, for your mood`)
      expect(ruSpans(similar.children)).toEqual([NAME])
      // Фраза — одним флекс-элементом рядом со стрелкой: .link-more — inline-flex
      // с gap, и куски вокруг названия иначе вставали врозь (oneItem в lib/textlang)
      for (const link of [archive, similar]) {
        const [phrase, arrow, ...rest] = link.children as Array<{ tag?: string; props?: { lang?: unknown } }>
        expect(rest, 'у ссылки больше двух детей — фраза рассыпалась').toEqual([])
        expect(phrase).toMatchObject({ tag: 'span' })
        expect(phrase.props?.lang, 'обёртка без lang: свой lang — только у названия').toBeUndefined()
        expect(textOf(arrow)).toBe('')
      }
    })

    test('на русской — без атрибута и без <span>: разметка прежняя', async () => {
      await seed({ name: NAME })
      await upsertNewsItems(
        db,
        Array.from({ length: 7 }, (_, i) => patch(String(i + 3), T0 - (i + 3) * DAY, 9000)),
        T0,
      )
      const page = flight(await GamePage(params))
      expect(h1Of(page).lang).toBeUndefined()
      expect(ruSpans(page)).toEqual([])
      expect(linkOf(page, `/game/${APPID}/news`).children).toContainEqual(`Все обновления «${NAME}»`)
    })

    /*
     * «More from CD PROJEKT RED: ГВИНТ: Ведьмак. Карточная игра» — на проде
     * i18n-audit нашёл эту ссылку без пометки: h1 помечал название своей
     * игры, а названия соседей по студии шли голым текстом. Ссылка целиком —
     * название, и lang стоит на ней самой.
     */
    test('«Ещё у студии»: русское название соседа на /en — lang на ссылке; на русской — без него', async () => {
      await seed()
      // Прямо в name: апсерт русское к латинскому увёл бы во второе название
      await db.execute("UPDATE games SET name = 'Портал 2' WHERE appid = 620")
      const studio = (page: unknown) =>
        Object.fromEntries(
          islandsOf(page, 'Link')
            .filter((l) => l.href === '/game/400' || l.href === '/game/620')
            .map((l) => [String(l.href), l.lang]),
        )
      const ru = flight(await GamePage(params))
      expect(studio(ru)).toEqual({ '/game/400': undefined, '/game/620': undefined })
      // и пропса нет вовсе: lang={undefined} RSC-часть сериализует строкой (langAttr)
      const ruLinks = islandsOf(ru, 'Link').filter((l) => l.href === '/game/400' || l.href === '/game/620')
      expect(ruLinks.some((l) => 'lang' in l)).toBe(false)
      lang.locale = 'en'
      const page = flight(await GamePage(en))
      expect(textOf(page)).toContain('More from Valve: Portal · Портал 2')
      // Латинский сосед — без атрибута, как был
      expect(studio(page)).toEqual({ '/game/400': undefined, '/game/620': 'ru' })
    })

    test('латинское название на /en — без атрибута и без лишнего <span>', async () => {
      await seed()
      // Соседи по-английски: их русские имена — уже не название этой страницы
      await db.execute({ sql: "UPDATE games SET name = 'Game ' || appid WHERE appid BETWEEN 10 AND 17", args: [] })
      lang.locale = 'en'
      const page = flight(await GamePage(en))
      expect(h1Of(page).lang).toBeUndefined()
      expect(ruSpans(page)).toEqual([])
      const similar = linkOf(page, quiz).children
      expect(textOf(similar)).toBe('Similar to “Counter-Strike 2”, for your mood')
      expect(JSON.stringify(similar)).not.toContain('"tag":"span"')
    })
  })

  test('русского названия на /en нет — ни строкой под заголовком, ни alternateName', async () => {
    await upsertGameMeta(db, game(APPID, { name: 'The Witcher 3: Wild Hunt' }), T0)
    await upsertGameMeta(db, game(APPID, { name: 'Ведьмак 3: Дикая Охота' }), T0 + 10)
    // русская страница его показывает (тест выше) — сторож не слепой
    expect(textOf(flight(await GamePage(params)))).toContain('Ведьмак 3: Дикая Охота')
    lang.locale = 'en'
    const page = flight(await GamePage(en))
    expect(textOf(page)).not.toContain('Ведьмак')
    expect(jsonLdOf(page)[0]).not.toHaveProperty('alternateName')
    expect(jsonLdOf(page)[0]).toMatchObject({ name: 'The Witcher 3: Wild Hunt' })
  })
})

/*
 * Микротрейлер (components/TrailerPreview): название игры — хвостом
 * доступного имени кнопки и в подписи самого ролика. На проде i18n-audit
 * нашёл на /en/game/1888930 «span.sr-only: Одни из нас™: Часть I» без пометки
 * и aria-label «Одни из нас™: Часть I: a few seconds of gameplay, no sound».
 * Хвост — своим <span lang="ru">; атрибуту lang не поставить, и русское
 * название из подписи на /en уходит — как у скриншотов ниже. Русская
 * страница и латинское название — прежняя разметка до байта.
 */
describe('трейлер: русское название на /en', () => {
  const TRAILER = { mp4: 'https://cdn.example/730/t.mp4', poster: 'https://cdn.example/730/p.jpg' }

  function html(locale: Locale, name: string, compact = false): string {
    lang.locale = locale
    return renderToStaticMarkup(createElement(TrailerPreview, { trailer: TRAILER, name, compact }))
  }
  const ariaOf = (h: string) => h.match(/<video [^>]*aria-label="([^"]*)"/)?.[1]

  test.each([false, true])('на /en: хвост кнопки — <span lang="ru">, подпись ролика — без названия (compact: %s)', (compact) => {
    const h = html('en', 'Одни из нас™: Часть I', compact)
    expect(h).toContain('<span class="sr-only">, <span lang="ru">Одни из нас™: Часть I</span></span>')
    expect(ariaOf(h)).toBe('A few seconds of gameplay, no sound')
  })

  test('латинское название на /en — прежние хвост и подпись с названием', () => {
    const h = html('en', 'Counter-Strike 2')
    expect(h).toContain('<span class="sr-only">, Counter-Strike 2</span>')
    expect(ariaOf(h)).toBe('Counter-Strike 2: a few seconds of gameplay, no sound')
  })

  test('русская страница — прежняя разметка, и с русским названием тоже', () => {
    const h = html('ru', 'Одни из нас™: Часть I')
    expect(h).toContain('<span class="sr-only">, Одни из нас™: Часть I</span>')
    expect(h).not.toContain('lang=')
    expect(ariaOf(h)).toBe('Одни из нас™: Часть I: несколько секунд геймплея без звука')
  })
})

/*
 * Подписи блока «Скриншоты» (shotLabels в components/GameShots): alt первого
 * кадра и имя карусели. Название — данные, и на /en оно бывает русским, а у
 * части атрибута своего lang не бывает: английский голос читал бы такую
 * подпись по буквам. Поэтому на /en название с кириллицей в подпись не
 * встаёт; русская страница и латинское название — прежние подписи до байта.
 */
describe('подписи скриншотов', () => {
  const SHOTS = ['https://cdn.example/730/s1.jpg', 'https://cdn.example/730/s2.jpg']

  /** alt первого кадра в серверной разметке островка (слайдер сервер не рисует) */
  function altOn(locale: Locale, name: string): string | undefined {
    lang.locale = locale
    const html = renderToStaticMarkup(createElement(GameShots, { images: SHOTS, name }))
    return html.match(/<img [^>]*alt="([^"]*)"/)?.[1]
  }

  test.each([
    'Marvel Человек-Паук 2',
    'Одни из нас™: Часть II Обновленная версия',
    // букв поровну: h1 langOn помечает, а у подписи-атрибута своего lang нет — русское слово в ней то же чтение по буквам
    'God of War Рагнарёк',
  ])('на /en русское название в подпись не встаёт: %s', (name) => {
    expect(shotLabels('en', name)).toEqual({ alt: 'Screenshot', label: 'Screenshots' })
    expect(altOn('en', name)).toBe('Screenshot')
  })

  test('латинское название на /en — прежние подписи с названием', () => {
    expect(shotLabels('en', 'Counter-Strike 2')).toEqual({
      alt: 'Counter-Strike 2 screenshot',
      label: 'Counter-Strike 2 screenshots',
    })
    expect(altOn('en', 'Counter-Strike 2')).toBe('Counter-Strike 2 screenshot')
  })

  test('русская страница — прежние подписи, и с русским названием тоже', () => {
    for (const name of ['Marvel Человек-Паук 2', 'Counter-Strike 2']) {
      expect(shotLabels('ru', name)).toEqual({ alt: `Скриншот — ${name}`, label: `Скриншоты — ${name}` })
      expect(altOn('ru', name)).toBe(`Скриншот — ${name}`)
    }
  })

  // Карусель сервер не рисует (ssr: false), поэтому её имя сторожит исходник:
  // label — из тех же подписей, а не шаблон с названием мимо них
  test('карусель и первый кадр подписаны одними shotLabels', () => {
    const src = fs
      .readFileSync(path.join(__dirname, '..', '..', '..', '..', 'components', 'GameShots.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*/gm, '')
    const at = src.indexOf('<MorphSlider')
    expect(at, '<MorphSlider> не найден — сторож ослеп').toBeGreaterThan(-1)
    expect(src.slice(at, src.indexOf('/>', at))).toMatch(/\blabel=\{labels\.label\}/)
    expect(src).toMatch(/\balt=\{labels\.alt\}/)
    expect(src).toContain('const labels = shotLabels(locale, name)')
  })
})
