import { createClient } from '@libsql/client'
import { describe, expect, test } from 'vitest'
import {
  PRICE_MAX_AGE_SEC,
  clearDealsCooldown,
  fetchStorePrices,
  parseStorePrices,
  refreshDeals,
} from './deals'
import { getGameMeta, migrateDb, upsertGameMeta, type Db } from './db'
import { discountOf } from './discount'
import type { GameMeta } from './types'

const NOW = 1_700_000_000
const HOUR = 3600

async function freshDb(): Promise<Db> {
  return migrateDb(createClient({ url: ':memory:' }))
}

function meta(appid: number, over: Partial<GameMeta> = {}): GameMeta {
  return { appid, name: `Игра ${appid}`, tags: {}, genres: [], categories: [2], ...over }
}

/** Срез живого ответа GetItems с пустым data_request от 13.08.2026 */
const PRICES_RESPONSE = {
  response: {
    store_items: [
      {
        id: 1478500,
        appid: 1478500,
        name: 'Big Walk',
        visible: true,
        best_purchase_option: {
          final_price_in_cents: '1499',
          original_price_in_cents: '1999',
          discount_pct: 25,
          active_discounts: [{ discount_amount: '500', discount_end_date: 1_787_072_409 }],
        },
      },
      { id: 730, appid: 730, name: 'Counter-Strike 2', visible: true, is_free: true },
    ],
  },
}

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch
}

describe('parseStorePrices', () => {
  test('собирает котировки по appid', () => {
    const map = parseStorePrices(PRICES_RESPONSE)
    expect(map.get(1478500)).toEqual({
      appid: 1478500,
      priceFinal: 1499,
      priceInitial: 1999,
      discountPercent: 25,
      discountEndsAt: 1_787_072_409,
    })
  })

  test('бесплатная игра — котировка без цены, а не пропуск', () => {
    expect(parseStorePrices(PRICES_RESPONSE).get(730)).toEqual({ appid: 730 })
  })

  test('мусор не роняет разбор', () => {
    expect(parseStorePrices(null).size).toBe(0)
    expect(parseStorePrices({ response: {} }).size).toBe(0)
  })
})

describe('fetchStorePrices', () => {
  test('на каждый запрошенный appid приходит ответ, даже если Steam промолчал', () => {
    // Пустая котировка — тоже ответ («цены нет»). Без неё снятая с продажи
    // игра попадала бы в очередь замера на каждом заходе.
    return fetchStorePrices([1478500, 730, 42], { fetchFn: fakeFetch(PRICES_RESPONSE) }).then(
      (quotes) => {
        expect(quotes.map((q) => q.appid)).toEqual([1478500, 730, 42])
        expect(quotes[2]).toEqual({ appid: 42 })
      },
    )
  })

  test('отрицательные appid (не-Steam магазины) не спрашиваем вовсе', async () => {
    let called = false
    const spy = (async () => {
      called = true
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    expect(await fetchStorePrices([-1, -2], { fetchFn: spy })).toEqual([])
    expect(called).toBe(false)
  })

  test('сбой Steam — исключение, а не «цены нет»', async () => {
    await expect(fetchStorePrices([730], { fetchFn: fakeFetch({}, 429) })).rejects.toThrow('429')
  })
})

describe('refreshDeals', () => {
  test('пишет цену и скидку, не трогая метаданные', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, meta(1478500, { tags: { Indie: 10 }, priceFinal: 1999 }), NOW)

    const written = await refreshDeals(db, [1478500], NOW, {
      fetchFn: fakeFetch(PRICES_RESPONSE),
    })
    expect(written).toBe(1)

    const stored = await getGameMeta(db, 1478500)
    expect(stored?.priceFinal).toBe(1499)
    expect(stored?.priceInitial).toBe(1999)
    expect(stored?.discountPercent).toBe(25)
    expect(stored?.priceAt).toBe(NOW)
    // метаданные на месте: узкий UPDATE, а не перезапись строки целиком
    expect(stored?.tags).toEqual({ Indie: 10 })
    expect(stored?.name).toBe('Игра 1478500')
  })

  test('свежий замер не перезапрашивается', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, meta(1478500, { priceAt: NOW - HOUR, priceFinal: 1999 }), NOW)
    let called = false
    const spy = (async () => {
      called = true
      return new Response(JSON.stringify(PRICES_RESPONSE), { status: 200 })
    }) as typeof fetch

    expect(await refreshDeals(db, [1478500], NOW, { fetchFn: spy })).toBe(0)
    expect(called).toBe(false)
  })

  test('протухший замер перезапрашивается', async () => {
    const db = await freshDb()
    await upsertGameMeta(
      db,
      meta(1478500, { priceAt: NOW - PRICE_MAX_AGE_SEC - 1, priceFinal: 1999 }),
      NOW,
    )
    expect(await refreshDeals(db, [1478500], NOW, { fetchFn: fakeFetch(PRICES_RESPONSE) })).toBe(1)
  })

  test('кончившаяся распродажа гасится, а не остаётся навсегда', async () => {
    const db = await freshDb()
    await upsertGameMeta(
      db,
      meta(1478500, {
        priceFinal: 1499,
        priceInitial: 1999,
        discountPercent: 25,
        discountEndsAt: NOW - 10,
        priceAt: NOW - PRICE_MAX_AGE_SEC - 1,
      }),
      NOW,
    )
    // Steam отвечает полной ценой: ни discount_pct, ни original_price
    await refreshDeals(db, [1478500], NOW, {
      fetchFn: fakeFetch({
        response: {
          store_items: [
            { appid: 1478500, visible: true, best_purchase_option: { final_price_in_cents: '1999' } },
          ],
        },
      }),
    })

    const stored = await getGameMeta(db, 1478500)
    expect(stored?.priceFinal).toBe(1999)
    expect(stored?.discountPercent).toBe(0)
    expect(stored?.discountEndsAt).toBeUndefined()
    expect(discountOf(stored!, NOW)).toBeNull()
  })

  test('ответ без цены гасит скидку, но не стирает цену', async () => {
    // Игра могла стать бесплатной, а могла быть скрыта регионом — с этой
    // стороны неразличимо. Обнулить цену бэклога из-за сбоя дороже.
    const db = await freshDb()
    await upsertGameMeta(
      db,
      meta(730, { priceFinal: 1999, priceInitial: 3999, discountPercent: 50 }),
      NOW,
    )
    await refreshDeals(db, [730], NOW, { fetchFn: fakeFetch(PRICES_RESPONSE) })

    const stored = await getGameMeta(db, 730)
    expect(stored?.priceFinal).toBe(1999)
    expect(stored?.discountPercent).toBeUndefined()
    expect(stored?.priceAt).toBe(NOW)
  })

  test('сетевая осечка не роняет подбор и не двигает отметку замера', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, meta(1478500, { priceFinal: 1999 }), NOW)
    expect(await refreshDeals(db, [1478500], NOW, { fetchFn: fakeFetch({}, 500) })).toBe(0)
    expect((await getGameMeta(db, 1478500))?.priceAt).toBeUndefined()
    clearDealsCooldown()
  })

  test('после сбоя выдерживаем паузу, а не долбим Steam с частотой посещений', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, meta(1478500, { priceFinal: 1999 }), NOW)
    await refreshDeals(db, [1478500], NOW, { fetchFn: fakeFetch({}, 429) })

    let called = false
    const spy = (async () => {
      called = true
      return new Response(JSON.stringify(PRICES_RESPONSE), { status: 200 })
    }) as typeof fetch
    expect(await refreshDeals(db, [1478500], NOW, { fetchFn: spy })).toBe(0)
    expect(called).toBe(false)

    clearDealsCooldown()
    expect(await refreshDeals(db, [1478500], NOW, { fetchFn: spy })).toBe(1)
  })

  test('игр нет в базе — в сеть не идём', async () => {
    const db = await freshDb()
    let called = false
    const spy = (async () => {
      called = true
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    expect(await refreshDeals(db, [1, 2, 3], NOW, { fetchFn: spy })).toBe(0)
    expect(called).toBe(false)
  })
})
