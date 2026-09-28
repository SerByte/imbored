import Link from 'next/link'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { replaceGameTags, upsertGameMeta, type Db } from '@/lib/db'
import { flight as flightOf, islandsOf } from '@/lib/testing/flight'
import { freshDb } from '@/lib/testing/route'
import GenrePage from './[tag]/page'
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

/** GameArt — в списке, чтобы его возвращение было видно, а не роняло тест */
const ISLANDS = new Map<unknown, string>([
  [Link, 'Link'],
  [GameArt, 'GameArt'],
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
