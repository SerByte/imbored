import { beforeEach, describe, expect, test, vi } from 'vitest'
import { saveLibrarySnapshot, upsertNewsItems, type Db, type StoredNews } from '@/lib/db'
import { freshDb, signInAs } from '@/lib/testing/route'
import { FEED_LIMIT, FEED_RANK_FLOOR } from '@/lib/whatsnewfeed'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Кэш общей ленты подменён записью, которая ОТСТАЛА от базы: ровно так он
 * выглядит после того, как крон вставил патч, а revalidateTag(…, 'max') ещё
 * не отработал или отдал первому запросу устаревшее (stale-while-revalidate).
 */
const cached = vi.hoisted(() => ({ feed: [] as StoredNews[] }))
const cachedMajorFeed = vi.hoisted(() => vi.fn(async (limit: number, minRank: number) => {
  void minRank
  return cached.feed.slice(0, limit)
}))
vi.mock('@/lib/whatsnewcache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsnewcache')>()),
  cachedMajorFeed,
}))

/**
 * Плашка «N новых обновлений» не обгоняет страницу.
 *
 * Голова читала общую ленту из базы напрямую, а страница — из unstable_cache
 * с тегом news:major. Крон вставляет патч — голова видит его на следующем
 * опросе, плашка зовёт router.refresh(), а страница рисует ещё старую запись
 * кэша: те же ключи, плашка на месте с тем же числом, клик ничего не меняет.
 * Первый запрос после revalidateTag(…, 'max') к тому же получает устаревшее
 * by design. Голова обязана читать ТУ ЖЕ запись кэша, что и страница: тогда
 * она отстаёт ровно так же, и первым устаревшее получает опрос, а не клик.
 */

const NOW = Math.floor(Date.now() / 1000)
const DAY = 86_400

function patch(appid: number, daysAgo: number, rank = 50_000): StoredNews {
  return {
    appid,
    gid: `${appid}0`,
    title: `Обновление ${appid}`,
    url: `https://store.steampowered.com/news/app/${appid}/view/${appid}0`,
    publishedAt: NOW - daysAgo * DAY,
    kind: 'patch',
    scale: 'major',
    blocks: [],
    bodyHash: `h${appid}`,
    rank,
  }
}

let db: Db

beforeEach(async () => {
  db = await freshDb()
  cachedMajorFeed.mockClear()
  cached.feed = []
})

async function head(feed?: 'popular'): Promise<{ showPopular: boolean; keys: string[] }> {
  const res = await GET(new Request(`http://localhost/api/whatsnew/head${feed ? `?feed=${feed}` : ''}`))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { showPopular: boolean; items: Array<{ k: string }> }
  return { showPopular: body.showPopular, keys: body.items.map((i) => i.k) }
}

describe('/api/whatsnew/head: общая часть — из кэша страницы', () => {
  test('гость: ключи — ровно из записи кэша, даже когда в базе уже есть новый патч', async () => {
    cached.feed = [patch(570, 1), patch(440, 2)]
    // крон уже вставил свежий патч, а кэш ленты о нём ещё не знает
    await upsertNewsItems(db, [patch(730, 0), patch(570, 1), patch(440, 2)], NOW)

    expect(await head()).toEqual({ showPopular: true, keys: ['570:5700', '440:4400'] })
    // тот же ключ кэша, что у страницы и feed.xml: иначе это другая запись,
    // и регенерируется она независимо. Аргументы — половина ключа; вторую
    // (текст колбэка, разный у app-route и app-rsc) сторожит
    // lib/whatsnewcache.test.ts — здесь cachedMajorFeed подменён целиком
    expect(cachedMajorFeed).toHaveBeenCalledWith(FEED_LIMIT, FEED_RANK_FLOOR)
  })

  test('добивка личной ленты — из того же кэша, личная часть — живая', async () => {
    const steamid = await signInAs(db, 'claimed')
    await saveLibrarySnapshot(
      db,
      steamid,
      [{ appid: 620, name: 'Portal 2', playtimeForever: 600, playtime2Weeks: 0 }],
      NOW,
    )
    // своя игра — в базе, её кэш не касается
    await upsertNewsItems(db, [patch(620, 3), patch(730, 0)], NOW)
    cached.feed = [patch(570, 1), patch(440, 2)]

    expect(await head()).toEqual({ showPopular: false, keys: ['620:6200', '570:5700', '440:4400'] })
    expect(cachedMajorFeed).toHaveBeenCalledTimes(1)
  })
})
