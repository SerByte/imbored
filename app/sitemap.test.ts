import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  replaceGameTags,
  setNewsDigest,
  setNewsDigestEn,
  upsertGameMeta,
  upsertNewsItems,
  type Db,
  type StoredNews,
} from '@/lib/db'
import { HUB_MIN_SHELF } from '@/lib/gamehub'
import { freshDb } from '@/lib/testing/route'
import sitemap from './sitemap'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

const T0 = 1_760_000_000
let db: Db

beforeEach(async () => {
  db = await freshDb()
  await upsertGameMeta(
    db,
    { appid: 730, name: 'Counter-Strike 2', tags: { FPS: 1000 }, genres: [], categories: [1], reviewsTotal: 9000 },
    T0,
  )
  await replaceGameTags(db, 730, [{ tag: 'FPS', weight: 1000 }])
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/** База отвечает, но запрос падает — так выглядит таймаут Turso посреди перегенерации */
function queriesFail(): void {
  const timeout = () => Promise.reject(new Error('Turso: operation timed out'))
  db.execute = timeout as Db['execute']
  db.batch = timeout as Db['batch']
}

const urls = async () => (await sitemap()).map((e) => new URL(e.url).pathname)

describe('карта сайта и осечка базы', () => {
  test('живая база — в карте и статические адреса, и карточки игр', async () => {
    const got = await urls()
    expect(got).toContain('/')
    expect(got).toContain('/game/730')
  })

  test('каждый адрес — на обоих языках, и у каждого — все версии и x-default', async () => {
    const entries = await sitemap()
    const paths = entries.map((e) => new URL(e.url).pathname)
    for (const p of ['/', '/quiz', '/games', '/whatsnew', '/privacy', '/support', '/game/730']) {
      expect(paths, p).toContain(p)
      expect(paths, p).toContain(p === '/' ? '/en' : `/en${p}`)
    }
    expect(paths.filter((p) => p.startsWith('/en')).length * 2).toBe(paths.length)
    const game = entries.filter((e) => /\/game\/730$/.test(new URL(e.url).pathname))
    expect(game).toHaveLength(2)
    for (const e of game) {
      expect(e.alternates?.languages).toEqual({
        ru: 'http://localhost:3000/game/730',
        en: 'http://localhost:3000/en/game/730',
        'x-default': 'http://localhost:3000/game/730',
      })
    }
    const home = entries.find((e) => new URL(e.url).pathname === '/en')
    expect(home?.alternates?.languages).toMatchObject({ ru: 'http://localhost:3000/', en: 'http://localhost:3000/en' })
  })

  test('квиз — в карте (он в выдаче), заглушки /daily и /rooms — нет (noindex)', async () => {
    const got = await urls()
    expect(got).toContain('/quiz')
    expect(got).not.toContain('/daily')
    expect(got).not.toContain('/rooms')
  })

  /*
   * Карта живёт на ISR сутки. Пойманная ошибка закэшировала бы карту из
   * тридцати статических адресов вместо шести тысяч — на сутки, и её
   * забрали бы Googlebot, Bing и Яндекс. Брошенная оставляет в кэше прошлую
   * полную карту (docs: incremental-static-regeneration, «Handling uncaught
   * exceptions»), и Next повторит перегенерацию следующим запросом.
   */
  test('при перегенерации ошибка уходит наружу — ISR оставит прошлую полную карту', async () => {
    queriesFail()
    await expect(sitemap()).rejects.toThrow(/timed out/)
  })

  test('на сборке без базы — статические адреса, а не упавший build', async () => {
    vi.stubEnv('NEXT_PHASE', PHASE_PRODUCTION_BUILD)
    queriesFail()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const got = await urls()
    errors.mockRestore()
    expect(got).toContain('/')
    expect(got).toContain('/games')
    // жанры известны без базы — переживают и сборку без неё, на обоих языках
    expect(got).toContain('/games/open-world')
    expect(got).toContain('/en/games/open-world')
    // подборки — нет: их страницы на такой сборке собраны пустыми и закрыты от индекса
    expect(got).not.toContain('/games/coop')
    expect(got).not.toContain('/en/games/coop')
    expect(got).not.toContain('/game/730')
  })

  /*
   * Подборка — отбор каталога, а не список руками, как жанры, и бывает
   * тонкой: «на 20 минут» ждёт уверенной семантики. Короче полки хаба
   * страница закрыта от индекса (thinList), и адрес в карте был бы «Submitted
   * URL marked noindex». В карте — ровно то, что страница пускает в поиск.
   */
  test('подборка — в карте, только когда её страница идёт в поиск', async () => {
    const coop = async (appid: number) => {
      await upsertGameMeta(
        db,
        {
          appid,
          name: `Игра ${appid}`,
          tags: { 'Online Co-Op': 1000 },
          genres: [],
          categories: [1, 9, 38],
          reviewsTotal: 1000 + appid,
        },
        T0,
      )
      await replaceGameTags(db, appid, [{ tag: 'Online Co-Op', weight: 1000 }])
    }
    for (let i = 1; i < HUB_MIN_SHELF; i++) await coop(1000 + i)
    let got = await urls()
    expect(got).not.toContain('/games/coop')
    expect(got).not.toContain('/en/games/coop')
    // без уверенной семантики «на 20 минут» нечем ответить — и в карте её нет
    expect(got).not.toContain('/games/short')

    await coop(1000 + HUB_MIN_SHELF)
    got = await urls()
    expect(got).toContain('/games/coop')
    expect(got.filter((u) => u === '/games/coop')).toHaveLength(1)
    expect(got).not.toContain('/games/short')
    expect(got).not.toContain('/en/games/short')

    // Подборка — как жанр: на обоих языках, и у каждой версии — обе и x-default
    const entries = (await sitemap()).filter((e) => /\/games\/coop$/.test(new URL(e.url).pathname))
    expect(entries.map((e) => new URL(e.url).pathname).sort()).toEqual(['/en/games/coop', '/games/coop'])
    for (const e of entries) {
      expect(e.alternates?.languages).toEqual({
        ru: 'http://localhost:3000/games/coop',
        en: 'http://localhost:3000/en/games/coop',
        'x-default': 'http://localhost:3000/games/coop',
      })
    }
  })

  /*
   * Архив обновлений игры — в карте, только когда в нём есть своё: не меньше
   * трёх пересказанных крупных патчей (lib/patcharchive). lastmod — свежий
   * патч или пересказ, а не updated_at строки (sitemapPatchArchives).
   */
  test('архив обновлений — от трёх пересказов, с датой последней перемены', async () => {
    const news = (gid: string, at: number): StoredNews => ({
      appid: 730,
      gid,
      title: 'Обновление',
      url: '',
      publishedAt: at,
      kind: 'patch',
      scale: 'major',
      blocks: [],
      bodyHash: `h${gid}`,
      rank: 9000,
    })
    await upsertNewsItems(db, [news('1', T0 - 300), news('2', T0 - 200)], T0)
    for (const gid of ['1', '2']) await setNewsDigest(db, 730, gid, { tldr: 'коротко', scale: 'major' }, T0)
    expect(await urls()).not.toContain('/game/730/news')

    await upsertNewsItems(db, [news('3', T0 - 100)], T0)
    await setNewsDigest(db, 730, '3', { tldr: 'коротко', scale: 'major' }, T0 + 60)
    const entry = (await sitemap()).find((e) => new URL(e.url).pathname === '/game/730/news')
    expect(entry?.lastModified).toEqual(new Date((T0 + 60) * 1000))
    // Своё у архива — русские пересказы: английский двойник без своих стоял бы
    // с noindex, и в карте его нет — ни адресом, ни hreflang
    expect(await urls()).not.toContain('/en/game/730/news')
    expect(entry?.alternates?.languages).toEqual({
      ru: 'http://localhost:3000/game/730/news',
      'x-default': 'http://localhost:3000/game/730/news',
    })
  })

  test('на сборке getDb() бросает сам (нет TURSO_DATABASE_URL) — и это не роняет build', async () => {
    vi.stubEnv('NEXT_PHASE', PHASE_PRODUCTION_BUILD)
    // Слот, в котором getDb() держит промис соединения (lib/server)
    const slot = globalThis as typeof globalThis & { __imboredDb?: Promise<Db> }
    const down = Promise.reject(new Error('TURSO_DATABASE_URL не задан'))
    down.catch(() => {})
    slot.__imboredDb = down
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const got = await urls()
    errors.mockRestore()
    expect(got).toContain('/whatsnew')
    expect(got).not.toContain('/game/730')
  })
})

/**
 * Патчи — каждый на тех языках, где у страницы своё: пересказ своего языка.
 * /en-двойник патча без английского пересказа стоит с noindex (docs/i18n.md),
 * и в карте ему не место — ни адресом, ни hreflang с русской версии.
 */
describe('карта сайта и языки патчей', () => {
  const now = () => Math.floor(Date.now() / 1000)
  const patch = (gid: string) => ({
    appid: 730,
    gid,
    title: `Обновление ${gid}`,
    url: `https://store.steampowered.com/news/app/730/view/${gid}`,
    publishedAt: now() - 86_400,
    kind: 'patch' as const,
    scale: 'major' as const,
    blocks: [{ kind: 'p' as const, runs: [{ text: 'Починили сеть' }] }],
    bodyHash: `h${gid}`,
    rank: 9000,
  })

  test('с одним русским пересказом — только русский адрес и hreflang без en; с обоими — пара', async () => {
    await upsertNewsItems(db, [patch('1'), patch('2')], now())
    await setNewsDigest(db, 730, '1', { tldr: 'Починили сеть.', scale: 'major' }, now())
    await setNewsDigest(db, 730, '2', { tldr: 'Новая карта.', scale: 'major' }, now())
    await setNewsDigestEn(db, 730, '2', { tldrEn: 'A new map.' }, now())
    const entries = await sitemap()
    const news = entries
      .filter((e) => /\/news\//.test(e.url))
      .map((e) => ({ path: new URL(e.url).pathname, langs: e.alternates?.languages }))

    expect(news.map((n) => n.path).sort()).toEqual(['/en/game/730/news/2', '/game/730/news/1', '/game/730/news/2'])
    expect(news.find((n) => n.path === '/game/730/news/1')?.langs).toEqual({
      ru: 'http://localhost:3000/game/730/news/1',
      'x-default': 'http://localhost:3000/game/730/news/1',
    })
    for (const path of ['/game/730/news/2', '/en/game/730/news/2']) {
      expect(news.find((n) => n.path === path)?.langs).toEqual({
        ru: 'http://localhost:3000/game/730/news/2',
        en: 'http://localhost:3000/en/game/730/news/2',
        'x-default': 'http://localhost:3000/game/730/news/2',
      })
    }
  })
})
