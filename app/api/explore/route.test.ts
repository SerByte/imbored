import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { logFeedback, saveLibrarySnapshot, updateGamePrices, upsertGamesMeta, type Db } from '@/lib/db'
import { EXPLORE_DECK } from '@/lib/explore'
import { nowSec } from '@/lib/server'
import { freshDb, signIn, signInAs } from '@/lib/testing/route'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * /api/explore — колода исследователя настоящим роутом на базе в памяти:
 * отказы с кодами, которые ждёт страница, колода своего и каталога без
 * модели, пролистанное не возвращается, приглянувшееся — на полке.
 */

const STEAMID = '76561197960287930'
const OWN = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
const SHOP = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29]

const get = () => GET(new Request('http://localhost/api/explore'))

type Body = {
  cards: Array<{ appid: number; ownedByAll: boolean; reason: string; tags: string[] }>
  liked: Array<{ appid: number; name: string; owned: boolean; priceFinal: number | null }>
  nowSec: number
}

let db: Db
let calls: string[]

beforeEach(async () => {
  db = await freshDb()
  // Ключ модели есть: колода не обязана его трогать
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      calls.push(input instanceof Request ? input.url : String(input))
      return new Response('', { status: 404 })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function seed(): Promise<void> {
  const now = nowSec()
  await saveLibrarySnapshot(
    db,
    STEAMID,
    [1, ...OWN].map((appid) => ({
      appid,
      name: `Игра ${appid}`,
      playtimeForever: appid === 1 ? 3000 : 0,
      playtime2Weeks: 0,
    })),
    now,
  )
  await upsertGamesMeta(
    db,
    [1, ...OWN, ...SHOP].map((appid) => ({
      appid,
      name: `Игра ${appid}`,
      tags: { Puzzle: 100, Casual: 60 },
      genres: [],
      categories: [2],
    })),
    now,
  )
}

describe('/api/explore', () => {
  test('без сессии — 401 nosession, без снапшота — 409 nolibrary', async () => {
    const guest = await get()
    expect(guest.status).toBe(401)
    expect(await guest.json()).toEqual({ error: 'nosession' })

    await signIn(db, STEAMID, { verified: true })
    const res = await get()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'nolibrary' })
  })

  test('колода — своё и каталог вперемешку, с причинами и без модели', async () => {
    await signIn(db, STEAMID, { verified: true })
    await seed()
    const res = await get()
    expect(res.status).toBe(200)
    const body = (await res.json()) as Body
    expect(body.cards.length).toBeGreaterThan(0)
    expect(body.cards.length).toBeLessThanOrEqual(EXPLORE_DECK)
    const owned = body.cards.filter((c) => c.ownedByAll)
    expect(owned.length).toBeGreaterThan(0)
    expect(owned.length).toBeLessThan(body.cards.length)
    // Соседние карты — не одной стороны подряд, пока хватает обеих
    expect(body.cards[0].ownedByAll).not.toBe(body.cards[1].ownedByAll)
    for (const c of body.cards) {
      expect(c.reason.length, `${c.appid}`).toBeGreaterThan(0)
      expect(c.tags).toEqual(['Puzzle', 'Casual'])
    }
    expect(body.liked).toEqual([])
    expect(calls.filter((u) => u.includes('anthropic'))).toEqual([])
  })

  test('пролистанное не возвращается, приглянувшееся лежит на полке', async () => {
    await signIn(db, STEAMID, { verified: true })
    await seed()
    const now = nowSec()
    await logFeedback(db, { steamid: STEAMID, appid: 20, action: 'opened', reason: 'explore' }, now - 60)
    await logFeedback(db, { steamid: STEAMID, appid: 10, action: 'skipped', reason: 'explore' }, now - 30)
    const body = (await (await get()).json()) as Body
    const shown = body.cards.map((c) => c.appid)
    expect(shown).not.toContain(20)
    expect(shown).not.toContain(10)
    expect(body.liked).toEqual([
      {
        appid: 20,
        name: 'Игра 20',
        headerImage: null,
        art: null,
        owned: false,
        isFree: false,
        priceFinal: null,
        discount: null,
      },
    ])
  })

  test('полка — с ценой у чужого, без цены у своего, и без потолка в двенадцать', async () => {
    await signIn(db, STEAMID, { verified: true })
    await seed()
    const now = nowSec()
    // Свежая цена — магазин не спрашивается, а на плитке ценник
    await updateGamePrices(
      db,
      [
        { appid: 21, priceFinal: 49_900, priceInitial: 49_900 },
        { appid: 11, priceFinal: 19_900, priceInitial: 19_900 },
      ],
      now,
    )
    await logFeedback(db, { steamid: STEAMID, appid: 21, action: 'opened', reason: 'explore' }, now - 100)
    await logFeedback(db, { steamid: STEAMID, appid: 11, action: 'opened', reason: 'explore' }, now - 90)
    // Прежний потолок: двенадцать плиток. Тринадцатая и дальше теперь на полке
    const more = Array.from({ length: 14 }, (_, i) => 1000 + i)
    await upsertGamesMeta(
      db,
      more.map((appid) => ({ appid, name: `Игра ${appid}`, tags: { Puzzle: 100 }, genres: [], categories: [2] })),
      now,
    )
    for (const [i, appid] of more.entries()) {
      await logFeedback(db, { steamid: STEAMID, appid, action: 'opened', reason: 'explore' }, now - 80 + i)
    }
    const body = (await (await get()).json()) as Body
    expect(body.liked).toHaveLength(16)
    const byId = new Map(body.liked.map((c) => [c.appid, c]))
    expect(byId.get(21)).toMatchObject({ owned: false, priceFinal: 49_900 })
    // своя игра — без ценника: её не покупают
    expect(byId.get(11)).toMatchObject({ owned: true, priceFinal: null })
    // свежие сверху
    expect(body.liked[0].appid).toBe(1013)
  })

  test('сессия по ссылке колоду получает: это чтение', async () => {
    const steamid = await signInAs(db, 'claimed')
    const now = nowSec()
    await saveLibrarySnapshot(
      db,
      steamid,
      OWN.map((appid) => ({ appid, name: `Игра ${appid}`, playtimeForever: 0, playtime2Weeks: 0 })),
      now,
    )
    await upsertGamesMeta(
      db,
      OWN.map((appid) => ({ appid, name: `Игра ${appid}`, tags: { Puzzle: 100 }, genres: [], categories: [2] })),
      now,
    )
    expect((await get()).status).toBe(200)
  })
})
