import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getMajorFeed, setNewsDigest, upsertNewsItems, type Db, type StoredNews } from './db'
import { freshDb } from './testing/route'
import { MAJOR_TTL_SEC, NEWS_MAJOR_TAG, cachedMajorFeed } from './whatsnewcache'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Что именно отдали в unstable_cache. Сам кэш вне сервера Next не работает,
 * а здесь он и не нужен: предмет проверки — из чего Next построит ключ.
 * Подмена возвращает колбэк как есть, так что cachedMajorFeed в этом файле —
 * прямой вызов связанной функции.
 */
const captured = vi.hoisted(() => ({
  cb: null as null | ((...args: unknown[]) => unknown),
  keyParts: null as null | string[],
  options: null as null | { tags?: string[]; revalidate?: number | false },
}))
vi.mock('next/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/cache')>()),
  unstable_cache: (
    cb: (...args: unknown[]) => unknown,
    keyParts: string[],
    options: { tags?: string[]; revalidate?: number | false },
  ) => {
    captured.cb = cb
    captured.keyParts = keyParts
    captured.options = options
    return cb
  },
}))

/**
 * Голова ленты (/api/whatsnew/head, слой app-route) и страница /whatsnew
 * (слой app-rsc) обязаны читать ОДНУ запись кэша — иначе плашка «N новых»
 * снова обгоняет router.refresh() (см. докблок роута головы).
 *
 * unstable_cache ключует по `${cb.toString()}-${keyParts}` и аргументам, а
 * Turbopack компилирует одну и ту же стрелку по-разному в разных слоях и
 * чанках: слой-зависимые имена импортов в dev, разные имена параметров у
 * минификатора в проде. Наблюдали обе формы в .next рабочей копии — две
 * записи под одним тегом. Связанная копия (bind) стрингифицируется в
 * нативную заглушку везде одинаково, и ключ держится на keyParts и
 * аргументах. route.test.ts головы этого не поймает: он подменяет
 * cachedMajorFeed целиком.
 */
describe('cachedMajorFeed: ключ не зависит от того, как слой собрал колбэк', () => {
  test('колбэк — связанная функция: её текст одинаков в любом слое и чанке', () => {
    expect(captured.cb, 'unstable_cache не вызван при импорте модуля').not.toBeNull()
    // Стрелка или обычная функция на этом месте вернули бы свой исходник —
    // а он и есть часть ключа, разная у app-route и app-rsc
    expect(captured.cb!.toString()).toBe('function () { [native code] }')
  })

  test('ключ держится на keyParts: версионирован и сброс идёт по тегу кронов', () => {
    // Текст функции больше не разводит кэши, поэтому keyParts — единственное,
    // что отличает эту запись от любой другой связанной функции в проекте
    expect(captured.keyParts).toHaveLength(1)
    expect(captured.keyParts![0]).toMatch(/^whatsnew:major:v\d+$/)
    expect(captured.options?.tags).toEqual([NEWS_MAJOR_TAG])
    // Срок — экспортированный MAJOR_TTL_SEC: по нему же сверяет свой revalidate
    // RSS-лента (app/[lang]/whatsnew/feed.xml/route.test.ts) — меньший срок
    // кэша опустил бы до себя и срок ленты
    expect(captured.options?.revalidate).toBe(MAJOR_TTL_SEC)
    expect(MAJOR_TTL_SEC).toBeGreaterThan(0)
  })
})

const NOW = Math.floor(Date.now() / 1000)
const DAY = 86_400

function patch(appid: number, daysAgo: number, rank: number): StoredNews {
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
})

describe('cachedMajorFeed: связанная копия ведёт в ту же выборку', () => {
  test('limit и minRank доходят до getMajorFeed на своих местах', async () => {
    await upsertNewsItems(
      db,
      [patch(730, 0, 90_000), patch(570, 1, 50_000), patch(440, 2, 10_000), patch(620, 3, 60_000)],
      NOW,
    )

    const keys = (items: StoredNews[]) => items.map((i) => `${i.appid}:${i.gid}`)
    // Порог отсекает 440, limit — хвост: перепутанные аргументы дали бы
    // limit = 20000 и порог 2 — то есть всю ленту
    const viaCache = await cachedMajorFeed(2, 20_000)
    expect(keys(viaCache)).toEqual(keys(await getMajorFeed(db, 2, { minRank: 20_000 })))
    expect(viaCache).toHaveLength(2)
    expect(keys(viaCache)).not.toContain('440:4400')
  })
})

/**
 * Одна запись кэша на оба языка: строки несут английские слоты, а язык
 * выбирает страница. Иначе /en/whatsnew держал бы свою запись под тем же
 * тегом и расходился бы с плашкой «N новых».
 */
describe('cachedMajorFeed: английские слоты в той же записи', () => {
  test('строки ленты несут tldrEn и titleEn, если они есть', async () => {
    await upsertNewsItems(db, [patch(730, 0, 90_000), patch(570, 1, 50_000)], NOW)
    await setNewsDigest(
      db,
      730,
      '7300',
      { tldr: 'Новый режим.', scale: 'major', tldrEn: 'A new mode.', titleEn: 'Update 730' },
      NOW,
    )
    const rows = await cachedMajorFeed(30, 0)
    expect(rows.find((r) => r.appid === 730)).toMatchObject({
      tldr: 'Новый режим.',
      tldrEn: 'A new mode.',
      titleEn: 'Update 730',
    })
    expect(rows.find((r) => r.appid === 570)).not.toHaveProperty('tldrEn')
  })
})
