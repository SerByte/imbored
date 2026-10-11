import Link from 'next/link'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LinkPending } from '@/components/LinkPending'
import { Cover } from '@/components/whatsnew/Cover'
import { FeedWatch } from '@/components/whatsnew/FeedWatch'
import { PatchRow } from '@/components/whatsnew/PatchRow'
import { Stage } from '@/components/whatsnew/Stage'
import { saveLibrarySnapshot, upsertGameMeta, upsertNewsItems, type Db, type StoredNews } from '@/lib/db'
import { flight, islandsOf } from '@/lib/testing/flight'
import { freshDb, signInAs } from '@/lib/testing/route'
import type { GameMeta } from '@/lib/types'
import WhatsNewPage from './page'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

// unstable_cache вне сервера Next не работает, а кэш здесь и не предмет
// проверки: общая лента читается из той же базы напрямую. Что голова ленты
// обязана идти через ЭТОТ ЖЕ кэш — сторожит app/api/whatsnew/head/route.test.ts.
vi.mock('@/lib/whatsnewcache', async (importOriginal) => {
  const { getMajorFeed } = await import('@/lib/db')
  const { getDb } = await import('@/lib/server')
  return {
    ...(await importOriginal<typeof import('@/lib/whatsnewcache')>()),
    cachedMajorFeed: async (limit: number, minRank: number) =>
      getMajorFeed(await getDb(), limit, { minRank }),
  }
})

/**
 * Своя игра на /whatsnew не продаётся.
 *
 * Наблюдали вживую под демо-пользователем: под «Ещё в популярных играх» стояли
 * Portal 2 (12 ч в библиотеке) и Factorio (310 ч) с «9,99 $ Открыть игру», а
 * Celeste — с «−75 % до 24 октября»: скидка на купленное и патч пятилетней
 * давности, который трёхмесячный порог личного блока как раз прятал. На
 * вкладке «популярное» Deep Rock Galactic на 60 часов шёл с ценой 29,99 $ —
 * вкладка служила заменой признаку «не твоё».
 *
 * Здесь настоящая страница на базе в памяти: что решает resolveWhatsNew и что
 * страница из этого рисует, проверяется вместе — по пропсам островков PatchRow.
 */

const NOW = 1_760_000_000
const DAY = 86_400

const ISLANDS = new Map<unknown, string>([
  [Link, 'Link'],
  [LinkPending, 'LinkPending'],
  [Cover, 'Cover'],
  [FeedWatch, 'FeedWatch'],
  [PatchRow, 'PatchRow'],
  [Stage, 'Stage'],
])

let db: Db

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW * 1000)
  db = await freshDb()
})

afterEach(() => {
  vi.useRealTimers()
})

function game(appid: number): GameMeta {
  return {
    appid,
    name: `Игра ${appid}`,
    tags: { Action: 100 },
    genres: [],
    categories: [],
    priceFinal: 999,
    priceAt: NOW - 3600,
    priceCc: 'us',
  }
}

/** Крупный патч игры: rank — её вес в общей ленте (порог FEED_RANK_FLOOR) */
function patch(appid: number, daysAgo: number, rank: number): StoredNews {
  return {
    appid,
    gid: `${appid}0`,
    title: `Обновление ${appid}`,
    url: `https://store.steampowered.com/news/app/${appid}/view/${appid}0`,
    publishedAt: NOW - daysAgo * DAY,
    kind: 'patch',
    scale: 'major',
    blocks: [{ kind: 'p', runs: [{ text: 'Починили всё' }] }],
    bodyHash: `h${appid}`,
    rank,
  }
}

async function seed(news: StoredNews[], library: number[]): Promise<void> {
  for (const n of news) await upsertGameMeta(db, game(n.appid), NOW)
  await upsertNewsItems(db, news, NOW)
  const steamid = await signInAs(db, 'openid')
  await saveLibrarySnapshot(
    db,
    steamid,
    library.map((appid, i) => ({ appid, name: `Игра ${appid}`, playtimeForever: 600 - i, playtime2Weeks: 0 })),
    NOW - 60,
  )
}

async function rows(feed?: 'popular') {
  const page = await WhatsNewPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(feed ? { feed } : {}),
  } as PageProps<'/whatsnew'>)
  const tree = flight(page, ISLANDS)
  const byApp = new Map(
    islandsOf(tree, 'PatchRow').map((p) => [(p.item as { appid: number }).appid, p]),
  )
  const cover = islandsOf(tree, 'Cover').map((p) => (p.item as { appid: number }).appid)
  return { byApp, cover }
}

describe('/whatsnew: своё не продаётся', () => {
  test('общая вкладка: своя игра в ленте остаётся, но без цены и «Открыть игру»', async () => {
    await seed(
      [
        // 570 — самый весомый за неделю, уходит в обложку
        patch(570, 1, 900_000),
        patch(730, 2, 20_000),
        patch(440, 3, 300_000),
      ],
      [730],
    )
    const { byApp, cover } = await rows('popular')
    expect(cover).toEqual([570])

    // Крупный патч в своей игре — новость и на общей вкладке
    expect(byApp.get(730)).toMatchObject({ discovery: false, price: null, priceCc: null, discount: null })
    // Чужая игра — с ценой и дорогой на свою страницу, как и было
    expect(byApp.get(440)).toMatchObject({ discovery: true, price: 999, priceCc: 'us' })
  })

  test('личная вкладка: своя игра вне личного блока в добивку «чужих» не идёт', async () => {
    await seed(
      [
        // своё и свежее — личный блок и его обложка
        patch(730, 1, 20_000),
        // своё, но патч старше трёх месяцев: в личный блок не попадает
        patch(620, 200, 400_000),
        // чужие популярные — добивка
        patch(570, 2, 900_000),
        patch(440, 3, 300_000),
      ],
      [730, 620],
    )
    const { byApp, cover } = await rows()
    expect(cover).toEqual([730])
    expect([...byApp.keys()].sort()).toEqual([440, 570])
    for (const appid of [440, 570]) {
      expect(byApp.get(appid)).toMatchObject({ discovery: true, price: 999 })
    }
  })
})
