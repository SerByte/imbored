import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  countUserRows,
  createDb,
  createSession,
  forgetUser,
  getWishlist,
  saveLibrarySnapshot,
  saveWishlist,
} from './db'
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
  /** Сессия, открывшая /library: по её sid запись сверяет, не забыта ли она */
  const MINE = { steamid: ME, sid: 'sid-me' }

  /**
   * Полку зовёт только /library со снимком, и список пишет только незабытая
   * сессия рядом с ним (saveWishlist) — тесты начинают с подключённого и
   * вошедшего через Steam
   */
  async function connected() {
    const db = await createDb(':memory:')
    await saveLibrarySnapshot(
      db,
      ME,
      [{ appid: 570, name: 'Dota 2', playtimeForever: 600, playtime2Weeks: 0 }],
      NOW - DAY,
    )
    await createSession(db, { ...MINE, verified: true }, NOW - DAY)
    return db
  }

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

  /** Steam, который ответит списком [620] только по release() — медленнее потолка ожидания */
  function held() {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const fetchFn = (async () => {
      await gate
      return new Response(JSON.stringify({ response: { items: [{ appid: 620, priority: 1 }] } }), {
        status: 200,
        headers: { 'x-eresult': '1' },
      })
    }) as unknown as typeof fetch
    return { fetchFn, release }
  }

  test('прочитанный список пишется и возвращается', async () => {
    const db = await connected()
    const got = await refreshWishlist(db, MINE, NOW, steam({ response: { items: [{ appid: 1086940, priority: 1 }] } }))
    expect(got).toEqual({ takenAt: NOW, closed: false, appids: [1086940] })
    expect(await getWishlist(db, ME)).toEqual(got)
  })

  test('закрытый — тоже пишется: до конца срока в Steam не ходим', async () => {
    const db = await connected()
    await refreshWishlist(db, MINE, NOW, steam({ response: {} }, { eresult: '15' }))
    expect(await getWishlist(db, ME)).toEqual({ takenAt: NOW, closed: true, appids: [] })
  })

  test('сбой Steam ничего не пишет и держит паузу, а не долбит с частотой заходов', async () => {
    const db = await connected()
    await saveWishlist(db, MINE, [620], NOW - WISHLIST_MAX_AGE_SEC - 1)
    const down = steam({}, { status: 429 })
    expect(await refreshWishlist(db, MINE, NOW, down)).toBeNull()
    // прежний список на месте — сбой не «список пуст»
    expect((await getWishlist(db, ME))?.appids).toEqual([620])

    const up = steam({ response: { items: [{ appid: 730, priority: 0 }] } })
    expect(await refreshWishlist(db, MINE, NOW, up)).toBeNull()
    expect(up.calls()).toBe(0)
    clearWishlistCooldown()
    expect((await refreshWishlist(db, MINE, NOW, up))?.appids).toEqual([730])
  })

  test('сбой, спрятанный в X-eresult при 200, — тоже сбой: пустым списком не ложится', async () => {
    const db = await connected()
    await saveWishlist(db, MINE, [620], NOW - WISHLIST_MAX_AGE_SEC - 1)
    // 20 — ServiceUnavailable: тело то же, что у пустого открытого списка
    expect(await refreshWishlist(db, MINE, NOW, steam({ response: {} }, { eresult: '20' }))).toBeNull()
    expect(await getWishlist(db, ME)).toMatchObject({ closed: false, appids: [620] })
  })

  test('с потолком ожидания: не успел — null, но ответ всё равно доезжает', async () => {
    const db = await connected()
    const slow = held()
    expect(await refreshWishlistWithin(db, MINE, NOW, 10, { fetchFn: slow.fetchFn })).toBeNull()
    slow.release()
    await new Promise((r) => setTimeout(r, 20))
    expect((await getWishlist(db, ME))?.appids).toEqual([620])
  })

  /*
   * Не успевший к сроку ответ пишется в after() — секунды спустя, а кнопка
   * «Удалить всё обо мне» на той же /library. Удаление, прошедшее, пока Steam
   * отвечал, не должно получить вслед вечную строку wishlists — даже если
   * профиль тем временем подключили заново: по ссылке (/api/connect) это
   * может любой, и снимок есть снова, но читали от сессии, которую удаление
   * стёрло.
   */
  test('ответ, доехавший после «Удалить всё обо мне», не пишется — и после нового подключения', async () => {
    const db = await connected()
    const slow = held()
    expect(await refreshWishlistWithin(db, MINE, NOW, 10, { fetchFn: slow.fetchFn })).toBeNull()
    await forgetUser(db, ME, { signOutFrom: NOW + 1 })
    await saveLibrarySnapshot(
      db,
      ME,
      [{ appid: 570, name: 'Dota 2', playtimeForever: 600, playtime2Weeks: 0 }],
      NOW + 2,
    )
    slow.release()
    await new Promise((r) => setTimeout(r, 20))
    expect(await getWishlist(db, ME)).toBeNull()
    const left = (await countUserRows(db, ME)).filter((r) => r.rows > 0).map((r) => r.table)
    expect(left).not.toContain('wishlists')
  })

  /*
   * Возвращается записанное, а не прочитанное: не легла запись — null, и
   * никто не примет такой ответ за доказательство, что строка есть. Паузы
   * отказ не ставит — Steam ответил, и следующая сессия ходит к нему как
   * обычно.
   */
  test('не легла по условию — null без паузы; новая сессия пишет как обычно', async () => {
    const db = await connected()
    const slow = held()
    const late = refreshWishlist(db, MINE, NOW, { fetchFn: slow.fetchFn })
    await forgetUser(db, ME, { signOutFrom: NOW + 1 })
    slow.release()
    expect(await late).toBeNull()

    // Вернулся и вошёл через Steam: свой снимок, своя строка сессии
    const again = { steamid: ME, sid: 'sid-again' }
    await saveLibrarySnapshot(
      db,
      ME,
      [{ appid: 570, name: 'Dota 2', playtimeForever: 600, playtime2Weeks: 0 }],
      NOW + 10,
    )
    await createSession(db, { ...again, verified: true }, NOW + 10)
    const got = await refreshWishlist(db, again, NOW + 20, steam({ response: { items: [{ appid: 730, priority: 0 }] } }))
    expect(got).toEqual({ takenAt: NOW + 20, closed: false, appids: [730] })
    expect(await getWishlist(db, ME)).toEqual(got)
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
