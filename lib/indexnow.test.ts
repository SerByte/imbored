import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createDb, getCatalogMeta, setNewsDigest, upsertNewsItems, type Db } from './db'
import {
  announceFreshPatches,
  INDEXNOW_ENDPOINT,
  INDEXNOW_MARK,
  indexNowEnabled,
  indexNowKey,
  pingIndexNow,
} from './indexnow'
import type { StoredNews } from './db'

const NOW = 1_790_000_000
const DAY = 86_400
const BASE = 'https://imbored.cc'
const PROD = { INDEXNOW_KEY: 'a1b2c3d4e5f6a7b8', VERCEL_ENV: 'production' }

function item(gid: string, publishedAt: number): StoredNews {
  return {
    appid: 730,
    gid,
    title: `Патч ${gid}`,
    url: `https://store.steampowered.com/news/app/730/view/${gid}`,
    publishedAt,
    kind: 'patch',
    scale: 'major',
    blocks: [],
    bodyHash: gid,
    rank: 100_000,
  }
}

describe('ключ и среда', () => {
  test('ключ — по правилам протокола, иначе null', () => {
    expect(indexNowKey({ INDEXNOW_KEY: 'a1b2c3d4e5f6a7b8' })).toBe('a1b2c3d4e5f6a7b8')
    expect(indexNowKey({ INDEXNOW_KEY: ' short ' })).toBeNull()
    expect(indexNowKey({ INDEXNOW_KEY: 'has space inside!' })).toBeNull()
    expect(indexNowKey({})).toBeNull()
  })

  test('пингуем только с прода: у превью тот же адрес сайта, а база своя', () => {
    expect(indexNowEnabled(PROD)).toBe(true)
    expect(indexNowEnabled({ ...PROD, VERCEL_ENV: 'preview' })).toBe(false)
    expect(indexNowEnabled({ VERCEL_ENV: 'production' })).toBe(false)
  })
})

describe('pingIndexNow', () => {
  test('POST с ключом в теле, адресом файла ключа и хостом', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 202 }))
    const res = await pingIndexNow({ baseUrl: BASE, key: 'a1b2c3d4e5f6a7b8', urls: [`${BASE}/game/730/news/1`], fetchFn })
    expect(res).toEqual({ ok: true, status: 202 })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(INDEXNOW_ENDPOINT)
    expect(url).not.toContain('a1b2c3d4e5f6a7b8')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      host: 'imbored.cc',
      key: 'a1b2c3d4e5f6a7b8',
      keyLocation: 'https://imbored.cc/indexnow-key.txt',
      urlList: ['https://imbored.cc/game/730/news/1'],
    })
  })

  test('отказ и сетевой сбой — не исключение, а ok: false', async () => {
    expect(await pingIndexNow({ baseUrl: BASE, key: 'k'.repeat(8), urls: ['x'], fetchFn: async () => new Response(null, { status: 403 }) })).toEqual({ ok: false, status: 403 })
    expect(
      await pingIndexNow({
        baseUrl: BASE,
        key: 'k'.repeat(8),
        urls: ['x'],
        fetchFn: async () => Promise.reject(new Error('сеть')),
      }),
    ).toEqual({ ok: false, status: null })
  })
})

describe('announceFreshPatches', () => {
  let db: Db
  beforeEach(async () => {
    db = await createDb(':memory:')
    await upsertNewsItems(db, [item('100', NOW - DAY), item('200', NOW - 2 * DAY), item('300', NOW - DAY)], NOW)
    await setNewsDigest(db, 730, '100', { tldr: 'коротко', scale: 'major' }, NOW + 10)
    await setNewsDigest(db, 730, '200', { tldr: 'коротко', scale: 'major' }, NOW + 20)
  })

  test('перегенерирует страницы, объявляет их и двигает отметку', async () => {
    const revalidate = vi.fn()
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }))
    const res = await announceFreshPatches(db, { now: NOW + 60, baseUrl: BASE, revalidate, env: PROD, fetchFn })
    expect(res).toEqual({ count: 2, pinged: true, ok: true, status: 200 })
    expect(revalidate.mock.calls.map((c) => c[0])).toEqual(['/game/730/news/100', '/game/730/news/200'])
    expect(JSON.parse((await getCatalogMeta(db, INDEXNOW_MARK))!).digestedAt).toBe(NOW + 20)

    // второй раз — объявлять нечего, пока не появится новый пересказ
    expect(await announceFreshPatches(db, { now: NOW + 120, baseUrl: BASE, revalidate, env: PROD, fetchFn })).toBeNull()
    await setNewsDigest(db, 730, '300', { tldr: 'коротко', scale: 'major' }, NOW + 200)
    const again = await announceFreshPatches(db, { now: NOW + 300, baseUrl: BASE, revalidate, env: PROD, fetchFn })
    expect(again?.count).toBe(1)
  })

  test('отказ IndexNow — отметка стоит: в следующий раз те же адреса', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 429 }))
    const revalidate = vi.fn()
    const res = await announceFreshPatches(db, { now: NOW + 60, baseUrl: BASE, revalidate, env: PROD, fetchFn })
    expect(res?.ok).toBe(false)
    const again = await announceFreshPatches(db, { now: NOW + 120, baseUrl: BASE, revalidate, env: PROD, fetchFn })
    expect(again?.count).toBe(2)
  })

  test('без ключа или не на проде — страницы перегенерируются, а в сеть не ходим', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }))
    const revalidate = vi.fn()
    const res = await announceFreshPatches(db, {
      now: NOW + 60,
      baseUrl: BASE,
      revalidate,
      env: { VERCEL_ENV: 'preview', INDEXNOW_KEY: PROD.INDEXNOW_KEY },
      fetchFn,
    })
    expect(res).toEqual({ count: 2, pinged: false, ok: true, status: null })
    expect(revalidate).toHaveBeenCalledTimes(2)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
