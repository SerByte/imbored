import type { InStatement } from '@libsql/client'
import { describe, expect, test } from 'vitest'
import { createDb, getCatalogMeta, setCatalogMeta, upsertGameMeta, type Db, type GamePageRow } from './db'
import { PRICE_TRUST_SEC } from './discount'
import {
  cardRowPrint,
  DEALS_SWEPT_KEY,
  GAME_PAGE_REVALIDATE_SEC,
  gamePagePath,
  prerenderAtBuild,
  PRERENDER_TOP,
  resetSliceCards,
  revalidateEndedDeals,
  revalidateGamePages,
} from './gamecache'
import type { GameMeta } from './types'

const NOW = 1_700_000_000

describe('пререндер карточек', () => {
  test('только на продовой сборке: превью и локальная сборка не пишут ISR', () => {
    expect(prerenderAtBuild({ VERCEL_ENV: 'production' })).toBe(true)
    expect(prerenderAtBuild({ VERCEL_ENV: 'preview' })).toBe(false)
    expect(prerenderAtBuild({ VERCEL_ENV: 'development' })).toBe(false)
    expect(prerenderAtBuild({})).toBe(false)
  })

  test('верх каталога, а не пять сотен: хвост досоздаётся по требованию', () => {
    // 500 карточек по ~17 блоков ISR на КАЖДУЮ сборку — больше месячного
    // лимита Hobby при деплое раз в день. Поднять можно, но осознанно
    expect(PRERENDER_TOP).toBeLessThanOrEqual(200)
    expect(PRERENDER_TOP).toBeGreaterThan(0)
  })
})

describe('revalidateGamePages', () => {
  test('каждый адрес один раз, мусорные appid мимо, чужой магазин — тоже карточка', () => {
    const paths: string[] = []
    const n = revalidateGamePages([730, 570, 730, 0, Number.NaN, 1.5, -7], (p) => paths.push(p))
    expect(paths).toEqual(['/game/730', '/game/570', '/game/-7'])
    expect(n).toBe(3)
  })

  test('пусто — ни одного вызова: вне сервера Next настоящий сброс бросает', () => {
    expect(revalidateGamePages([], () => {
      throw new Error('не должен звать')
    })).toBe(0)
  })

  test('адрес — тот же, под которым карточку кэширует ISR', () => {
    expect(gamePagePath(730)).toBe('/game/730')
  })
})

describe('cardRowPrint', () => {
  const row = (meta: Partial<GamePageRow['meta']> = {}, rest: Partial<GamePageRow> = {}): GamePageRow => ({
    meta: { appid: 10, name: 'Игра', tags: { Action: 100 }, genres: [], categories: [], ...meta },
    reviewsSummary: { scoreDesc: 'Very Positive', totalPositive: 900, totalNegative: 100 },
    prosCons: null,
    ...rest,
  })

  test('метка замера цены сама по себе карточку не меняет', () => {
    const at = { priceFinal: 1999, priceInitial: 1999, discountPercent: 0 }
    expect(cardRowPrint(row({ ...at, priceAt: NOW }), NOW)).toBe(
      cardRowPrint(row({ ...at, priceAt: NOW - 3600 }), NOW),
    )
  })

  test('а вердикт доверия скидке — меняет: «−50%» на витрине появляется или гаснет', () => {
    const sale = { priceFinal: 999, priceInitial: 1999, discountPercent: 50 }
    expect(cardRowPrint(row({ ...sale, priceAt: NOW }), NOW)).not.toBe(
      cardRowPrint(row({ ...sale, priceAt: NOW - PRICE_TRUST_SEC - 1 }), NOW),
    )
  })

  test('скидка без срока от Steam: свежий замер — перемена, по нему страница прячет цену', () => {
    // Та же скидка, тот же вердикт, но ShownUntil на странице получает
    // priceAt + PRICE_TRUST_SEC: карточка по старому замеру погасила бы ещё
    // живую скидку раньше срока
    const sale = { priceFinal: 999, priceInitial: 1999, discountPercent: 50 }
    expect(cardRowPrint(row({ ...sale, priceAt: NOW }), NOW)).not.toBe(
      cardRowPrint(row({ ...sale, priceAt: NOW - 3600 }), NOW),
    )
  })

  test('скидка со сроком от Steam: замер не виден, новая метка — не перемена', () => {
    const sale = { priceFinal: 999, priceInitial: 1999, discountPercent: 50, discountEndsAt: NOW + 5 * 86_400 }
    expect(cardRowPrint(row({ ...sale, priceAt: NOW }), NOW)).toBe(
      cardRowPrint(row({ ...sale, priceAt: NOW - 3600 }), NOW),
    )
  })

  test('сводка отзывов и pros/cons — часть карточки', () => {
    const base = cardRowPrint(row(), NOW)
    expect(cardRowPrint(row({}, { reviewsSummary: { scoreDesc: 'Very Positive', totalPositive: 950, totalNegative: 100 } }), NOW)).not.toBe(base)
    expect(cardRowPrint(row({}, { prosCons: { pros: ['красиво'], cons: [], source: 'claude' } }), NOW)).not.toBe(base)
    expect(cardRowPrint(row({ screenshots: ['a.jpg'] }), NOW)).not.toBe(base)
  })
})

describe('resetSliceCards', () => {
  test('карточки — в сброс, в итоге звена вместо списка число', () => {
    // Итог звена runChain кладёт в *_last_slice целиком: список appid там —
    // шум в catalog_meta и в выводе health
    const paths: string[] = []
    const out = resetSliceCards({ polled: 3, hasMore: false, cards: [730, 570, 730] }, (p) => paths.push(p))
    expect(paths).toEqual(['/game/730', '/game/570'])
    expect(out).toEqual({ polled: 3, hasMore: false, сброшено: 2 })
    expect(out).not.toHaveProperty('cards')
  })
})

/**
 * Карточки, чья скидка погасла с прошлого прохода: собранные раньше, в
 * недельном кэше они обещают её в JSON-LD. База настоящая — выборка идёт по
 * idx_games_deal_until, её план сторожит lib/queryplan.test.ts.
 */
describe('revalidateEndedDeals', () => {
  const sale = (appid: number, over: Partial<GameMeta>): GameMeta => ({
    appid,
    name: `Игра ${appid}`,
    tags: {},
    genres: [],
    categories: [],
    priceFinal: 999,
    priceInitial: 1999,
    discountPercent: 50,
    ...over,
  })

  /** Граница доверия скидке без срока от Steam — замер плюс PRICE_TRUST_SEC */
  const measuredFor = (until: number) => until - PRICE_TRUST_SEC

  async function catalog(): Promise<Db> {
    const db = await createDb(':memory:')
    for (const m of [
      // доверие по замеру вышло минуту назад
      sale(10, { priceAt: measuredFor(NOW - 60) }),
      // срок назвал Steam, он прошёл полчаса назад
      sale(20, { discountEndsAt: NOW - 1800, priceAt: NOW - 3 * 86_400 }),
      // ещё действует: замер свежий, до конца доверия сутки с лишним
      sale(30, { priceAt: NOW - 3600 }),
      // погасла больше недели назад: закэшированная карточка уже перегенерирована
      sale(40, { discountEndsAt: NOW - GAME_PAGE_REVALIDATE_SEC - 3600 }),
      // без скидки: гаснуть нечему, как бы стар ни был замер
      sale(50, { discountPercent: 0, priceInitial: 999, priceAt: measuredFor(NOW - 60) }),
      // срок доверия выйдет через час — это дело следующего прохода
      sale(60, { priceAt: measuredFor(NOW + 3600) }),
    ]) {
      await upsertGameMeta(db, m, NOW - 10 * 86_400)
    }
    return db
  }

  test('первый проход — скидки, погасшие за неделю; отметка встаёт на сейчас', async () => {
    const db = await catalog()
    const paths: string[] = []
    expect(await revalidateEndedDeals(db, (p) => paths.push(p), NOW)).toBe(2)
    expect(paths.sort()).toEqual(['/game/10', '/game/20'])
    expect(await getCatalogMeta(db, DEALS_SWEPT_KEY)).toBe(String(NOW))
  })

  test('следующий проход — только окно после прошлого: те же карточки второй раз не сбрасываются', async () => {
    const db = await catalog()
    await revalidateEndedDeals(db, () => {}, NOW)
    const paths: string[] = []
    expect(await revalidateEndedDeals(db, (p) => paths.push(p), NOW + 2 * 3600)).toBe(1)
    expect(paths).toEqual(['/game/60'])
    // ничего не погасло — ни одного вызова, отметка всё равно двигается
    expect(await revalidateEndedDeals(db, () => {
      throw new Error('нечего сбрасывать')
    }, NOW + 3 * 3600)).toBe(0)
    expect(await getCatalogMeta(db, DEALS_SWEPT_KEY)).toBe(String(NOW + 3 * 3600))
  })

  test('после долгой паузы окно — не длиннее недели', async () => {
    // Килл-свитч держали месяц: карточки старше недели перегенерировались
    // сами, и сбрасывать скидки всего месяца незачем
    const db = await catalog()
    await setCatalogMeta(db, DEALS_SWEPT_KEY, String(NOW - 30 * 86_400))
    const paths: string[] = []
    await revalidateEndedDeals(db, (p) => paths.push(p), NOW)
    expect(paths.sort()).toEqual(['/game/10', '/game/20'])
  })

  test('чтение упало — отметка на месте, окно достанется следующему запуску', async () => {
    const db = await catalog()
    await setCatalogMeta(db, DEALS_SWEPT_KEY, String(NOW - 86_400))
    // Проходу хватает execute: отметка и выборка — по одному запросу
    const broken = {
      execute: (q: InStatement) => {
        const sql = typeof q === 'string' ? q : q.sql
        if (sql.includes('discount_percent > 0')) throw new Error('Turso моргнул')
        return db.execute(q)
      },
    } as unknown as Db
    await expect(revalidateEndedDeals(broken, () => {}, NOW)).rejects.toThrow('Turso моргнул')
    expect(await getCatalogMeta(db, DEALS_SWEPT_KEY)).toBe(String(NOW - 86_400))

    const paths: string[] = []
    await revalidateEndedDeals(db, (p) => paths.push(p), NOW + 60)
    expect(paths.sort()).toEqual(['/game/10', '/game/20'])
  })
})
