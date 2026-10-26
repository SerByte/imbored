import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setNewsDigest, setNewsDigestEn, upsertGameMeta, upsertNewsItems, type Db, type StoredNews } from '@/lib/db'
import { freshDb, params } from '@/lib/testing/route'
import { MAJOR_TTL_SEC } from '@/lib/whatsnewcache'
import { GET, revalidate } from './route'

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
 * /en/whatsnew/feed.xml. Русская — как была. Английская — только посты,
 * которым есть что сказать по-английски: с английским пересказом или с
 * английским телом издателя. Запись без того и другого была бы повтором
 * заголовка: русское тело в английский сниппет не идёт.
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
    expect(xml).toMatch(/<title>Counter-Strike 2 update \(Oct \d{1,2}, 2025\) — what changed<\/title>/)
    expect(xml).not.toMatch(/[А-Яа-яЁё]/)
  })

  /*
   * Пост издателя по-английски без английского пересказа — в английской
   * ленте с началом самого поста. Стояло «только с пересказом», и на проде,
   * пока пересказов /en не было, канал отдавал ноль записей при тридцати у
   * русского, а страница звала в него ридеры.
   */
  test('английская — и пост с английским телом без пересказа: описание — начало поста', async () => {
    await upsertGameMeta(db, { appid: 620, name: 'Portal 2', tags: { Puzzle: 100 }, genres: [], categories: [] }, NOW)
    await upsertNewsItems(
      db,
      [
        {
          ...patch(620, 3, 'Portal 2 Update Released'),
          blocks: [{ kind: 'p', runs: [{ text: 'Fixed a crash when loading co-op saves on Linux.' }] }],
        },
      ],
      NOW,
    )
    const xml = await feed('en')
    expect(xml.match(/<item>/g)).toHaveLength(2)
    expect(xml).toContain('/en/game/620/news/6200</link>')
    expect(xml).toContain('<description>Fixed a crash when loading co-op saves on Linux.</description>')
    // Русское тело без пересказа (Dota 2) — по-прежнему не в английской ленте
    expect(xml).not.toContain('/en/game/570/')
    expect(xml).not.toMatch(/[А-Яа-яЁё]/)
  })
})

/**
 * Лента — запись ISR, и перегенерация ничего не пишет, только если вывод тот
 * же байт в байт. С lastBuildDate = «сейчас» каждая перегенерация была новой
 * записью — раз в десять минут, по опросу ридера, в обоих языках.
 */
describe('/whatsnew/feed.xml: перегенерация без новых записей — тот же документ', () => {
  const built = (sec: number) => `<lastBuildDate>${new Date(sec * 1000).toUTCString()}</lastBuildDate>`

  test('lastBuildDate — дата самой свежей записи канала, а не время сборки', async () => {
    const ru = await feed('ru')
    const en = await feed('en')
    vi.setSystemTime((NOW + 3 * DAY + 17) * 1000)
    expect(await feed('ru')).toBe(ru)
    expect(await feed('en')).toBe(en)
    expect(ru).toContain(built(NOW - DAY))
    // У английской свой состав, и дата — её же свежей записи: без английского
    // у CS2 в ней остаётся одна Dota 2, двухдневная
    await db.execute('UPDATE news_items SET tldr_en = NULL WHERE appid = 730')
    await setNewsDigestEn(db, 570, '5700', { tldrEn: 'Hero changes before the tournament.' }, NOW)
    const only570 = await feed('en')
    expect(only570.match(/<item>/g)).toHaveLength(1)
    expect(only570).toContain(built(NOW - 2 * DAY))
  })

  /*
   * Числовой revalidate у unstable_cache опускает срок записи ISR, которая его
   * читает, до своего (next/dist/server/web/spec-extension/unstable-cache.js).
   * Стояло 600 у обоих — и поднятый отдельно срок ленты ничего бы не дал.
   */
  test('срок ленты — ровно срок cachedMajorFeed: сутки, страховка за тегом news:major', () => {
    expect(revalidate).toBe(MAJOR_TTL_SEC)
    expect(revalidate).toBe(86_400)
  })
})
