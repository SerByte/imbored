import { isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { upsertGamesMeta, type Db } from '@/lib/db'
import { resetSwallowed } from '@/lib/errlog'
import { freshDb } from '@/lib/testing/route'
import type { GameMeta } from '@/lib/types'
import { WishlistShelf } from './WishlistShelf'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Полка «Из желаемого подешевело» настоящим серверным компонентом на базе в
 * памяти. Список и цены свежие — в Steam полка не ходит, и тест это
 * проверяет: подменённый fetch считает вызовы.
 */

const NOW = 1_790_000_000
const ME = '76561198000000001'
const NB = String.fromCharCode(0xa0)

function game(appid: number, name: string, over: Partial<GameMeta> = {}): GameMeta {
  return {
    appid,
    name,
    tags: { RPG: 100 },
    genres: [],
    categories: [2],
    priceCc: 'ru',
    priceFinal: 139_900,
    priceInitial: 199_900,
    discountPercent: 30,
    // срок от Steam совсем близко: полка его не назовёт всё равно
    discountEndsAt: NOW + 3 * 3600,
    priceAt: NOW - 600,
    ...over,
  }
}

let db: Db
const steam = vi.fn<(url: unknown) => Promise<Response>>(async () => new Response('{}', { status: 500 }))

beforeEach(async () => {
  db = await freshDb()
  steam.mockClear()
  vi.stubEnv('STEAM_STORE_CC', 'ru')
  vi.stubGlobal('fetch', steam)
  return () => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  }
})

async function shelf(owned: number[] = []): Promise<string> {
  const el = await WishlistShelf({
    steamid: ME,
    row: { takenAt: NOW - 60, closed: false, appids: [1086940, 1091500, 620, 730] },
    owned: new Set(owned),
    now: NOW,
  })
  return el && isValidElement(el) ? renderToStaticMarkup(el as ReactElement) : ''
}

describe('WishlistShelf', () => {
  test('скидки из списка — в рублях, со ссылкой на весь список и без срока', async () => {
    await upsertGamesMeta(
      db,
      [
        game(1086940, "Baldur's Gate 3"),
        // не продаётся в регионе — мимо полки
        game(1091500, 'Cyberpunk 2077', { storeHidden: true, priceFinal: undefined, discountPercent: undefined }),
        // полная цена — не скидка
        game(620, 'Portal 2', { priceFinal: 39_900, priceInitial: 39_900, discountPercent: 0 }),
      ],
      NOW,
    )
    const html = await shelf()
    expect(html).toContain('Из желаемого подешевело')
    expect(html).toContain('Baldur&#x27;s Gate 3')
    expect(html).toContain(`1${NB}399${NB}₽`)
    expect(html).toContain(`1${NB}999${NB}₽`)
    expect(html).toContain('по ценам российского Steam')
    expect(html).toContain(`https://store.steampowered.com/wishlist/profiles/${ME}/`)
    expect(html).not.toContain('Cyberpunk')
    expect(html).not.toContain('Portal 2')
    // ни «сегодня последний день», ни даты: полка о факте, а не «успей»
    expect(html).not.toMatch(/последний день|осталось|до \d/)
    // список прочитан минуту назад, цены — десять минут: в Steam незачем
    expect(steam).not.toHaveBeenCalled()
  })

  test('купленное и закрытый список — полки нет вовсе', async () => {
    await upsertGamesMeta(db, [game(1086940, "Baldur's Gate 3")], NOW)
    expect(await shelf([1086940])).toBe('')
    const closed = await WishlistShelf({
      steamid: ME,
      row: { takenAt: NOW - 60, closed: true, appids: [] },
      owned: new Set(),
      now: NOW,
    })
    expect(closed).toBeNull()
  })

  test('сбой базы — полки нет и строка в журнал, а не исключение на всю /library', async () => {
    // Без таблицы games getGamesMetaLite бросает — как бросил бы Turso при осечке
    await db.execute('DROP TABLE games')
    resetSwallowed()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const el = await WishlistShelf({
        steamid: ME,
        row: { takenAt: NOW - 60, closed: false, appids: [1086940] },
        owned: new Set(),
        now: NOW,
      })
      expect(el).toBeNull()
      const lines = warn.mock.calls.map((c) => String(c[0]))
      expect(lines.some((l) => l.includes('"where":"wishlist:shelf"'))).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('WishlistShelf: протухшее перечитывается', () => {
  test('старый список — к Steam за новым, старые цены — за свежими, в регионе цен', async () => {
    // Цена снята тринадцать часов назад, скидки тогда не было
    await upsertGamesMeta(
      db,
      [game(1086940, "Baldur's Gate 3", { priceFinal: 199_900, discountPercent: 0, discountEndsAt: undefined, priceAt: NOW - 13 * 3600 })],
      NOW - 13 * 3600,
    )
    const countries: string[] = []
    steam.mockImplementation(async (url: unknown) => {
      const u = new URL(String(url))
      if (u.pathname.includes('GetWishlist')) {
        return new Response(JSON.stringify({ response: { items: [{ appid: 1086940, priority: 1, date_added: 1 }] } }), {
          status: 200,
          headers: { 'x-eresult': '1' },
        })
      }
      const input = JSON.parse(u.searchParams.get('input_json') ?? '{}') as { context: { country_code: string } }
      countries.push(input.context.country_code)
      return new Response(
        JSON.stringify({
          response: {
            store_items: [
              {
                appid: 1086940,
                visible: true,
                best_purchase_option: { final_price_in_cents: '139900', original_price_in_cents: '199900', discount_pct: 30 },
              },
            ],
          },
        }),
        { status: 200 },
      )
    })
    const el = await WishlistShelf({
      steamid: ME,
      row: { takenAt: NOW - 13 * 3600, closed: false, appids: [620] },
      owned: new Set(),
      now: NOW,
    })
    const html = el && isValidElement(el) ? renderToStaticMarkup(el as ReactElement) : ''
    expect(countries).toEqual(['RU'])
    expect(html).toContain('Baldur&#x27;s Gate 3')
    expect(html).toContain(`1${NB}399${NB}₽`)
  })
})
