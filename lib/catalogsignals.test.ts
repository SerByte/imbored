import { describe, expect, test, vi } from 'vitest'
import {
  CCU_FRESH_SEC,
  fetchStoreReviews,
  parseStoreReviews,
  PULSE_MAX_AGE_SEC,
  PULSE_PER_LINK,
  refreshCatalogSignals,
  refreshReviewPulse,
  SIGNALS_MAX_AGE_SEC,
  type StoreReviews,
} from './catalogsignals'
import {
  createDb,
  getGameMeta,
  reviewPulseQueue,
  updateGamePrices,
  upsertGameMeta,
  type Db,
  type PriceQuote,
} from './db'
import { trustedPrice } from './discount'

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
  test('пара — англоязычная шкала, та же, что у посева каталога', () => {
    const got = parseStoreReviews(LIVE)
    // у CS2 в каталоге 2 593 099 — это язык, а не все 9 878 407
    expect(got.get(730)).toMatchObject({ total: 2620088, percent: 85 })
    expect(got.get(570)).toMatchObject({ total: 839557, percent: 87 })
  })

  /*
   * Все языки — рядом, из того же ответа: их показывают людям (shownReviews).
   * Англоязычные на плитке хаба давали Isaac «из 165 тыс.» при 459 857 на
   * его карточке. Оценка словами — той же сводки, и только кодом Steam.
   */
  test('все языки с оценкой Steam — полем all, без лишнего запроса', () => {
    const got = parseStoreReviews(LIVE)
    expect(got.get(730)).toEqual({
      total: 2620088,
      percent: 85,
      all: { total: 9878407, percent: 85, score: 8 },
    })
    // без review_score — оценки нет, числа есть
    expect(got.get(570)?.all).toEqual({ total: 2784988, percent: 80, score: null })
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

/**
 * Разбор прощает мусор, а запрос — нет: 200 с пустым response и кодом сбоя в
 * X-eresult (см. fetchWishlist в lib/steam.ts) прочитался бы как «Steam
 * промолчал про всех», и пачка получила бы отметку сверки без чисел — на
 * неделю мимо очереди. Исключение же сверка уже умеет: blocked, без отметок.
 */
describe('fetchStoreReviews', () => {
  test('200 с пустым response и X-eresult — исключение', async () => {
    const fail = (async () =>
      new Response(JSON.stringify({ response: {} }), { status: 200, headers: { 'x-eresult': '2' } })) as unknown as typeof fetch
    await expect(fetchStoreReviews([730], fail)).rejects.toThrow('eresult 2')
  })

  test('без заголовка, но и без store_items — тоже исключение', async () => {
    const empty = (async () => new Response(JSON.stringify({ response: {} }), { status: 200 })) as unknown as typeof fetch
    await expect(fetchStoreReviews([730], empty)).rejects.toThrow('store_items')
  })

  test('пустой список — ответ «Steam промолчал про всех», а не сбой: пустая карта', async () => {
    // Сочти его сбоем — пачка из снятых с продажи вечно стояла бы в голове
    // очереди (reviews_at NULL идёт первым), и каждое звено кончалось бы
    // blocked на ней же. Отметку молчавшим ставит updateCatalogSignals.
    const none = (async () =>
      new Response(JSON.stringify({ response: { store_items: [] } }), { status: 200 })) as unknown as typeof fetch
    expect(await fetchStoreReviews([730], none)).toEqual(new Map())
    expect(await fetchStoreReviews([730, 570], none)).toEqual(new Map())
  })

  test('настоящий ответ разбирается как прежде', async () => {
    const live = (async () => new Response(JSON.stringify(LIVE), { status: 200, headers: { 'x-eresult': '1' } })) as unknown as typeof fetch
    expect((await fetchStoreReviews([730], live)).get(730)).toMatchObject({ total: 2620088, percent: 85 })
  })

  /**
   * Русские отзывы — вторым GetItems той же пачки в русском контексте: там
   * summary_language_specific — отзывы на русском. Одна пачка из двухсот на
   * api.steampowered.com, а не двести походов в магазин.
   */
  function storeByLanguage(ru: () => Response) {
    const asked: string[] = []
    const fn = (async (url: string) => {
      const lang = JSON.parse(new URL(url).searchParams.get('input_json')!).context.language as string
      asked.push(lang)
      return lang === 'russian' ? ru() : new Response(JSON.stringify(LIVE), { status: 200 })
    }) as unknown as typeof fetch
    return { fn, asked }
  }
  /** Ответ в русском контексте — синтетический, той же формы, что LIVE */
  const RU = {
    response: {
      store_items: [
        { appid: 730, reviews: { summary_language_specific: { review_count: 1_402_311, percent_positive: 83 } } },
        // на русском отзывов нет — записывать нечего
        { appid: 570, reviews: { summary_filtered: { review_count: 2784988, percent_positive: 80 } } },
      ],
    },
  }

  test('русские — вторым запросом в русском контексте, только тем, у кого сверка есть', async () => {
    const store = storeByLanguage(() => new Response(JSON.stringify(RU), { status: 200 }))
    const got = await fetchStoreReviews([730, 570, 1234], store.fn)
    expect(store.asked).toEqual(['english', 'russian'])
    expect(got.get(730)?.ru).toEqual({ total: 1_402_311, percent: 83 })
    expect(got.get(570)).not.toHaveProperty('ru')
    expect(got.get(1234)).toBeNull()
  })

  test('отказ русского запроса — пачка без русских, а не без сверки', async () => {
    const store = storeByLanguage(() => new Response('', { status: 429 }))
    const got = await fetchStoreReviews([730], store.fn)
    expect(got.get(730)).toMatchObject({ total: 2620088, all: { total: 9878407 } })
    expect(got.get(730)).not.toHaveProperty('ru')
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

/**
 * Цены в тестах сверки — стабом всегда: без него звено ушло бы за ними в
 * настоящий Steam. Тесты цен ниже подставляют свой
 */
const noPrices = async (): Promise<PriceQuote[]> => []

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
    const r = await refreshCatalogSignals(db, { fetchPrices: noPrices,
      deadlineAt: FAR,
      nowSec: NOW,
      fetchReviews: reviews.fn,
      fetchPlayers: async (appid) => {
        polled.push(appid)
        return 812_000
      },
    })

    expect(r).toEqual({ checked: 2, reviews: 2, ccu: 1, prices: 0, hidden: 0, stopped: 'done' })
    const cs = await row(db, 730)
    expect(cs).toMatchObject({ reviews_total: 730_000, reviews_percent: 81, reviews_at: NOW, ccu: 812_000, ccu_at: NOW })
    expect(cs.updated_at).toBe(before.updated_at)
    expect(cs.alive).toBe(1)
    expect(cs.signals_at).toBe(NOW - 40 * 86_400)
    // онлайн меряем только у совместных — живость гейтит только их
    expect(polled).toEqual([730])
    expect((await row(db, 620)).ccu).toBeNull()
    // и meta видит новое число — на нём стоят пороги живости и порядок пула
    // (сниппет /game с этой правки берёт все языки — shownReviews)
    expect((await getGameMeta(db, 730))?.reviewsTotal).toBe(730_000)
  })

  test('сверенные на этой неделе не спрашиваются, неделю спустя — снова', async () => {
    const db = await createDb(':memory:')
    await pool(db, 730, 100, true)
    const reviews = reviewsStub(() => ({ total: 200, percent: 80 }))
    const opts = { deadlineAt: FAR, fetchReviews: reviews.fn, fetchPlayers: async () => 10 }

    await refreshCatalogSignals(db, { fetchPrices: noPrices, ...opts, nowSec: NOW })
    const again = await refreshCatalogSignals(db, { fetchPrices: noPrices, ...opts, nowSec: NOW + 86_400 })
    expect(again).toEqual({ checked: 0, reviews: 0, ccu: 0, prices: 0, hidden: 0, stopped: 'done' })
    expect(reviews.calls).toHaveLength(1)

    await refreshCatalogSignals(db, { fetchPrices: noPrices, ...opts, nowSec: NOW + SIGNALS_MAX_AGE_SEC + 1 })
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
    const r = await refreshCatalogSignals(db, { fetchPrices: noPrices,
      deadlineAt: FAR,
      nowSec: NOW,
      batchSize: 2,
      maxBatches: 1,
      fetchReviews: reviews.fn,
    })
    expect(reviews.calls).toEqual([[2, 3]])
    // потолок пачек выбран, а устаревшие остались — звено передаст работу дальше
    expect(r.stopped).toBe('budget')

    await refreshCatalogSignals(db, { fetchPrices: noPrices, deadlineAt: FAR, nowSec: NOW, batchSize: 2, fetchReviews: reviews.fn })
    expect(reviews.calls.slice(1)).toEqual([[1, 4]])
  })

  test('про кого Steam промолчал — отметка без чисел, чтобы не стоять в голове очереди вечно', async () => {
    const db = await createDb(':memory:')
    await pool(db, 730, 2_593_099)
    await pool(db, 9_999_999, 400)
    const reviews = reviewsStub((id) => (id === 730 ? { total: 2_620_088, percent: 85 } : undefined))

    const r = await refreshCatalogSignals(db, { fetchPrices: noPrices, deadlineAt: FAR, nowSec: NOW, fetchReviews: reviews.fn })
    expect(r).toMatchObject({ checked: 2, reviews: 1 })
    expect(await row(db, 9_999_999)).toMatchObject({ reviews_total: 400, reviews_at: NOW })
  })

  test('отказ отзывов — ничего не пишем, пачка остаётся первой в очереди', async () => {
    const db = await createDb(':memory:')
    await pool(db, 730, 100, true)
    let players = 0
    const r = await refreshCatalogSignals(db, { fetchPrices: noPrices,
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
    expect(r).toEqual({ checked: 0, reviews: 0, ccu: 0, prices: 0, hidden: 0, stopped: 'blocked' })
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
    await refreshCatalogSignals(db, { fetchPrices: noPrices,
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
    const r = await refreshCatalogSignals(db, { fetchPrices: noPrices,
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
    const r = await refreshCatalogSignals(db, { fetchPrices: noPrices,
      deadlineAt: Date.now() - 1,
      nowSec: NOW,
      fetchReviews: reviews.fn,
    })
    expect(r.stopped).toBe('budget')
    expect(reviews.calls).toEqual([])
  })

  /*
   * Все языки и русские — отзывы для людей: их читают кольцо /game, хабы и
   * /play (shownReviews). Пишутся рядом с англоязычной шкалой порогов, но
   * переписываются, только когда показанное число сдвинулось на 2% или
   * поменялась доля: кольцо печатает число до единицы, и еженедельная
   * прибавка в десяток отзывов иначе делала бы каждую перегенерацию карточки
   * новой страницей — записью ISR.
   */
  test('все языки и русские пишутся рядом с англоязычными — и не дёргаются от мелочи', async () => {
    const db = await createDb(':memory:')
    await pool(db, 1145360, 142_000)
    const answer = (allTotal: number, allPercent: number, ruTotal: number) =>
      reviewsStub(() => ({
        total: 142_783,
        percent: 98,
        all: { total: allTotal, percent: allPercent, score: 9 },
        ru: { total: ruTotal, percent: 96 },
      })).fn
    const shown = async () => {
      const m = (await getGameMeta(db, 1145360))!
      return [m.reviewsAllTotal, m.reviewsAllPercent, m.reviewsAllScore, m.reviewsRuTotal, m.reviewsRuPercent]
    }

    await refreshCatalogSignals(db, { fetchPrices: noPrices, deadlineAt: FAR, nowSec: NOW, fetchReviews: answer(286_667, 97, 16_893) })
    expect(await shown()).toEqual([286_667, 97, 9, 16_893, 96])
    // англоязычная шкала порогов — своими колонками, как прежде
    expect(await row(db, 1145360)).toMatchObject({ reviews_total: 142_783, reviews_percent: 98 })

    // Неделя: +1 500 отзывов (0,5%) и +40 русских — показанное не трогаем
    const week = NOW + SIGNALS_MAX_AGE_SEC + 1
    await refreshCatalogSignals(db, { fetchPrices: noPrices, deadlineAt: FAR, nowSec: week, fetchReviews: answer(288_167, 97, 16_933) })
    expect(await shown()).toEqual([286_667, 97, 9, 16_893, 96])

    // Доля сдвинулась — переписываем сразу; 2% набежало — тоже
    const later = week + SIGNALS_MAX_AGE_SEC + 1
    await refreshCatalogSignals(db, { fetchPrices: noPrices, deadlineAt: FAR, nowSec: later, fetchReviews: answer(289_000, 96, 17_300) })
    expect(await shown()).toEqual([289_000, 96, 9, 17_300, 96])
  })

  test('мёртвые и вытесненные в очередь не попадают: их судьба — дело промоута', async () => {
    const db = await createDb(':memory:')
    await pool(db, 1, 100)
    await pool(db, 2, 90)
    await pool(db, 3, 80)
    await db.execute('UPDATE games SET alive = 0 WHERE appid = 2')
    await db.execute('UPDATE games SET superseded_by = 1 WHERE appid = 3')
    const reviews = reviewsStub(() => ({ total: 1000, percent: 90 }))
    await refreshCatalogSignals(db, { fetchPrices: noPrices, deadlineAt: FAR, nowSec: NOW, fetchReviews: reviews.fn })
    expect(reviews.calls).toEqual([[1]])
  })
})

/**
 * Цены пула — тем же звеном: единственный крон, который обходит весь пул,
 * переоценивает его за неделю после смены STEAM_STORE_CC. Без этого у
 * переоценки каталога не было бы срока — только заходы людей. Но только то,
 * у чего цены своего региона нет (включая «не продаётся»): еженедельный
 * замер всего пула тратил бы бюджет ISR на конце каждой скидки
 * (revalidateEndedDeals).
 */
describe('refreshCatalogSignals: цены пачки', () => {
  async function price(db: Db, appid: number) {
    const r = await db.execute({
      sql: 'SELECT price_final, price_cc, store_hidden, price_at, reviews_at FROM games WHERE appid = ?',
      args: [appid],
    })
    return r.rows[0]
  }

  test('цены пачки пишутся в регионе цен; «не продаётся» считается отдельно', async () => {
    const db = await createDb(':memory:')
    await pool(db, 1086940, 900_000)
    await pool(db, 1091500, 800_000)
    const asked: Array<{ ids: number[]; cc: string }> = []
    vi.stubEnv('STEAM_STORE_CC', 'ru')
    try {
      const r = await refreshCatalogSignals(db, {
        deadlineAt: FAR,
        nowSec: NOW,
        fetchReviews: reviewsStub(() => ({ total: 1000, percent: 90 })).fn,
        fetchPrices: async (ids, cc) => {
          asked.push({ ids, cc })
          return [
            { appid: 1086940, priceFinal: 199_900, priceInitial: 199_900, discountPercent: 0 },
            // Cyberpunk 2077 в российском Steam — visible:false
            { appid: 1091500, hidden: true },
          ]
        },
      })
      expect(asked).toEqual([{ ids: [1086940, 1091500], cc: 'ru' }])
      expect(r).toMatchObject({ checked: 2, prices: 2, hidden: 1, stopped: 'done' })
      expect(await price(db, 1086940)).toMatchObject({ price_final: 199_900, price_cc: 'ru', store_hidden: 0, price_at: NOW })
      expect(await price(db, 1091500)).toMatchObject({ price_final: null, price_cc: 'ru', store_hidden: 1, price_at: NOW })
      // и витрина видит рубли: регион строки совпал с регионом цен
      expect((await getGameMeta(db, 1086940))?.priceFinal).toBe(199_900)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  test('отказ цен не мешает отзывам: отметки и числа пишутся, цены — нет', async () => {
    const db = await createDb(':memory:')
    await pool(db, 730, 100)
    const r = await refreshCatalogSignals(db, {
      deadlineAt: FAR,
      nowSec: NOW,
      fetchReviews: reviewsStub(() => ({ total: 2000, percent: 88 })).fn,
      fetchPrices: async () => {
        throw new Error('GetItems: HTTP 429')
      },
    })
    expect(r).toMatchObject({ checked: 1, reviews: 1, prices: 0, hidden: 0, stopped: 'done' })
    expect(await row(db, 730)).toMatchObject({ reviews_total: 2000, reviews_at: NOW })
    expect(await price(db, 730)).toMatchObject({ price_at: null })
  })

  test('за ценами идут до опроса онлайна: он сам встаёт по сроку звена, запрос цен — нет', async () => {
    const db = await createDb(':memory:')
    await pool(db, 1, 100, true)
    const order: string[] = []
    await refreshCatalogSignals(db, {
      deadlineAt: FAR,
      nowSec: NOW,
      fetchReviews: async (ids) => {
        order.push('reviews')
        return new Map(ids.map((id) => [id, { total: 1, percent: 1 }]))
      },
      fetchPrices: async () => {
        order.push('prices')
        return []
      },
      fetchPlayers: async () => {
        order.push('ccu')
        return 5
      },
    })
    expect(order).toEqual(['reviews', 'prices', 'ccu'])
  })

  /** Котировка «цена как была»: для тестов, где важно, кого спросили, а не что ответили */
  const quoteAll = (asked: number[][]) => async (ids: number[]) => {
    asked.push(ids)
    return ids.map((appid) => ({ appid, priceFinal: 99_900, priceInitial: 99_900, discountPercent: 0 }))
  }

  test('переснимаются только игры без цены своего региона: ни разу не мерянные и чужие', async () => {
    const db = await createDb(':memory:')
    for (const id of [1, 2, 3, 4]) await pool(db, id, 1000 - id)
    const q = (appid: number) => ({ appid, priceFinal: 5999, priceInitial: 5999, discountPercent: 0 })
    // 1 — цены не было никогда; 2 — доллары до смены региона, вчерашние;
    // 3 — рубли, вчерашние; 4 — рубли месячной давности
    await updateGamePrices(db, [q(2)], NOW - 86_400, 'us')
    await updateGamePrices(db, [q(3)], NOW - 86_400, 'ru')
    await updateGamePrices(db, [q(4)], NOW - 30 * 86_400, 'ru')
    vi.stubEnv('STEAM_STORE_CC', 'ru')
    try {
      const asked: number[][] = []
      const r = await refreshCatalogSignals(db, {
        deadlineAt: FAR,
        nowSec: NOW,
        fetchReviews: reviewsStub(() => ({ total: 1000, percent: 90 })).fn,
        fetchPrices: quoteAll(asked),
      })
      // сперва та, у которой цены не было никогда
      expect(asked).toEqual([[1, 2]])
      expect(r).toMatchObject({ checked: 4, prices: 2, stopped: 'done' })
      expect(await price(db, 1)).toMatchObject({ price_cc: 'ru', price_at: NOW })
      expect(await price(db, 2)).toMatchObject({ price_final: 99_900, price_cc: 'ru', price_at: NOW })
      // своя цена, даже давняя, не переснимается: её скидка, записанная
      // доверенным замером, сбросила бы карточку по своему концу
      expect(await price(db, 3)).toMatchObject({ price_final: 5999, price_at: NOW - 86_400 })
      expect(await price(db, 4)).toMatchObject({ price_final: 5999, price_at: NOW - 30 * 86_400 })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  test('«не продаётся» своего региона переснимается каждым кругом: отметка не вечная', async () => {
    // Скрытую игру подбор покупкой не предлагает, и заход человека её не
    // переснимет: кроме сверки, снять однажды пойманный visible:false некому
    const db = await createDb(':memory:')
    for (const id of [1, 2, 3]) await pool(db, id, 1000 - id)
    const q = (appid: number) => ({ appid, priceFinal: 1999, priceInitial: 1999, discountPercent: 0 })
    // 1 и 3 — «не продаётся» месячной давности; 2 — обычная рублёвая цена
    await updateGamePrices(db, [{ appid: 1, hidden: true }, { appid: 3, hidden: true }], NOW - 30 * 86_400, 'ru')
    await updateGamePrices(db, [q(2)], NOW - 30 * 86_400, 'ru')
    // 1 магазин снова показывает, 3 по-прежнему прячет
    const store = (asked: number[][]) => async (ids: number[]): Promise<PriceQuote[]> => {
      asked.push(ids)
      return ids.map((appid) => (appid === 3 ? { appid, hidden: true } : { ...q(appid), priceFinal: 99_900 }))
    }
    vi.stubEnv('STEAM_STORE_CC', 'ru')
    try {
      const asked: number[][] = []
      const r = await refreshCatalogSignals(db, {
        deadlineAt: FAR,
        nowSec: NOW,
        fetchReviews: reviewsStub(() => ({ total: 1000, percent: 90 })).fn,
        fetchPrices: store(asked),
      })
      // порядок внутри пачки не важен: обе замерены в один момент
      expect(asked.map((ids) => [...ids].sort((a, b) => a - b))).toEqual([[1, 3]])
      expect(r).toMatchObject({ checked: 3, prices: 2, hidden: 1, stopped: 'done' })
      expect(await price(db, 1)).toMatchObject({ price_final: 99_900, price_cc: 'ru', store_hidden: 0, price_at: NOW })
      expect((await getGameMeta(db, 1))?.storeHidden).toBeUndefined()
      expect(await price(db, 3)).toMatchObject({ price_final: null, store_hidden: 1, price_at: NOW })
      // своя цена по-прежнему не переснимается
      expect(await price(db, 2)).toMatchObject({ price_final: 1999, price_at: NOW - 30 * 86_400 })

      // Неделю спустя — снова только та, что осталась скрытой: вернувшаяся в
      // продажу теперь со своей ценой и живёт по заходам людей
      const later: number[][] = []
      const again = await refreshCatalogSignals(db, {
        deadlineAt: FAR,
        nowSec: NOW + SIGNALS_MAX_AGE_SEC + 1,
        fetchReviews: reviewsStub(() => ({ total: 1000, percent: 90 })).fn,
        fetchPrices: store(later),
      })
      expect(later).toEqual([[3]])
      expect(again).toMatchObject({ checked: 3, prices: 1, hidden: 1 })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  /*
   * Исключение из «свою цену не переснимаем»: погасшая распродажа. Витрина
   * такую цену прячет (trustedPrice), и без сверки она стояла бы спрятанной,
   * пока до игры не дойдёт заход человека, — у Hades неделями. Переснимается
   * только она: живая скидка и обычная цена, даже давние, остаются как были.
   */
  test('погасшая распродажа своего региона переснимается, живая скидка и обычная цена — нет', async () => {
    const db = await createDb(':memory:')
    for (const id of [1, 2, 3]) await pool(db, id, 1000 - id)
    const sale = { priceFinal: 1499, priceInitial: 2499, discountPercent: 40 }
    // 1 — распродажа кончилась вчера; 2 — идёт ещё неделю; 3 — обычная цена месячной давности
    await updateGamePrices(db, [{ appid: 1, ...sale, discountEndsAt: NOW - 86_400 }], NOW - 10 * 86_400, 'us')
    await updateGamePrices(db, [{ appid: 2, ...sale, discountEndsAt: NOW + 7 * 86_400 }], NOW - 10 * 86_400, 'us')
    await updateGamePrices(
      db,
      [{ appid: 3, priceFinal: 2499, priceInitial: 2499, discountPercent: 0 }],
      NOW - 30 * 86_400,
      'us',
    )
    expect((await getGameMeta(db, 1))?.priceFinal).toBe(1499)
    vi.stubEnv('STEAM_STORE_CC', 'us')
    try {
      const asked: number[][] = []
      const r = await refreshCatalogSignals(db, {
        deadlineAt: FAR,
        nowSec: NOW,
        fetchReviews: reviewsStub(() => ({ total: 1000, percent: 90 })).fn,
        fetchPrices: async (ids) => {
          asked.push(ids)
          // Steam: распродажа кончилась, цена обычная
          return ids.map((appid) => ({ appid, priceFinal: 2499, priceInitial: 2499, discountPercent: 0 }))
        },
      })
      expect(asked).toEqual([[1]])
      expect(r).toMatchObject({ checked: 3, prices: 1 })
      expect(await price(db, 1)).toMatchObject({ price_final: 2499, price_at: NOW })
      // и витрина снова её показывает
      const meta = (await getGameMeta(db, 1))!
      expect(trustedPrice(meta, NOW)).toBe(2499)
      expect(await price(db, 2)).toMatchObject({ price_final: 1499, price_at: NOW - 10 * 86_400 })
      expect(await price(db, 3)).toMatchObject({ price_final: 2499, price_at: NOW - 30 * 86_400 })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  test('при постоянном регионе и замеренном пуле сверка в цены не ходит вовсе', async () => {
    const db = await createDb(':memory:')
    for (const id of [1, 2]) await pool(db, id, 100)
    const q = (appid: number) => ({ appid, priceFinal: 1999, priceInitial: 1999, discountPercent: 0 })
    await updateGamePrices(db, [q(1), q(2)], NOW - 60 * 86_400, 'us')
    vi.stubEnv('STEAM_STORE_CC', 'us')
    try {
      const asked: number[][] = []
      const r = await refreshCatalogSignals(db, {
        deadlineAt: FAR,
        nowSec: NOW,
        fetchReviews: reviewsStub(() => ({ total: 1000, percent: 90 })).fn,
        fetchPrices: quoteAll(asked),
      })
      expect(asked).toEqual([])
      // отзывы и отметки — как всегда
      expect(r).toEqual({ checked: 2, reviews: 2, ccu: 0, prices: 0, hidden: 0, stopped: 'done' })
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

/**
 * Пульс отзывов: за последний месяц, все языки — строка под кольцом /game.
 * Запрос по игре в магазин, тем же пейсером, что у крона карточек, — поэтому
 * скупо: верх пула и несколько игр на звено (PULSE_TOP, PULSE_PER_LINK).
 */
describe('refreshReviewPulse', () => {
  type PulseRow = {
    reviews_30d: number | null
    reviews_recent_total: number | null
    reviews_recent_percent: number | null
    reviews_recent_at: number | null
    updated_at: number
  }
  async function pulseRow(db: Db, appid: number): Promise<PulseRow> {
    const r = await db.execute({
      sql: `SELECT reviews_30d, reviews_recent_total, reviews_recent_percent, reviews_recent_at, updated_at
            FROM games WHERE appid = ?`,
      args: [appid],
    })
    return r.rows[0] as unknown as PulseRow
  }

  test('пишет месяц узко: сколько, доля, отметка и reviews_30d для живости', async () => {
    const db = await createDb(':memory:')
    await pool(db, 1145360, 142_000)
    const before = await pulseRow(db, 1145360)
    const asked: Array<[number, number]> = []
    const r = await refreshReviewPulse(db, {
      deadlineAt: FAR,
      nowSec: NOW,
      fetchPulse: async (appid, at) => {
        asked.push([appid, at])
        return { total: 7948, positive: 7551 }
      },
    })
    expect(r).toEqual({ measured: 1, stopped: 'done' })
    expect(asked).toEqual([[1145360, NOW]])
    expect(await pulseRow(db, 1145360)).toEqual({
      reviews_30d: 7948,
      reviews_recent_total: 7948,
      reviews_recent_percent: 95,
      reviews_recent_at: NOW,
      updated_at: before.updated_at,
    })
    expect(await getGameMeta(db, 1145360)).toMatchObject({
      reviewsRecentTotal: 7948,
      reviewsRecentPercent: 95,
      reviewsRecentAt: NOW,
    })
  })

  test('неделю пульс не перемеряется, потом — снова', async () => {
    const db = await createDb(':memory:')
    await pool(db, 1, 1000)
    let calls = 0
    const fetchPulse = async () => {
      calls++
      return { total: 100, positive: 90 }
    }
    await refreshReviewPulse(db, { deadlineAt: FAR, nowSec: NOW, fetchPulse })
    expect(await refreshReviewPulse(db, { deadlineAt: FAR, nowSec: NOW + 86_400, fetchPulse })).toEqual({
      measured: 0,
      stopped: 'done',
    })
    expect(calls).toBe(1)
    await refreshReviewPulse(db, { deadlineAt: FAR, nowSec: NOW + PULSE_MAX_AGE_SEC + 1, fetchPulse })
    expect(calls).toBe(2)
  })

  test('Steam промолчал — отметка без чисел, и прежний пульс не выдаёт себя за свежий', async () => {
    const db = await createDb(':memory:')
    await pool(db, 1, 1000)
    await refreshReviewPulse(db, { deadlineAt: FAR, nowSec: NOW, fetchPulse: async () => ({ total: 100, positive: 90 }) })
    const later = NOW + PULSE_MAX_AGE_SEC + 1
    await refreshReviewPulse(db, { deadlineAt: FAR, nowSec: later, fetchPulse: async () => undefined })
    expect(await pulseRow(db, 1)).toMatchObject({
      reviews_recent_total: null,
      reviews_recent_percent: null,
      reviews_recent_at: later,
    })
    expect((await getGameMeta(db, 1))?.reviewsRecentAt).toBeUndefined()
  })

  test('ноль за месяц — число для живости есть, доли и строки нет', async () => {
    const db = await createDb(':memory:')
    await pool(db, 1, 1000)
    await refreshReviewPulse(db, { deadlineAt: FAR, nowSec: NOW, fetchPulse: async () => ({ total: 0, positive: 0 }) })
    expect(await pulseRow(db, 1)).toMatchObject({ reviews_30d: 0, reviews_recent_total: 0, reviews_recent_percent: null })
    expect((await getGameMeta(db, 1))?.reviewsRecentTotal).toBeUndefined()
  })

  test('не больше PULSE_PER_LINK на звено: сперва ни разу не мерянные, среди них — верх', async () => {
    const db = await createDb(':memory:')
    for (let i = 1; i <= PULSE_PER_LINK + 2; i++) await pool(db, i, i * 1000)
    const asked: number[] = []
    const r = await refreshReviewPulse(db, {
      deadlineAt: FAR,
      nowSec: NOW,
      fetchPulse: async (appid) => {
        asked.push(appid)
        return { total: 10, positive: 9 }
      },
    })
    expect(r).toEqual({ measured: PULSE_PER_LINK, stopped: 'budget' })
    // верх по отзывам первым: у него карточки читают чаще
    expect(asked).toEqual(Array.from({ length: PULSE_PER_LINK }, (_, i) => PULSE_PER_LINK + 2 - i))
  })

  test('отказы подряд — звено встаёт, а замеренное до них пишется', async () => {
    const db = await createDb(':memory:')
    for (const id of [1, 2, 3, 4]) await pool(db, id, 5000 - id)
    const r = await refreshReviewPulse(db, {
      deadlineAt: FAR,
      nowSec: NOW,
      fetchPulse: async (appid) => {
        if (appid === 1) return { total: 50, positive: 40 }
        throw new Error('appreviews: HTTP 429')
      },
    })
    expect(r).toEqual({ measured: 1, stopped: 'blocked' })
    expect(await pulseRow(db, 1)).toMatchObject({ reviews_recent_total: 50, reviews_recent_at: NOW })
    expect((await pulseRow(db, 4)).reviews_recent_at).toBeNull()
  })

  test('срок звена вышел — в магазин не ходим', async () => {
    const db = await createDb(':memory:')
    await pool(db, 1, 1000)
    let calls = 0
    const r = await refreshReviewPulse(db, {
      deadlineAt: Date.now() - 1,
      nowSec: NOW,
      fetchPulse: async () => {
        calls++
        return { total: 1, positive: 1 }
      },
    })
    expect(r.stopped).toBe('budget')
    expect(calls).toBe(0)
  })

  test('очередь — только верх пула: хвосту месяцем сказать нечего', async () => {
    const db = await createDb(':memory:')
    for (const id of [1, 2, 3]) await pool(db, id, id * 1000)
    await db.execute('UPDATE games SET alive = 0 WHERE appid = 3')
    // верх из двух живых: 2 и 1; мёртвая 3 в пул не входит вовсе
    expect(await reviewPulseQueue(db, { top: 2, before: NOW, limit: 10 })).toEqual([2, 1])
    expect(await reviewPulseQueue(db, { top: 1, before: NOW, limit: 10 })).toEqual([2])
    // свежий пульс у 2 — в очереди остаётся 1, и давний идёт после ни разу не мерянных
    await db.execute({ sql: 'UPDATE games SET reviews_recent_at = ? WHERE appid = 2', args: [NOW - 60] })
    expect(await reviewPulseQueue(db, { top: 2, before: NOW - 3600, limit: 10 })).toEqual([1])
    expect(await reviewPulseQueue(db, { top: 2, before: NOW, limit: 10 })).toEqual([1, 2])
  })
})
