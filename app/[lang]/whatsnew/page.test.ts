import Link from '@/components/Link'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LinkPending } from '@/components/LinkPending'
import { Cover } from '@/components/whatsnew/Cover'
import { FeedLink } from '@/components/whatsnew/FeedLink'
import { FeedWatch } from '@/components/whatsnew/FeedWatch'
import { PatchRow } from '@/components/whatsnew/PatchRow'
import { Stage } from '@/components/whatsnew/Stage'
import {
  issueFeedLink,
  saveLibrarySnapshot,
  setNewsDigest,
  setNewsDigestEn,
  upsertGameMeta,
  upsertNewsItems,
  type Db,
  type StoredNews,
} from '@/lib/db'
import { feedTokenHash, newFeedToken } from '@/lib/feedlink'
import { flight, islandsOf, textOf } from '@/lib/testing/flight'
import { freshDb, signInAs, signOut, type SessionKind } from '@/lib/testing/route'
import type { GameMeta } from '@/lib/types'
import WhatsNewPage from './page'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

// unstable_cache вне сервера Next не работает, а кэш здесь и не предмет
// проверки: общая лента читается из той же базы напрямую. Что голова ленты
// обязана идти через ЭТОТ ЖЕ кэш — сторожит app/api/whatsnew/head/route.test.ts,
// а что это одна запись на оба слоя сборки, а не две, — lib/whatsnewcache.test.ts.
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
  // Строка «RSS по секретной ссылке» — клиентская: выпуск, копирование и
  // отключение живут на кнопках. Без неё в списке flight раскрыл бы её
  // вызовом с хуками и уронил тест
  [FeedLink, 'FeedLink'],
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
  } as PageProps<'/[lang]/whatsnew'>)
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

/**
 * Строка «RSS по секретной ссылке» внизу ленты.
 *
 * Выпускать ключ может только пишущая сессия (requireWriter): ключ — это
 * постоянный доступ к ленте патчей твоих игр. Страница знает о ссылке лишь
 * то, что она есть и с какого дня: сам ключ сервер не хранит, и в разметку
 * он не попадает ни при каких обстоятельствах.
 */
describe('/whatsnew: RSS по секретной ссылке', () => {
  async function page(kind: SessionKind | null, link?: string) {
    await upsertGameMeta(db, game(570), NOW)
    await upsertNewsItems(db, [patch(570, 1, 900_000), patch(440, 2, 300_000)], NOW)
    signOut()
    if (kind) {
      const steamid = await signInAs(db, kind)
      if (link) {
        const tokenHash = feedTokenHash(link)
        await issueFeedLink(db, { steamid, sid: 'sid-feed', tokenHash, nowSec: NOW - DAY, replace: true })
      }
    }
    const tree = flight(
      await WhatsNewPage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({}),
      } as PageProps<'/[lang]/whatsnew'>),
      ISLANDS,
    )
    return { tree, rss: islandsOf(tree, 'FeedLink') }
  }

  test('вошедший через Steam со ссылкой: есть и с какого дня — но не сама ссылка', async () => {
    const key = newFeedToken()
    const { tree, rss } = await page('openid', key)
    expect(rss).toEqual([{ island: 'FeedLink', since: NOW - DAY, verified: true }])
    expect(JSON.stringify(tree)).not.toContain(key)
    expect(JSON.stringify(tree)).not.toContain(feedTokenHash(key))
  })

  /*
   * verified — обещать второй выключатель «Выйти на всех устройствах» можно
   * только тому, у кого эта кнопка есть: у демо её нет (components/SignOut)
   */
  test('вошедший через Steam без ссылки и демо — кнопка выпуска', async () => {
    expect((await page('openid')).rss).toEqual([{ island: 'FeedLink', since: null, verified: true }])
    db = await freshDb()
    expect((await page('demo')).rss).toEqual([{ island: 'FeedLink', since: null, verified: false }])
  })

  test('сессия по ссылке на профиль — без кнопок, со строкой о входе через Steam', async () => {
    const { tree, rss } = await page('claimed')
    expect(rss).toEqual([])
    expect(textOf(tree)).toContain('может вошедший через Steam')
    // Вход возвращает сюда, к ссылке, ради которой входили, а не на квиз
    expect(JSON.stringify(tree)).toContain('"/api/auth/steam?next=%2Fwhatsnew"')
  })

  test('гость — ничего: личной ленты у него нет', async () => {
    const { tree, rss } = await page(null)
    expect(rss).toEqual([])
    expect(textOf(tree)).not.toContain('секретной ссылке')
  })
})

/**
 * /en/whatsnew: строки уезжают в островки уже на языке страницы (rowOn) —
 * заголовок по newsTitleOn, пересказ только английский; вход через Steam
 * везёт lang=en и возвращает на английскую ленту.
 */
describe('/en/whatsnew', () => {
  const pageEn = async () =>
    flight(
      await WhatsNewPage({
        params: Promise.resolve({ lang: 'en' }),
        searchParams: Promise.resolve({ feed: 'popular' }),
      } as PageProps<'/[lang]/whatsnew'>),
      ISLANDS,
    )

  test('строки ленты: английский заголовок вместо русского, без русского пересказа', async () => {
    await seed([patch(570, 1, 900_000), patch(730, 2, 20_000), patch(440, 3, 300_000)], [])
    await setNewsDigest(db, 440, '4400', { tldr: 'Коротко по-русски.', scale: 'major' }, NOW)
    await setNewsDigestEn(db, 440, '4400', { tldrEn: 'In short, in English.' }, NOW)
    await setNewsDigest(db, 730, '7300', { tldr: 'Только по-русски.', scale: 'major' }, NOW)
    const tree = await pageEn()
    // Обложка — тоже строка ленты: у 440 единственной есть английский
    // пересказ, и на /en обложкой встаёт она (тест ниже)
    const byApp = new Map(
      [...islandsOf(tree, 'PatchRow'), ...islandsOf(tree, 'Cover')].map((p) => [(p.item as { appid: number }).appid, p.item]),
    )
    expect(byApp.get(440)).toMatchObject({ title: 'Игра 440 update', tldr: 'In short, in English.' })
    expect(byApp.get(730)).toMatchObject({ title: 'Игра 730 update' })
    expect(byApp.get(730)).not.toHaveProperty('tldr')
    expect(byApp.get(730)).not.toHaveProperty('tldrEn')
    // Вкладок нет у гостя без своих патчей — подпись общей ленты по-английски
    expect(textOf(tree)).toContain('In popular games')
    expect(textOf(tree)).toContain('Only major patches.')
  })

  /*
   * Обложка /en — пост, которому есть что сказать по-английски. На проде
   * обложкой /en/whatsnew стоял «Team Fortress 2 update · 36 changes · Read
   * the patch», а его страница отвечала «We don't have these patch notes in
   * English»: вес выбирал его, язык — никто.
   */
  test('обложка — самый весомый пост с английским текстом, а не просто самый весомый', async () => {
    const english = { ...patch(620, 3, 50_000), blocks: [{ kind: 'p' as const, runs: [{ text: 'Fixed co-op saves.' }] }] }
    await seed([patch(570, 1, 900_000), patch(730, 2, 20_000), patch(440, 4, 300_000), english], [])
    await setNewsDigest(db, 440, '4400', { tldr: 'Коротко по-русски.', scale: 'major' }, NOW)
    await setNewsDigestEn(db, 440, '4400', { tldrEn: 'In short, in English.' }, NOW)
    const cover = islandsOf(await pageEn(), 'Cover').map((p) => (p.item as { appid: number }).appid)
    // 570 тяжелее всех, но по-английски ему сказать нечего; из двух английских
    // (пересказ у 440, тело у 620) — тот, что весомее
    expect(cover).toEqual([440])
    // Русская обложка — прежняя: самый весомый в окне
    expect((await rows('popular')).cover).toEqual([570])
  })

  test('обложка /en: английского нет ни у кого — выбор прежний, по весу', async () => {
    await seed([patch(570, 1, 900_000), patch(730, 2, 20_000)], [])
    const cover = islandsOf(await pageEn(), 'Cover').map((p) => (p.item as { appid: number }).appid)
    expect(cover).toEqual([570])
  })

  test('русская лента того же поста — с русским заголовком и пересказом', async () => {
    await seed([patch(570, 1, 900_000), patch(730, 2, 20_000)], [])
    await setNewsDigest(db, 730, '7300', { tldr: 'Только по-русски.', scale: 'major' }, NOW)
    const { byApp } = await rows('popular')
    expect(byApp.get(730)?.item).toMatchObject({ title: 'Обновление 730', tldr: 'Только по-русски.' })
  })

  test('сессия по ссылке на профиль: вход через Steam везёт язык страницы', async () => {
    await upsertGameMeta(db, game(570), NOW)
    await upsertNewsItems(db, [patch(570, 1, 900_000), patch(440, 2, 300_000)], NOW)
    signOut()
    await signInAs(db, 'claimed')
    const tree = await pageEn()
    expect(JSON.stringify(tree)).toContain('"/api/auth/steam?next=%2Fwhatsnew&lang=en"')
    expect(textOf(tree)).toContain('needs a Steam sign-in')
    expect(textOf(tree)).toContain('Sign in with Steam')
  })
})
