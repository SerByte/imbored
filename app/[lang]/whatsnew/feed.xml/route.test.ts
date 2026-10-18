import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setNewsDigest, setNewsDigestEn, upsertGameMeta, upsertNewsItems, type Db, type StoredNews } from '@/lib/db'
import { freshDb, params } from '@/lib/testing/route'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

// unstable_cache вне сервера Next не работает — общая лента читается из той же
// базы напрямую, как в тесте страницы (app/[lang]/whatsnew/page.test.ts)
vi.mock('@/lib/whatsnewcache', async (importOriginal) => {
  const { getMajorFeed } = await import('@/lib/db')
  const { getDb } = await import('@/lib/server')
  return {
    ...(await importOriginal<typeof import('@/lib/whatsnewcache')>()),
    cachedMajorFeed: async (limit: number, minRank: number) => getMajorFeed(await getDb(), limit, { minRank }),
  }
})

/**
 * Общая RSS-лента — своя у каждого языка: /whatsnew/feed.xml и
 * /en/whatsnew/feed.xml. Русская — как была. Английская — только посты с
 * английским пересказом: это лента «коротко о главном», и запись без него
 * была бы русским телом или повтором заголовка.
 */

const NOW = 1_760_000_000
const DAY = 86_400

let db: Db

function patch(appid: number, daysAgo: number, title: string): StoredNews {
  return {
    appid,
    gid: `${appid}0`,
    title,
    url: `https://store.steampowered.com/news/app/${appid}/view/${appid}0`,
    publishedAt: NOW - daysAgo * DAY,
    kind: 'patch',
    scale: 'major',
    blocks: [{ kind: 'p', runs: [{ text: `Починили всё в ${appid}` }] }],
    bodyHash: `h${appid}`,
    rank: 900_000,
  }
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW * 1000)
  db = await freshDb()
  for (const [appid, name] of [
    [730, 'Counter-Strike 2'],
    [570, 'Dota 2'],
  ] as const) {
    await upsertGameMeta(db, { appid, name, tags: { Action: 100 }, genres: [], categories: [] }, NOW)
  }
  await upsertNewsItems(db, [patch(730, 1, 'Обновление Counter-Strike 2'), patch(570, 2, 'Обновление 7.41e')], NOW)
  await setNewsDigest(db, 730, '7300', { tldr: 'Гранаты больше не проходят сквозь стены.', scale: 'major' }, NOW)
  await setNewsDigestEn(db, 730, '7300', { tldrEn: 'Grenades no longer pass through walls.' }, NOW)
  await setNewsDigest(db, 570, '5700', { tldr: 'Правки героев перед турниром.', scale: 'major' }, NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

const feed = async (lang: string) => (await GET(new Request(`http://localhost/${lang}/whatsnew/feed.xml`), params({ lang }))).text()

describe('/whatsnew/feed.xml: язык ленты', () => {
  test('русская лента — прежняя: канал, пересказы и адреса без префикса', async () => {
    const xml = await feed('ru')
    expect(xml).toContain('<title>Что нового — imbored</title>')
    expect(xml).toContain('<description>Крупные патчи популярных игр — коротко и по-русски.</description>')
    expect(xml).toContain('<language>ru</language>')
    expect(xml).toContain('<description>Гранаты больше не проходят сквозь стены.</description>')
    expect(xml).toContain('<description>Правки героев перед турниром.</description>')
    expect(xml).toContain('/game/730/news/7300</link>')
    expect(xml).not.toContain('/en/')
    expect(xml.match(/<item>/g)).toHaveLength(2)
  })

  test('английская — только с английским пересказом, без кириллицы, адреса /en', async () => {
    const xml = await feed('en')
    expect(xml).toContain('<title>What&apos;s new — imbored</title>')
    expect(xml).toContain('<description>Major patches for popular games, in short.</description>')
    expect(xml).toContain('<language>en</language>')
    expect(xml).toContain('<atom:link href="http://localhost:3000/en/whatsnew/feed.xml"')
    expect(xml).toContain('<link>http://localhost:3000/en/whatsnew</link>')
    expect(xml.match(/<item>/g)).toHaveLength(1)
    expect(xml).toContain('/en/game/730/news/7300</link>')
    expect(xml).toContain('<description>Grenades no longer pass through walls.</description>')
    // Русский заголовок без перевода — «{Game} update», с датой: заголовки Valve одинаковые
    expect(xml).toMatch(/<title>Counter-Strike 2: Update \(Oct \d{1,2}, 2025\) — what changed<\/title>/)
    expect(xml).not.toMatch(/[А-Яа-яЁё]/)
  })
})
