import Link from 'next/link'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { SearchLauncher } from '@/components/SearchLauncher'
import { TilePending } from '@/components/TilePending'
import { replaceGameTags, upsertGameMeta, upsertSemantics, type Db } from '@/lib/db'
import { HUB_FACETS, storedTagWeights } from '@/lib/gamehub'
import type { GameMeta, GameSemantics } from '@/lib/types'
import { flight as flightOf, islandsOf } from '@/lib/testing/flight'
import { freshDb } from '@/lib/testing/route'
import { loadGenre } from './[tag]/load'
import GenrePage, { generateMetadata, generateStaticParams } from './[tag]/page'
import GamesHubPage from './page'

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
  }
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

  test('первые капсулы первой полки грузятся сразу, остальные лениво', async () => {
    const text = JSON.stringify(flight(await GamesHubPage()))
    expect(text.match(/"loading":"eager"/g)).toHaveLength(5)
    expect(text.match(/"loading":"lazy"/g)).toHaveLength(3)
  })
})

describe('страница жанра /games/<slug>', () => {
  const params = { params: Promise.resolve({ tag: 'open-world' }) }

  test('капсулы серверные, с номером в углу и строкой отзывов под названием', async () => {
    const page = flight(await GenrePage(params))
    expect(islandsOf(page, 'GameArt')).toEqual([])
    const text = JSON.stringify(page)
    expect(text).not.toContain('hero.jpg')
    // номер места — угол обложки, «90% из …» — строка под названием
    expect(text).toContain('"className":"lib-badge badge-line tabular-nums","children":1')
    expect(text).toMatch(/90%/)
    expect(text.match(/"loading":"eager"/g)).toHaveLength(3)
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

  test('адреса подборок собираются на сборке рядом с жанрами', () => {
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
