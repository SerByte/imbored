import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createDb, getWishlist, saveWishlist } from './db'
import { PRICE_TRUST_SEC } from './discount'
import type { GameMeta } from './types'
import {
  clearWishlistCooldown,
  refreshWishlist,
  refreshWishlistWithin,
  WISHLIST_MAX_AGE_SEC,
  WISHLIST_SHELF,
  wishlistDeals,
  wishlistStale,
} from './wishlist'

const NOW = 1_790_000_000
const DAY = 86_400
const ME = '76561198000000001'

/** Игра из списка желаемого со скидкой в рублях: замер свежий, срок от Steam через два дня */
function onSale(appid: number, over: Partial<GameMeta> = {}): GameMeta {
  return {
    appid,
    name: `Игра ${appid}`,
    tags: {},
    genres: [],
    categories: [2],
    priceCc: 'ru',
    priceFinal: 139_900,
    priceInitial: 199_900,
    discountPercent: 30,
    discountEndsAt: NOW + 2 * DAY,
    priceAt: NOW - 3600,
    ...over,
  }
}

afterEach(() => {
  clearWishlistCooldown()
})

describe('wishlistDeals', () => {
  const deals = (metas: GameMeta[], owned: number[] = [], appids = metas.map((m) => m.appid)) => {
    const byId = new Map(metas.map((m) => [m.appid, m]))
    return wishlistDeals({ appids, metaOf: (id) => byId.get(id), owned: new Set(owned), now: NOW })
  }

  test('только настоящие скидки: погасшая, протухшая и полная цена — мимо', () => {
    const got = deals([
      onSale(1),
      // срок вышел — распродажа кончилась ровно тогда, когда обещала
      onSale(2, { discountEndsAt: NOW - 60 }),
      // срока нет, а замеру больше суток с половиной — скидке не верим
      onSale(3, { discountEndsAt: undefined, priceAt: NOW - PRICE_TRUST_SEC - 60 }),
      onSale(4, { discountPercent: 0, priceFinal: 199_900 }),
    ])
    expect(got.map((d) => d.appid)).toEqual([1])
    expect(got[0]).toMatchObject({ priceCc: 'ru', discount: { percent: 30, finalCents: 139_900, initialCents: 199_900 } })
  })

  test('своё, бесплатное, «не продаётся» и без цены своего региона — мимо', () => {
    const got = deals(
      [
        onSale(1),
        onSale(2),
        onSale(3, { isFree: true }),
        onSale(4, { storeHidden: true }),
        // цена чужого региона: rowToMeta не отдал ни её, ни регион
        onSale(5, { priceCc: undefined }),
      ],
      [2],
    )
    expect(got.map((d) => d.appid)).toEqual([1])
  })

  test('порядок — порядок списка, а не размер скидки; не больше полки', () => {
    const metas = Array.from({ length: 20 }, (_, i) => onSale(i + 1, { discountPercent: 10 + i }))
    const order = [20, 3, 17, ...Array.from({ length: 20 }, (_, i) => i + 1)]
    const got = deals(metas, [], order)
    expect(got).toHaveLength(WISHLIST_SHELF)
    expect(got.slice(0, 3).map((d) => d.appid)).toEqual([20, 3, 17])
    // игр, которых нет в каталоге, полка не выдумывает
    expect(deals([onSale(1)], [], [999, 1]).map((d) => d.appid)).toEqual([1])
  })

  test('обратного отсчёта нет никогда — полка о факте, а не «успей»', () => {
    // Срок через три часа: discountView без urgency: false написал бы
    // «сегодня последний день»
    const got = deals([onSale(1, { discountEndsAt: NOW + 3 * 3600 })])
    expect(got).toHaveLength(1)
    expect(got[0].discount.endsLabel).toBeUndefined()
  })
})

describe('wishlistStale', () => {
  test('не читали — пора; прочитали недавно — рано; полсуток спустя — снова', () => {
    expect(wishlistStale(null, NOW)).toBe(true)
    const row = { takenAt: NOW, closed: false, appids: [1] }
    expect(wishlistStale(row, NOW + 60)).toBe(false)
    expect(wishlistStale(row, NOW + WISHLIST_MAX_AGE_SEC)).toBe(true)
    // закрытый список живёт тот же срок: иначе Steam спрашивали бы на каждом заходе
    expect(wishlistStale({ ...row, closed: true, appids: [] }, NOW + 60)).toBe(false)
  })
})

describe('refreshWishlist', () => {
  function steam(body: unknown, init: { status?: number; eresult?: string } = {}) {
    let calls = 0
    const fetchFn = (async () => {
      calls++
      return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { 'x-eresult': init.eresult ?? '1' },
      })
    }) as unknown as typeof fetch
    return { fetchFn, calls: () => calls }
  }

  test('прочитанный список пишется и возвращается', async () => {
    const db = await createDb(':memory:')
    const got = await refreshWishlist(db, ME, NOW, steam({ response: { items: [{ appid: 1086940, priority: 1 }] } }))
    expect(got).toEqual({ takenAt: NOW, closed: false, appids: [1086940] })
    expect(await getWishlist(db, ME)).toEqual(got)
  })

  test('закрытый — тоже пишется: до конца срока в Steam не ходим', async () => {
    const db = await createDb(':memory:')
    await refreshWishlist(db, ME, NOW, steam({ response: {} }, { eresult: '15' }))
    expect(await getWishlist(db, ME)).toEqual({ takenAt: NOW, closed: true, appids: [] })
  })

  test('сбой Steam ничего не пишет и держит паузу, а не долбит с частотой заходов', async () => {
    const db = await createDb(':memory:')
    await saveWishlist(db, ME, [620], NOW - WISHLIST_MAX_AGE_SEC - 1)
    const down = steam({}, { status: 429 })
    expect(await refreshWishlist(db, ME, NOW, down)).toBeNull()
    // прежний список на месте — сбой не «список пуст»
    expect((await getWishlist(db, ME))?.appids).toEqual([620])

    const up = steam({ response: { items: [{ appid: 730, priority: 0 }] } })
    expect(await refreshWishlist(db, ME, NOW, up)).toBeNull()
    expect(up.calls()).toBe(0)
    clearWishlistCooldown()
    expect((await refreshWishlist(db, ME, NOW, up))?.appids).toEqual([730])
  })

  test('сбой, спрятанный в X-eresult при 200, — тоже сбой: пустым списком не ложится', async () => {
    const db = await createDb(':memory:')
    await saveWishlist(db, ME, [620], NOW - WISHLIST_MAX_AGE_SEC - 1)
    // 20 — ServiceUnavailable: тело то же, что у пустого открытого списка
    expect(await refreshWishlist(db, ME, NOW, steam({ response: {} }, { eresult: '20' }))).toBeNull()
    expect(await getWishlist(db, ME)).toMatchObject({ closed: false, appids: [620] })
  })

  test('с потолком ожидания: не успел — null, но ответ всё равно доезжает', async () => {
    const db = await createDb(':memory:')
    let release!: () => void
    const slow = (async () => {
      await new Promise<void>((r) => {
        release = r
      })
      return new Response(JSON.stringify({ response: { items: [{ appid: 620, priority: 1 }] } }), {
        status: 200,
        headers: { 'x-eresult': '1' },
      })
    }) as unknown as typeof fetch
    expect(await refreshWishlistWithin(db, ME, NOW, 10, { fetchFn: slow })).toBeNull()
    release()
    await new Promise((r) => setTimeout(r, 20))
    expect((await getWishlist(db, ME))?.appids).toEqual([620])
  })
})

describe('сторож: полка желаемого не торопит', () => {
  test('в WishlistShelf нет ни DiscountEnds, ни подписи срока', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'library', 'WishlistShelf.tsx'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    expect(code).toContain('wishlistDeals(')
    expect(code).not.toMatch(/DiscountEnds|endsLabel|discountEndsLabel/)
  })
})
