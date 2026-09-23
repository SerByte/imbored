import { describe, expect, test } from 'vitest'
import {
  CCU_FRESH_SEC,
  parseStoreReviews,
  refreshCatalogSignals,
  SIGNALS_MAX_AGE_SEC,
  type StoreReviews,
} from './catalogsignals'
import { createDb, getGameMeta, upsertGameMeta, type Db } from './db'

const NOW = 1_790_000_000
/** Срок звена: заведомо в будущем — время в этих тестах не кончается */
const FAR = Date.now() + 60_000

/**
 * Ответ GetItems с include_reviews — снят с живого Steam 23.09.2026 и урезан до
 * нужного. Категории и блок покупки приходят и без их include-флагов.
 */
const LIVE = {
  response: {
    store_items: [
      {
        item_type: 0,
        id: 730,
        success: 1,
        visible: true,
        name: 'Counter-Strike 2',
        appid: 730,
        is_free: true,
        categories: { supported_player_categoryids: [1, 27] },
        reviews: {
          summary_filtered: { review_count: 9878407, percent_positive: 85, review_score: 8, review_score_label: 'Very Positive' },
          summary_language_specific: { review_count: 2620088, percent_positive: 85, review_score: 8, review_score_label: 'Very Positive' },
        },
      },
      {
        item_type: 0,
        id: 570,
        success: 1,
        visible: true,
        name: 'Dota 2',
        appid: 570,
        reviews: {
          summary_filtered: { review_count: 2784988, percent_positive: 80 },
          summary_language_specific: { review_count: 839557, percent_positive: 87 },
        },
      },
      // снята с продажи: Steam отвечает, но без имени и отзывов
      { item_type: 0, id: 9999999, success: 2, visible: false },
      // отзывов на языке запроса нет вовсе
      { item_type: 0, id: 1234, appid: 1234, success: 1, visible: true, reviews: { summary_filtered: { review_count: 12, percent_positive: 90 } } },
      // ноль — сбой ответа, а не новость
      { id: 4321, appid: 4321, visible: true, reviews: { summary_language_specific: { review_count: 0, percent_positive: 0 } } },
    ],
  },
}

describe('parseStoreReviews', () => {
  test('берёт англоязычную шкалу — ту же, что у посева каталога', () => {
    const got = parseStoreReviews(LIVE)
    // у CS2 в каталоге 2 593 099 — это язык, а не все 9 878 407
    expect(got.get(730)).toEqual({ total: 2620088, percent: 85 })
    expect(got.get(570)).toEqual({ total: 839557, percent: 87 })
  })

  test('игра в ответе без отзывов на языке — null, ноль — тоже null', () => {
    const got = parseStoreReviews(LIVE)
    expect(got.get(9999999)).toBeNull()
    expect(got.get(1234)).toBeNull()
    expect(got.get(4321)).toBeNull()
  })

  test('мусор вместо ответа — пустая карта, а не исключение', () => {
    expect(parseStoreReviews(null).size).toBe(0)
    expect(parseStoreReviews({ response: {} }).size).toBe(0)
    expect(parseStoreReviews({ response: { store_items: [{ reviews: {} }] } }).size).toBe(0)
  })
})

type Row = {
  reviews_total: number | null
  reviews_percent: number | null
  reviews_at: number | null
  ccu: number | null
  ccu_at: number | null
  updated_at: number
  alive: number
  signals_at: number | null
}

async function row(db: Db, appid: number): Promise<Row> {
  const r = await db.execute({
    sql: `SELECT reviews_total, reviews_percent, reviews_at, ccu, ccu_at, updated_at, alive, signals_at
          FROM games WHERE appid = ?`,
    args: [appid],
  })
  return r.rows[0] as unknown as Row
}

/** Игра пула: с тегами, живая; совместная — с категорией 1 */
async function pool(db: Db, appid: number, reviewsTotal: number, multiplayer = false) {
  await upsertGameMeta(
    db,
    {
      appid,
      name: `Игра ${appid}`,
      tags: { Action: 100 },
      genres: [],
      categories: multiplayer ? [1] : [2],
      reviewsTotal,
      reviewsPercent: 90,
    },
    NOW - 30 * 86_400,
  )
}

/** Стаб отзывов: одинаковый ответ на любой appid, с журналом вызовов */
function reviewsStub(answer: (appid: number) => StoreReviews | null | undefined) {
  const calls: number[][] = []
  const fn = async (appids: number[]) => {
    calls.push(appids)
    const out = new Map<number, StoreReviews | null>()
    for (const id of appids) {
      const a = answer(id)
      if (a !== undefined) out.set(id, a)
    }
    return out
  }
  return { fn, calls }
}

describe('refreshCatalogSignals', () => {
  test('отзывы и онлайн обновляются узко: updated_at, alive и signals_at не трогаются', async () => {
    const db = await createDb(':memory:')
    await pool(db, 730, 2_593_099, true)
    await pool(db, 620, 172_902)
    await db.execute({ sql: 'UPDATE games SET signals_at = ? WHERE appid = 730', args: [NOW - 40 * 86_400] })
    const before = await row(db, 730)

    const reviews = reviewsStub((id) => ({ total: id * 1000, percent: 81 }))
    const polled: number[] = []
    const r = await refreshCatalogSignals(db, {
      deadlineAt: FAR,
      nowSec: NOW,
      fetchReviews: reviews.fn,
      fetchPlayers: async (appid) => {
        polled.push(appid)
        return 812_000
      },
    })

    expect(r).toEqual({ checked: 2, reviews: 2, ccu: 1, stopped: 'done' })
    const cs = await row(db, 730)
    expect(cs).toMatchObject({ reviews_total: 730_000, reviews_percent: 81, reviews_at: NOW, ccu: 812_000, ccu_at: NOW })
    expect(cs.updated_at).toBe(before.updated_at)
    expect(cs.alive).toBe(1)
    expect(cs.signals_at).toBe(NOW - 40 * 86_400)
    // онлайн меряем только у совместных — живость гейтит только их
    expect(polled).toEqual([730])
    expect((await row(db, 620)).ccu).toBeNull()
    // и meta видит новое число — на нём стоят сниппет /game и порядок пула
    expect((await getGameMeta(db, 730))?.reviewsTotal).toBe(730_000)
  })

  test('сверенные на этой неделе не спрашиваются, неделю спустя — снова', async () => {
    const db = await createDb(':memory:')
    await pool(db, 730, 100, true)
    const reviews = reviewsStub(() => ({ total: 200, percent: 80 }))
    const opts = { deadlineAt: FAR, fetchReviews: reviews.fn, fetchPlayers: async () => 10 }

    await refreshCatalogSignals(db, { ...opts, nowSec: NOW })
    const again = await refreshCatalogSignals(db, { ...opts, nowSec: NOW + 86_400 })
    expect(again).toEqual({ checked: 0, reviews: 0, ccu: 0, stopped: 'done' })
    expect(reviews.calls).toHaveLength(1)

    await refreshCatalogSignals(db, { ...opts, nowSec: NOW + SIGNALS_MAX_AGE_SEC + 1 })
    expect(reviews.calls).toHaveLength(2)
  })

  test('очередь: сперва ни разу не сверенные, среди них — верх каталога', async () => {
    const db = await createDb(':memory:')
    await pool(db, 1, 50)
    await pool(db, 2, 5000)
    await pool(db, 3, 900)
    await pool(db, 4, 70_000)
    // четвёртую уже сверили — пусть и давно, она после всех несверенных
    await db.execute({ sql: 'UPDATE games SET reviews_at = ? WHERE appid = 4', args: [NOW - 30 * 86_400] })

    const reviews = reviewsStub(() => ({ total: 1000, percent: 90 }))
    const r = await refreshCatalogSignals(db, {
      deadlineAt: FAR,
      nowSec: NOW,
      batchSize: 2,
      maxBatches: 1,
      fetchReviews: reviews.fn,
    })
    expect(reviews.calls).toEqual([[2, 3]])
    // потолок пачек выбран, а устаревшие остались — звено передаст работу дальше
    expect(r.stopped).toBe('budget')

    await refreshCatalogSignals(db, { deadlineAt: FAR, nowSec: NOW, batchSize: 2, fetchReviews: reviews.fn })
    expect(reviews.calls.slice(1)).toEqual([[1, 4]])
  })

  test('про кого Steam промолчал — отметка без чисел, чтобы не стоять в голове очереди вечно', async () => {
    const db = await createDb(':memory:')
    await pool(db, 730, 2_593_099)
    await pool(db, 9_999_999, 400)
    const reviews = reviewsStub((id) => (id === 730 ? { total: 2_620_088, percent: 85 } : undefined))

    const r = await refreshCatalogSignals(db, { deadlineAt: FAR, nowSec: NOW, fetchReviews: reviews.fn })
    expect(r).toMatchObject({ checked: 2, reviews: 1 })
    expect(await row(db, 9_999_999)).toMatchObject({ reviews_total: 400, reviews_at: NOW })
  })

  test('отказ отзывов — ничего не пишем, пачка остаётся первой в очереди', async () => {
    const db = await createDb(':memory:')
    await pool(db, 730, 100, true)
    let players = 0
    const r = await refreshCatalogSignals(db, {
      deadlineAt: FAR,
      nowSec: NOW,
      fetchReviews: async () => {
        throw new Error('GetItems: HTTP 429')
      },
      fetchPlayers: async () => {
        players++
        return 5
      },
    })
    expect(r).toEqual({ checked: 0, reviews: 0, ccu: 0, stopped: 'blocked' })
    expect(players).toBe(0)
    expect((await row(db, 730)).reviews_at).toBeNull()
  })

  test('онлайн, только что снятый прогревом, не перемеряется', async () => {
    const db = await createDb(':memory:')
    await pool(db, 1, 100, true)
    await pool(db, 2, 90, true)
    await db.execute({
      sql: 'UPDATE games SET ccu = 7, ccu_at = ? WHERE appid = 1',
      args: [NOW - CCU_FRESH_SEC + 60],
    })
    const polled: number[] = []
    await refreshCatalogSignals(db, {
      deadlineAt: FAR,
      nowSec: NOW,
      fetchReviews: reviewsStub(() => null).fn,
      fetchPlayers: async (appid) => {
        polled.push(appid)
        return 3
      },
    })
    expect(polled).toEqual([2])
    expect((await row(db, 1)).ccu).toBe(7)
  })

  test('серия отказов онлайна — отзывы и отметки пишутся, звено встаёт', async () => {
    const db = await createDb(':memory:')
    for (let i = 1; i <= 5; i++) await pool(db, i, 1000 - i, true)
    const r = await refreshCatalogSignals(db, {
      deadlineAt: FAR,
      nowSec: NOW,
      batchSize: 5,
      fetchReviews: reviewsStub(() => ({ total: 500, percent: 70 })).fn,
      fetchPlayers: async () => {
        throw new Error('players: HTTP 429')
      },
    })
    expect(r).toMatchObject({ checked: 5, reviews: 5, ccu: 0, stopped: 'blocked' })
    expect(await row(db, 3)).toMatchObject({ reviews_total: 500, reviews_at: NOW, ccu: null })
  })

  test('срок звена вышел — в Steam не ходим вовсе', async () => {
    const db = await createDb(':memory:')
    await pool(db, 730, 100)
    const reviews = reviewsStub(() => ({ total: 1, percent: 1 }))
    const r = await refreshCatalogSignals(db, {
      deadlineAt: Date.now() - 1,
      nowSec: NOW,
      fetchReviews: reviews.fn,
    })
    expect(r.stopped).toBe('budget')
    expect(reviews.calls).toEqual([])
  })

  test('мёртвые и вытесненные в очередь не попадают: их судьба — дело промоута', async () => {
    const db = await createDb(':memory:')
    await pool(db, 1, 100)
    await pool(db, 2, 90)
    await pool(db, 3, 80)
    await db.execute('UPDATE games SET alive = 0 WHERE appid = 2')
    await db.execute('UPDATE games SET superseded_by = 1 WHERE appid = 3')
    const reviews = reviewsStub(() => ({ total: 1000, percent: 90 }))
    await refreshCatalogSignals(db, { deadlineAt: FAR, nowSec: NOW, fetchReviews: reviews.fn })
    expect(reviews.calls).toEqual([[1]])
  })
})
