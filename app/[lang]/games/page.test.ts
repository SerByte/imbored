import fs from 'node:fs'
import path from 'node:path'
import type { ResolvingMetadata } from 'next'
import Link from '@/components/Link'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { SearchLauncher } from '@/components/SearchLauncher'
import { TilePending } from '@/components/TilePending'
import { SHELF_RAIL_SIZES } from '@/lib/art'
import { replaceGameTags, upsertGameMeta, upsertSemantics, type Db } from '@/lib/db'
import { facetCopy, HUB_FACETS, storedTagWeights } from '@/lib/gamehub'
import type { GameMeta, GameSemantics } from '@/lib/types'
import { flight as flightOf, imageHints, islandsOf, textOf } from '@/lib/testing/flight'
import { freshDb } from '@/lib/testing/route'
import { loadGenre } from './[tag]/load'
import GenrePage, {
  dynamicParams as genreDynamicParams,
  generateMetadata,
  generateStaticParams,
  revalidate as genreRevalidate,
} from './[tag]/page'
import GamesHubPage, {
  dynamicParams as hubDynamicParams,
  generateMetadata as generateHubMetadata,
  revalidate as hubRevalidate,
} from './page'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Хаб жанров и страницы жанров — серверными капсулами (StaticGameCardBody).
 *
 * До этого у каждой из 360 капсул хаба был свой островок GameArt, и в
 * RSC-часть страницы уезжал весь объект арта: пять ссылок плюс дубль header,
 * а плитке нужны две. 761 КБ HTML, из них около 528 КБ RSC-данных
 * (perf-10 аудита). Страницы живут в ISR, так что это были и лишние ISR
 * Writes. Откатить правку легко и незаметно — страница рисуется так же,
 * просто тяжелее; поэтому здесь сама страница, раскрытая так, как её
 * сериализует Next.
 */

/**
 * GameArt — в списке, чтобы его возвращение было видно, а не роняло тест.
 * SearchLauncher — строка «Найти игру по названию» над полками.
 * TilePending — знак ожидания внутри каждой капсулы (components/GameLink).
 */
const ISLANDS = new Map<unknown, string>([
  [Link, 'Link'],
  [GameArt, 'GameArt'],
  [SearchLauncher, 'SearchLauncher'],
  [TilePending, 'TilePending'],
])
const flight = (node: unknown) => flightOf(node, ISLANDS)

const T0 = 1_760_000_000

let db: Db

beforeEach(async () => {
  db = await freshDb()
  // Полка набирается от HUB_MIN_SHELF игр, для которых жанр главный
  for (let appid = 1; appid <= 8; appid++) {
    const art = `https://cdn.example/${appid}`
    await upsertGameMeta(
      db,
      {
        appid,
        name: `Игра ${appid}`,
        tags: { 'Open World': 1000 },
        genres: [],
        categories: [2],
        headerImage: `${art}/header.jpg`,
        art: {
          header: `${art}/header.jpg`,
          header2x: `${art}/header_2x.jpg`,
          capsule: `${art}/capsule.jpg`,
          hero: `${art}/hero.jpg`,
          hero2x: `${art}/hero_2x.jpg`,
        },
        reviewsTotal: 10_000 - appid,
        reviewsPercent: 90,
      },
      T0,
    )
    await replaceGameTags(db, appid, [{ tag: 'Open World', weight: 1000 }])
    // Строка отзывов на плитке — все языки из сверки каталога (shownReviews),
    // а не англоязычная шкала порогов выше: та на плитку не выходит
    await db.execute({
      sql: 'UPDATE games SET reviews_all_total = ?, reviews_all_percent = 91 WHERE appid = ?',
      args: [30_000 - appid, appid],
    })
  }
})

// Пререндер жанров зависит от VERCEL_ENV (prerenderAtBuild) — тесты его подменяют
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('хаб /games', () => {
  test('капсулы серверные: ни одного GameArt, и арта героя в странице нет', async () => {
    const page = flight(await GamesHubPage())
    expect(islandsOf(page, 'GameArt')).toEqual([])
    const text = JSON.stringify(page)
    expect(text).toContain('https://cdn.example/1/header.jpg')
    expect(text).not.toContain('hero.jpg')
    expect(text).not.toContain('hero_2x.jpg')
  })

  /*
   * Двенадцать игр на жанр из тысяч: за конкретной игрой хаб отправляет в
   * поиск по названию. Строкой, а не значком: значок в шапке на планшете
   * спрятан (нет места), и строка на хабе — его поиск.
   */
  test('над полками — строка поиска по названию', async () => {
    expect(islandsOf(flight(await GamesHubPage()), 'SearchLauncher')).toEqual([
      { island: 'SearchLauncher', variant: 'field' },
    ])
  })

  // Русская полка — подписью тега, как была: заголовок жанра («Игры с
  // открытым миром») берёт только английская (sentence case вместо тега Steam)
  test('заголовок русской полки — подпись тега', async () => {
    const text = textOf(flight(await GamesHubPage()))
    expect(text).toContain('Открытый мирВесь жанр: Открытый мир')
    expect(text).not.toContain('Игры с открытым миром')
  })

  test('первые капсулы первой полки грузятся сразу, остальные лениво', async () => {
    const text = JSON.stringify(flight(await GamesHubPage()))
    expect(text.match(/"loading":"eager"/g)).toHaveLength(5)
    expect(text.match(/"loading":"lazy"/g)).toHaveLength(3)
  })

  /*
   * «Каталог» в шапке, ссылка в подвале и крошки каждой карточки игры
   * префетчат хаб, и подсказки предзагрузки из его RSC-части браузер
   * исполнял на той странице, где стоит ссылка: пять обложек первой полки
   * (215 КБ, на ретине 401 КБ) на /support, на /privacy, на каждой
   * карточке игры и каждом патче — мимо экрана. Капсулы eager, и Flight
   * ставил на каждую `:HL[…,"image"]` (см. StaticGameCardBody).
   */
  test('префетч хаба не тащит его обложки на чужую страницу', async () => {
    expect(imageHints(flight(await GamesHubPage()))).toEqual([])
  })

  /*
   * Обёртка <picture> нужна только eager-обложкам: ленивым подсказку React не
   * ставит и так. На всех 360 капсулах хаба она стоила бы ~20 КБ RSC-части и
   * столько же HTML на каждую перегенерацию.
   */
  test('<picture> — только у eager-обложек', async () => {
    const text = JSON.stringify(flight(await GamesHubPage()))
    expect(text.match(/"tag":"picture"/g)).toHaveLength(5)
  })

  /*
   * LCP хаба на телефоне — первая капсула, и в очереди она стояла Low рядом
   * с четырьмя eager-соседями (3.7–3.8 с на проде). Высокий приоритет —
   * ей одной: у всех сразу он не значил бы ничего.
   */
  test('высокий приоритет — только у первой капсулы первой полки', async () => {
    const text = JSON.stringify(flight(await GamesHubPage()))
    expect(text.match(/"fetchPriority":"high"/g)).toHaveLength(1)
    const first = text.indexOf('"loading":"eager"')
    expect(text.indexOf('"fetchPriority":"high"')).toBeGreaterThan(first)
    expect(text.indexOf('"fetchPriority":"high"')).toBeLessThan(text.indexOf('"loading":"eager"', first + 1))
  })

  test('sizes капсулы — ширина ряда на каждом экране, а не одно число', async () => {
    const text = JSON.stringify(flight(await GamesHubPage()))
    expect(text).toContain(`"sizes":"${SHELF_RAIL_SIZES}"`)
    expect(text).not.toMatch(/"sizes":"\d+px"/)
  })
})

describe('страница жанра /games/<slug>', () => {
  const params = { params: Promise.resolve({ tag: 'open-world' }) }

  test('капсулы серверные, с номером в углу и строкой отзывов под названием', async () => {
    const page = flight(await GenrePage(params))
    expect(islandsOf(page, 'GameArt')).toEqual([])
    const text = JSON.stringify(page)
    expect(text).not.toContain('hero.jpg')
    // номер места — угол обложки, «91% из 30 тыс.» — строка под названием:
    // все языки, а не англоязычные «90% из 10 тыс.»
    expect(text).toContain('"className":"lib-badge badge-line tabular-nums","children":1')
    expect(text).toMatch(/91% из 30 тыс\./)
    expect(text).not.toMatch(/90%/)
    expect(text.match(/"loading":"eager"/g)).toHaveLength(3)
  })

  /*
   * Страницу жанра префетчит крошка «Игры по жанрам → <жанр>» наверху
   * каждой карточки игры: три eager-обложки уезжали подсказками на телефон,
   * который смотрел совсем другую игру.
   */
  test('префетч страницы жанра не тащит её обложки на карточку игры', async () => {
    expect(imageHints(flight(await GenrePage(params)))).toEqual([])
  })
})

/**
 * Кэш хаба и страниц жанра — ISR Writes лимита Hobby. Неделя, а не сутки:
 * запись хаба — ~225 блоков на язык, жанра — 55–90, и вывод расходится с
 * прошлым почти каждый день (докблоки revalidate в page.tsx). Next читает
 * revalidate только литералом — поэтому сверяется и сам литерал.
 *
 * Пререндер жанров — только на продовой сборке (prerenderAtBuild): превью
 * пререндерили те же 68 страниц на каждой сборке. Вне прода список пустой,
 * и страница стоит под dynamicParams = true — с false пустой список значил
 * бы 404 на каждый жанр превью. Чужой адрес от этого 404 быть не перестал:
 * его решает страница (notFound), а не сборка.
 */
describe('кэш хаба и страниц жанра', () => {
  const literal = (file: string) =>
    Number(
      fs
        .readFileSync(path.join(__dirname, file), 'utf8')
        .match(/export const revalidate = ([\d_]+)\n/)?.[1]
        ?.replace(/_/g, ''),
    )

  test('неделя — у хаба и у страницы жанра, литералом', () => {
    expect(hubRevalidate).toBe(7 * 86_400)
    expect(genreRevalidate).toBe(7 * 86_400)
    expect(literal('page.tsx')).toBe(hubRevalidate)
    expect(literal('[tag]/page.tsx')).toBe(genreRevalidate)
  })

  test('жанры пререндерятся только на продовой сборке, хаб остаётся закрытым по языку', () => {
    vi.stubEnv('VERCEL_ENV', undefined)
    expect(generateStaticParams()).toEqual([])
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(generateStaticParams()).toEqual([])
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(generateStaticParams().length).toBeGreaterThan(30)

    expect(genreDynamicParams).toBe(true)
    // у хаба других параметров, кроме языка, нет: чужой язык — 404 без рендера
    expect(hubDynamicParams).toBe(false)
  })

  test('чужой адрес под dynamicParams = true — 404 страницы, а не пустой жанр', async () => {
    const params = (tag: string) => ({ params: Promise.resolve({ tag, lang: 'en' }) })
    await expect(GenrePage(params('no-such-genre'))).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/)
    expect(await generateMetadata(params('no-such-genre'))).toEqual({})
    // знакомый адрес на той же сборке без пререндера — рисуется
    await expect(GenrePage(params('open-world'))).resolves.toBeDefined()
  })
})

/**
 * Подборки по факту — тот же сегмент /games/<slug>, что у жанров
 * (lib/gamehub, HUB_FACETS). Здесь — то, ради чего они заведены: «с другом»
 * не отдаёт верх списка Dota 2, «на 20 минут» не называет короткой то, что
 * карточка называет матчем, а подборка про компанию ведёт в /compat и
 * зовёт в комнату с игрой первой картой.
 */
describe('подборки /games/<slug>', () => {
  /** Игра каталога с тегами и категориями — как её кладёт заливка */
  async function seed(
    appid: number,
    over: Partial<GameMeta> & { tags: Record<string, number> },
  ): Promise<void> {
    const meta: GameMeta = {
      appid,
      name: `Игра ${appid}`,
      genres: [],
      categories: [2],
      headerImage: `https://cdn.example/${appid}/header.jpg`,
      reviewsTotal: 10_000,
      reviewsPercent: 90,
      ...over,
    }
    await upsertGameMeta(db, meta, T0)
    await replaceGameTags(db, appid, storedTagWeights(meta.tags))
  }

  /** Семантика, которой карточка верит (confidence выше порога), — посреди не бросишь */
  const sem = (minutes: number, over: Partial<GameSemantics> = {}): GameSemantics => ({
    v: 1,
    axes: { challenge: 50, complexity: 50, pace: 50 },
    session: { bucket: minutes < 30 ? 'short' : 'medium', minutes, canStopAnytime: false },
    timeToFun: { bucket: null, hours: null },
    confidence: 0.7,
    n: 60,
    basis: 'tags+reviews',
    ...over,
  })

  const facetParams = (tag: string) => ({ params: Promise.resolve({ tag }) })
  /** Игры страницы по порядку — ссылки карточек (GameLink — это Link на /game/<appid>) */
  const shown = async (tag: string) =>
    islandsOf(flight(await GenrePage(facetParams(tag))), 'Link').flatMap((l) => {
      const m = /^\/game\/(\d+)$/.exec(String(l.href))
      return m ? [Number(m[1])] : []
    })

  test('адреса подборок собираются на продовой сборке рядом с жанрами', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    const slugs = generateStaticParams().map((p) => p.tag)
    for (const f of HUB_FACETS) expect(slugs).toContain(f.slug)
    expect(slugs).toContain('open-world')
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  test('«с другом»: кооператив по отзывам, но без Dota — соперничество там весит больше', async () => {
    // Dota: кооператив в категориях есть, а в тегах MOBA перевешивает его
    await seed(570, {
      categories: [1, 9],
      tags: { 'Free to Play': 1000, MOBA: 339, Strategy: 330, 'Online Co-Op': 126 },
      reviewsTotal: 900_000,
    })
    await seed(553850, { categories: [1, 9, 38], tags: { 'Online Co-Op': 1000, PvE: 896 }, reviewsTotal: 600_000 })
    await seed(1426210, { categories: [1, 9, 38, 39, 24], tags: { 'Co-op': 1000, 'Split Screen': 900 } })
    // без кооператива в категориях — не на этой странице, сколько бы ни было отзывов
    await seed(730, { categories: [1, 27], tags: { FPS: 1000, PvP: 900 }, reviewsTotal: 2_500_000 })
    expect(await shown('coop')).toEqual([553850, 1426210])
  })

  /*
   * Подборка и карточка судят соперничество одним словарём тегов (VERSUS_TAGS
   * в lib/gametraits), но разными вопросами: «с другом» — чьих голосов больше,
   * «Матч» — есть ли противник-человек вообще. Кампании на двоих «Матч» не
   * достаётся ни там, ни там: прежнее правило карточки звало матчем всякий
   * кооп без одиночного режима, и It Takes Two на /games/coop стояла бы с
   * «Матч: ~40 мин». А командная игра против людей честно бывает и тем, и тем.
   */
  test('«с другом»: у кампании на двоих — «Сессия», «Матч» — только у игры против людей', async () => {
    await seed(1426210, {
      categories: [1, 9, 38, 39, 24],
      tags: { 'Co-op': 1486, 'Split Screen': 892, 'Local Co-Op': 864, 'Online Co-Op': 733, Puzzle: 681 },
      reviewsTotal: 300_000,
    })
    // выживание командой против охотника: кооператив весит больше PvP — на странице, но это матч
    await seed(381210, {
      categories: [1, 49, 36, 9, 38],
      tags: { Horror: 1000, 'Online Co-Op': 900, Survival: 800, PvP: 600 },
      reviewsTotal: 200_000,
    })
    await upsertSemantics(db, [
      { appid: 1426210, semantics: sem(40), computedAt: T0 },
      { appid: 381210, semantics: sem(25), computedAt: T0 },
    ])
    const sessions = new Map((await loadGenre('coop'))!.games.map((g) => [g.appid, g.session]))
    expect([...sessions.keys()]).toEqual([1426210, 381210])
    expect(sessions.get(1426210)).toEqual({ label: 'Сессия', value: '~40 мин' })
    expect(sessions.get(381210)).toEqual({ label: 'Матч', value: '~25 мин' })
  })

  test('«с другом» зовёт в комнату с игрой и в /compat, а не в квиз', async () => {
    await seed(553850, { categories: [1, 9, 38], tags: { 'Online Co-Op': 1000 }, ccu: 50_000 })
    const page = flight(await GenrePage(facetParams('coop')))
    const links = islandsOf(page, 'Link').map((l) => ({ href: l.href, prefetch: l.prefetch }))
    expect(links).toContainEqual({ href: '/room/new?game=553850', prefetch: false })
    // /compat собирается на каждый запрос — без префетча (lib/nav)
    expect(links).toContainEqual({ href: '/compat', prefetch: false })
    expect(links.some((l) => l.href === '/quiz')).toBe(false)
  })

  test('«на одном экране» дуэли не выбрасывает: файтинг вдвоём на диване — тоже ответ', async () => {
    await seed(389730, { categories: [2, 1, 49, 36, 37, 24], tags: { Fighting: 1000, PvP: 800 } })
    await seed(268910, { categories: [2, 1, 9, 39, 24], tags: { 'Co-op': 1000 } })
    await seed(553850, { categories: [1, 9, 38], tags: { 'Online Co-Op': 1000 } })
    expect((await shown('split-screen')).sort((a, b) => a - b)).toEqual([268910, 389730])
  })

  test('бесплатные — по флагу Steam; одиночной подборке «Позвать» не к чему', async () => {
    await seed(440, { categories: [1, 9, 38], tags: { FPS: 1000 }, isFree: true })
    await seed(620, { categories: [2, 1, 9, 38], tags: { Puzzle: 1000 } })
    expect(await shown('free')).toEqual([440])
    const page = flight(await GenrePage(facetParams('free')))
    expect(islandsOf(page, 'Link').some((l) => String(l.href).startsWith('/room/new'))).toBe(false)
    expect(islandsOf(page, 'Link').some((l) => l.href === '/quiz')).toBe(true)
  })

  test('«на 20 минут» — только уверенная короткая сессия, и не матч', async () => {
    // одиночная короткая — «Сессия: ~20 мин»
    await seed(1942280, { categories: [2], tags: { Roguelite: 1000 } })
    // сетевая без одиночного режима, бросить посреди нельзя — карточка скажет «Матч»
    await seed(730, { categories: [1], tags: { FPS: 1000 } })
    // короткая, но по одним тегам — неуверенно
    await seed(10, { categories: [2], tags: { Casual: 1000 } })
    // уверенная, но заход длинный
    await seed(20, { categories: [2], tags: { CRPG: 1000 } })
    // кооп без одиночного режима, но без противника-человека — не матч, а заход на двоих
    await seed(30, { categories: [1, 9, 38, 39, 24], tags: { 'Co-op': 1000, Puzzle: 800 }, reviewsTotal: 20_000 })
    await upsertSemantics(db, [
      { appid: 1942280, semantics: sem(20), computedAt: T0 },
      { appid: 730, semantics: sem(25), computedAt: T0 },
      { appid: 10, semantics: sem(15, { confidence: 0.3, basis: 'tags' }), computedAt: T0 },
      { appid: 20, semantics: sem(90), computedAt: T0 },
      { appid: 30, semantics: sem(20), computedAt: T0 },
    ])
    expect(await shown('short')).toEqual([30, 1942280])
    // выход — пресет «30 минут до сна», то же короткое настроение из своей библиотеки
    const hrefs = islandsOf(flight(await GenrePage(facetParams('short'))), 'Link').map((l) => String(l.href))
    expect(hrefs.some((h) => h.startsWith('/play?time=short'))).toBe(true)
  })

  test('<title> подборки отвечает на вопрос, а не «лучшие в жанре»; тонкая — вне индекса', async () => {
    await seed(553850, { categories: [1, 9, 38], tags: { 'Online Co-Op': 1000 } })
    const meta = await generateMetadata(facetParams('coop'))
    expect(meta.title).toBe('Кооперативные игры — во что поиграть с другом')
    expect(meta.alternates?.canonical).toBe('/games/coop')
    // одна игра — не список, как у жанра (HUB_MIN_SHELF)
    expect(meta.robots).toEqual({ index: false, follow: true })
  })

  test('незнакомый адрес — по-прежнему 404, а не пустая подборка', async () => {
    expect(await generateMetadata(facetParams('co-op'))).toEqual({})
  })
})

describe('хаб /games: ряд подборок над полками', () => {
  test('каждая подборка — ссылкой без префетча', async () => {
    const links = islandsOf(flight(await GamesHubPage()), 'Link')
    for (const f of HUB_FACETS) {
      expect(links).toContainEqual(expect.objectContaining({ href: `/games/${f.slug}`, prefetch: false }))
    }
  })
})

/**
 * Английские хаб и жанр: /en/games и /en/games/open-world — те же полки и
 * те же игры, подписи — на языке params. Названия игр — данные, и в
 * фикстуре они латиницей: кириллица на /en осталась бы только недоведённой
 * строкой интерфейса.
 */
describe('английские хаб и страница жанра', () => {
  const CYR = /[А-Яа-яЁё]/
  const en = <T extends object>(p: T) => ({ params: Promise.resolve({ ...p, lang: 'en' }) })
  const latin = () => db.execute({ sql: "UPDATE games SET name = 'Game ' || appid", args: [] })

  /*
   * Заголовок полки — заголовок страницы жанра (hubTitle), sentence case:
   * сырой тег Steam «Open World» стоял бы Title Case посреди английской
   * страницы. Скринридеру «See all» договаривает тот же заголовок.
   */
  test('хаб: подписи по-английски, полка — заголовок жанра, а не тег Steam', async () => {
    await latin()
    const page = flight(await GamesHubPage(en({})))
    const text = textOf(page)
    for (const s of ['Catalog', 'Games by genre', 'Open-world games', 'See all: Open-world games', 'Find a game for your mood']) {
      expect(text, s).toContain(s)
    }
    expect(text).not.toContain('Open World')
    // ряд подборок над полками — подписями своего языка (facetCopy)
    for (const f of HUB_FACETS) expect(text, f.slug).toContain(facetCopy(f, 'en').label)
    expect(text).not.toMatch(CYR)
  })

  /*
   * Подпись хаба — у страницы, а не у layout сегмента: метаданные layout
   * наследовала бы 404 жанра (/en/games/<нет такого>, notFound() у [tag]),
   * и её голова называлась бы хабом (докблок META в page.tsx).
   * Строка title без своего шаблона — шаблон корня Next ставит к ней сам.
   * Русская пара — та же, что до перевода: ownAddress('/games', { title,
   * description }) у страницы.
   */
  test('хаб: title и description — у страницы, на языке страницы', async () => {
    const root = Promise.resolve({ title: { absolute: 'imbored', template: '%s · imbored' } }) as unknown as ResolvingMetadata
    const enMeta = await generateHubMetadata(en({}), root)
    expect(enMeta).toMatchObject({
      title: 'Games by genre',
      description:
        'Open world, soulslikes, roguelikes, city builders and two dozen more genres — twelve games each where the genre is the main one, with reviews and patch notes.',
      alternates: { canonical: '/en/games' },
    })
    // og:url и og:locale — своего языка (ownAddress)
    expect(enMeta.openGraph).toMatchObject({ url: '/en/games', locale: 'en_US' })
    expect(JSON.stringify(enMeta)).not.toMatch(CYR)
    const ruMeta = await generateHubMetadata({ params: Promise.resolve({ lang: 'ru' }) }, root)
    expect(ruMeta).toMatchObject({
      title: 'Игры по жанрам',
      description:
        'Открытый мир, соулслайки, рогалики, градостроение и ещё два десятка жанров — по двенадцать игр, для которых жанр главный, с отзывами и патчами на русском.',
      alternates: { canonical: '/games' },
    })
    expect(ruMeta.openGraph).toMatchObject({ url: '/games', locale: 'ru_RU' })
  })

  /*
   * Метаданные layout сегмента /games достаются и 404 жанра: notFound() у
   * [tag] рисуется под ним. С подписью хаба в layout голова /games/nope
   * называлась «Игры по жанрам · imbored» — до перевода там была корневая.
   */
  test('у сегмента /games нет layout с метаданными — 404 жанра получает голову корня', () => {
    const layout = path.join(__dirname, 'layout.tsx')
    if (!fs.existsSync(layout)) return
    expect(fs.readFileSync(layout, 'utf8')).not.toMatch(/export\s+(const\s+metadata\b|(async\s+)?function\s+generateMetadata\b|const\s+generateMetadata\b)/)
  })

  test('жанр: заголовок жанра первым, строки карточек и описание без кириллицы', async () => {
    await latin()
    const meta = await generateMetadata(en({ tag: 'open-world' }))
    // Жанр — первым и с заглавной, как по-русски: внутри фразы
    // («The best Open-world games…») заглавная читалась бы опечаткой
    expect(meta.title).toBe('Open-world games — the best on Steam, by reviews')
    expect(meta.openGraph?.title).toBe('Open-world games — the best on Steam, by reviews')
    expect(meta.description).toMatch(/^Open-world games: 8 games where this genre is one of the main tags, /)
    expect(JSON.stringify(meta)).not.toMatch(CYR)

    const page = flight(await GenrePage(en({ tag: 'open-world' })))
    const text = textOf(page)
    expect(text).toContain('8 games where “Open World” is one of the main tags')
    expect(text).toContain('Other genres')
    // те же числа, что у русской плитки: все языки (shownReviews), а не англоязычные «90% of 10K»
    expect(text).toMatch(/91% of 30K/)
    expect(text).not.toMatch(/90% of/)
    // выход — квиз с жанром; заголовок жанра в кнопке — первым и как есть:
    // hubTitle не понижается (docs/i18n.md), «pick open-world games» его понижал
    expect(text).toContain('Open-world games — pick from your library')
    expect(text).not.toMatch(/pick open-world/i)
    expect(text).not.toMatch(CYR)
    expect(JSON.stringify(page)).not.toMatch(CYR)
  })

  test('жанр: кнопка выхода не понижает заголовок — JRPGs, CRPGs; русская — как была', async () => {
    for (const [tag, title] of [
      ['jrpg', 'JRPGs'],
      ['crpg', 'CRPGs'],
      ['open-world', 'Open-world games'],
    ]) {
      const text = textOf(flight(await GenrePage(en({ tag }))))
      expect(text, tag).toContain(`${title} — pick from your library`)
    }
    const ru = textOf(flight(await GenrePage({ params: Promise.resolve({ tag: 'open-world' }) })))
    expect(ru).toContain('Подобрать игры с открытым миром из своей библиотеки')
  })

  /*
   * Как у карточки игры: alt файловой карточки один на все языки, и /en
   * ставит свой images — ту же карточку маршрута с английским alt. Русская
   * страница images не задаёт: карточка, адрес с хешем и alt — от файла.
   */
  test('жанр: превью на /en — та же карточка с английским alt, русская — от файла', async () => {
    const { size, contentType, alt } = await import('./[tag]/opengraph-image')
    const enMeta = await generateMetadata(en({ tag: 'open-world' }))
    expect(enMeta.openGraph?.images).toEqual([
      {
        url: '/en/games/open-world/opengraph-image',
        width: size.width,
        height: size.height,
        type: contentType,
        alt: 'Game collection — imbored',
      },
    ])
    // одна подпись на жанры и подборки: «Жанр» у «Кооперативных игр» был бы неправдой
    expect(alt).toBe('Подборка игр — imbored')
    const ruMeta = await generateMetadata({ params: Promise.resolve({ tag: 'open-world' }) })
    expect(ruMeta.openGraph).not.toHaveProperty('images')
  })

  /*
   * /en/games/coop — те же игры и тот же отсев, что у русской (Dota уходит
   * и здесь), а тексты — facetCopy: заголовок, <title>, основание списка,
   * выход в /compat и «Позвать». Отсев «Матча» и «versus» от языка не
   * зависит: он сверяется с русской подписью sessionTrait (load.ts, keeper).
   */
  test('подборка: тексты по-английски, игры и ссылки — те же, что у русской', async () => {
    // Названия — латиницей сразу: latin() переписывает только то, что уже в базе
    const seed = async (appid: number, over: Pick<GameMeta, 'categories' | 'tags' | 'reviewsTotal'>) => {
      const meta: GameMeta = {
        appid,
        name: `Game ${appid}`,
        genres: [],
        headerImage: `https://cdn.example/${appid}/header.jpg`,
        reviewsPercent: 90,
        ccu: 50_000,
        ...over,
      }
      await upsertGameMeta(db, meta, T0)
      await replaceGameTags(db, appid, storedTagWeights(meta.tags))
    }
    await latin()
    // Dota: кооператив в категориях есть, а в тегах MOBA перевешивает его
    await seed(570, {
      categories: [1, 9],
      tags: { 'Free to Play': 1000, MOBA: 339, Strategy: 330, 'Online Co-Op': 126 },
      reviewsTotal: 900_000,
    })
    await seed(553850, { categories: [1, 9, 38], tags: { 'Online Co-Op': 1000, PvE: 896 }, reviewsTotal: 600_000 })
    const coop = facetCopy(HUB_FACETS[0], 'en')
    const meta = await generateMetadata(en({ tag: 'coop' }))
    expect(meta.title).toBe('Co-op games — what to play with a friend')
    expect(meta.title).toBe(coop.heading)
    expect(meta.alternates?.canonical).toBe('/en/games/coop')
    expect(meta.robots).toEqual({ index: false, follow: true })
    expect(JSON.stringify(meta)).not.toMatch(CYR)

    const page = flight(await GenrePage(en({ tag: 'coop' })))
    const text = textOf(page)
    expect(text).toContain('Co-op games')
    expect(text).toContain(`1 game — ${coop.basis} Sorted by number of Steam reviews.`)
    for (const s of ['What you both own', 'Invite to this game', 'Other collections', 'Genres', 'Split screen']) {
      expect(text, s).toContain(s)
    }
    expect(text).not.toMatch(CYR)
    expect(JSON.stringify(page)).not.toMatch(CYR)
    const links = islandsOf(page, 'Link').map((l) => ({ href: l.href, prefetch: l.prefetch }))
    // адреса — без префикса: язык ставит сам Link
    expect(links).toContainEqual({ href: '/room/new?game=553850', prefetch: false })
    expect(links).toContainEqual({ href: '/compat', prefetch: false })
    expect(links.some((l) => l.href === '/game/570')).toBe(false)
  })

  test('подборка «на 20 минут»: выход — пресет по-английски, тот же адрес выдачи', async () => {
    const page = flight(await GenrePage(en({ tag: 'short' })))
    const text = textOf(page)
    expect(text).toContain('20-minute games')
    expect(text).toContain('The list is still coming together')
    expect(text).toContain('30 min before bed — from your library')
    expect(text).not.toMatch(CYR)
    const hrefs = islandsOf(page, 'Link').map((l) => String(l.href))
    expect(hrefs.some((h) => h.startsWith('/play?time=short'))).toBe(true)
  })

  /*
   * Название игры — данные, и на /en оно бывает русским: games.name у части
   * верха каталога держит русское имя магазина (nameSql в lib/db). На проде
   * i18n-audit валил /en/games и 17 жанров строками «span.block.truncate:
   * Assassin's Creed Истоки» — клиентская подпись карточки (GameCardName)
   * пометку ставила, а серверная капсула нет. Правило одно — langOn: 'ru'
   * только на /en; русская страница — без атрибута, как была.
   */
  describe('русское название на /en — своим lang', () => {
    /**
     * Подписи капсул — span.block.truncate с названием — и их lang. hasLang —
     * есть ли пропс вообще: lang={undefined} RSC-часть страницы сериализует
     * строкой «"lang":"$undefined"», и русская страница стала бы тяжелее на
     * каждую капсулу (langAttr в lib/textlang)
     */
    function capsuleNames(node: unknown): Array<{ lang: unknown; text: string; hasLang: boolean }> {
      const out: Array<{ lang: unknown; text: string; hasLang: boolean }> = []
      const walk = (n: unknown): void => {
        if (n === null || typeof n !== 'object') return
        const rec = n as { tag?: string; props?: { className?: unknown; lang?: unknown; children?: unknown } }
        if (rec.tag === 'span' && String(rec.props?.className ?? '').startsWith('block truncate')) {
          out.push({ lang: rec.props?.lang, text: textOf(rec.props?.children), hasLang: 'lang' in (rec.props ?? {}) })
        }
        Object.values(n).forEach(walk)
      }
      walk(node)
      return out
    }

    test('капсулы хаба и жанра: «Игра N» на /en — lang="ru", на русской — без атрибута', async () => {
      // Названия фикстуры — «Игра N»: русские, как «Ведьмак 3…» на проде
      for (const page of [await GamesHubPage(en({})), await GenrePage(en({ tag: 'open-world' }))]) {
        const names = capsuleNames(flight(page))
        expect(names.length).toBeGreaterThan(0)
        for (const n of names) expect(n, n.text).toEqual({ lang: 'ru', text: expect.stringMatching(/^Игра \d+$/), hasLang: true })
      }
      for (const page of [await GamesHubPage({ params: Promise.resolve({ lang: 'ru' }) }), await GenrePage({ params: Promise.resolve({ tag: 'open-world' }) })]) {
        const names = capsuleNames(flight(page))
        expect(names.length).toBeGreaterThan(0)
        // ни атрибута, ни пропса: RSC-часть русской страницы — прежняя до байта
        for (const n of names) expect(n.hasLang, n.text).toBe(false)
      }
    })

    test('латинское название на /en — без атрибута', async () => {
      await latin()
      const names = capsuleNames(flight(await GenrePage(en({ tag: 'open-world' }))))
      expect(names.length).toBeGreaterThan(0)
      for (const n of names) expect(n.hasLang, n.text).toBe(false)
    })

    test('«Invite to this game»: русское название в хвосте для скринридера — своим lang', async () => {
      await upsertGameMeta(
        db,
        {
          appid: 553850,
          name: 'Глубокая скала',
          genres: [],
          categories: [1, 9, 38],
          tags: { 'Online Co-Op': 1000 },
          headerImage: 'https://cdn.example/553850/header.jpg',
          reviewsTotal: 600_000,
          reviewsPercent: 90,
          ccu: 50_000,
        },
        T0,
      )
      await replaceGameTags(db, 553850, storedTagWeights({ 'Online Co-Op': 1000 }))
      const invite = (page: unknown) => {
        const [link] = islandsOf(page, 'Link').filter((l) => l.href === '/room/new?game=553850')
        expect(link).toBeDefined()
        const [tail] = (link.children as Array<{ tag?: string; props?: { className?: string; children?: unknown } }>).filter(
          (c) => c?.props?.className === 'sr-only',
        )
        return tail
      }
      const enTail = invite(flight(await GenrePage(en({ tag: 'coop' }))))
      expect(textOf(enTail)).toBe(': Глубокая скала')
      expect(JSON.stringify(enTail)).toContain('"lang":"ru"')
      // Русская — прежняя: ': ' и название текстом, без <span>
      const ruTail = invite(flight(await GenrePage({ params: Promise.resolve({ tag: 'coop' }) })))
      expect(ruTail?.props?.children).toEqual([': ', 'Глубокая скала'])
    })
  })
})
