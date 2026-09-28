import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { GameNews } from '@/components/GameNews'
import { GameShots } from '@/components/GameShots'
import { OwnedLaunch } from '@/components/OwnedLaunch'
import { ProgressRing } from '@/components/ProgressRing'
import { ShownUntil } from '@/components/ShownUntil'
import { TrailerPreview } from '@/components/TrailerPreview'
import {
  replaceGameTags,
  setGameJson,
  setNewsDigest,
  upsertGameMeta,
  upsertNewsItems,
  type Db,
  type StoredNews,
} from '@/lib/db'
import { GAME_PAGE_REVALIDATE_SEC, PRERENDER_TOP } from '@/lib/gamecache'
import { flight as flightOf, textOf } from '@/lib/testing/flight'
import { freshDb } from '@/lib/testing/route'
import type { GameMeta } from '@/lib/types'
import GamePage, { generateMetadata, generateStaticParams, revalidate } from './page'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

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
 */
async function seed(): Promise<void> {
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
])

const flight = (node: unknown) => flightOf(node, ISLANDS)

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
    vi.stubEnv('VERCEL_ENV', undefined)
    expect(await generateStaticParams()).toEqual([])
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(await generateStaticParams()).toEqual([])

    vi.stubEnv('VERCEL_ENV', 'production')
    const top = await generateStaticParams()
    expect(top.length).toBeGreaterThan(0)
    expect(top.length).toBeLessThanOrEqual(PRERENDER_TOP)
    expect(top).toContainEqual({ appid: String(APPID) })
  })

  test('вывод не зависит от часов: через три дня — та же страница', async () => {
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
    expect(textOf(flight(await GamePage(params)))).toContain('−50%')
    at(T0 + 5 * DAY + 1)
    expect(await snapshot()).not.toBe(first)
    expect(textOf(flight(await GamePage(params)))).not.toContain('−50%')
  })

  test('срок акции — датой, и цена со скидкой гаснет у читателя по нему же', async () => {
    await seed()
    const page = flight(await GamePage(params))
    // 1_760_000_000 — 9 октября 2025 UTC, акция кончается через пять суток
    expect(textOf(page)).toContain('до 14 октября')
    at(T0 + 4 * DAY)
    expect(textOf(flight(await GamePage(params)))).not.toMatch(/осталось|последний день/)
    // Строка цены — внутри ShownUntil со сроком конца акции
    const text = JSON.stringify(page)
    expect(text).toContain(`"island":"ShownUntil","key":null,"props":{"untilSec":${T0 + 5 * DAY}`)
  })

  test('онлайн — прошедшим временем: «сейчас» из недельного кэша не бывает правдой', async () => {
    await seed()
    const text = textOf(flight(await GamePage(params)))
    expect(text).toContain('играли')
    expect(text).not.toContain('сейчас играют')
  })
})
