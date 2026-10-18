import type { ResolvingMetadata } from 'next'
import Link from '@/components/Link'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { SearchLauncher } from '@/components/SearchLauncher'
import { TilePending } from '@/components/TilePending'
import { replaceGameTags, upsertGameMeta, type Db } from '@/lib/db'
import { flight as flightOf, islandsOf, textOf } from '@/lib/testing/flight'
import { freshDb } from '@/lib/testing/route'
import GenrePage, { generateMetadata as generateGenreMetadata } from './[tag]/page'
import { generateMetadata as generateHubMetadata } from './layout'
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
 * Английские хаб и жанр: /en/games и /en/games/open-world — те же полки и
 * те же игры, подписи — на языке params. Названия игр — данные, и в
 * фикстуре они латиницей: кириллица на /en осталась бы только недоведённой
 * строкой интерфейса.
 */
describe('английские хаб и страница жанра', () => {
  const CYR = /[А-Яа-яЁё]/
  const en = <T extends object>(p: T) => ({ params: Promise.resolve({ ...p, lang: 'en' }) })
  const latin = () => db.execute({ sql: "UPDATE games SET name = 'Game ' || appid", args: [] })

  test('хаб: подписи по-английски, полка — подпись тега Steam', async () => {
    await latin()
    const page = flight(await GamesHubPage(en({})))
    const text = textOf(page)
    for (const s of ['Catalog', 'Games by genre', 'Open World', 'See all', 'Find a game for your mood']) {
      expect(text, s).toContain(s)
    }
    expect(text).not.toMatch(CYR)
  })

  /*
   * Шаблон корня layout обязан передать дальше: строка без шаблона обрывала
   * его, и страницы жанров теряли « · imbored» в title (layout.tsx, докблок).
   */
  test('хаб: title и description — у layout, на языке страницы, и шаблон корня идёт дальше', async () => {
    const root = Promise.resolve({ title: { absolute: 'imbored', template: '%s · imbored' } }) as unknown as ResolvingMetadata
    const enMeta = await generateHubMetadata(en({}), root)
    expect(enMeta).toMatchObject({ title: { default: 'Games by genre', template: '%s · imbored' } })
    expect(JSON.stringify(enMeta)).not.toMatch(CYR)
    expect(await generateHubMetadata({ params: Promise.resolve({ lang: 'ru' }) }, root)).toMatchObject({
      title: { default: 'Игры по жанрам', template: '%s · imbored' },
    })
  })

  test('жанр: заголовок с заглавной внутри фразы, строки карточек и описание без кириллицы', async () => {
    await latin()
    const meta = await generateGenreMetadata(en({ tag: 'open-world' }))
    expect(meta.title).toBe('The best Open-world games on Steam, by reviews')
    expect(meta.description).toMatch(/^Open-world games: 8 games where it's the main genre/)
    expect(JSON.stringify(meta)).not.toMatch(CYR)

    const page = flight(await GenrePage(en({ tag: 'open-world' })))
    const text = textOf(page)
    expect(text).toContain('8 games where “Open World” is one of the main tags')
    expect(text).toContain('Other genres')
    expect(text).toMatch(/90% of 10K/)
    expect(text).not.toMatch(CYR)
    expect(JSON.stringify(page)).not.toMatch(CYR)
  })
})
