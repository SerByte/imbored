import { describe, expect, test } from 'vitest'
import {
  claimPageEnrichBatch,
  countPageEnrichDue,
  createDb,
  getGameJson,
  markPageEnriched,
  migrateDb,
  replaceGameTags,
  sitemapGames,
  upsertGameMeta,
  type Db,
} from './db'
import { LlmUnavailableError } from './llm'
import { MAX_BLOCKED_RUN, PAGE_MAX_AGE_SEC, PAGE_MAX_TRIES, runPageSlice } from './pagejob'
import type { ParsedReviews } from './reviews'
import type { GameMeta } from './types'

const NOW = 1_700_000_000

function freshDb() {
  return createDb(':memory:')
}

function meta(appid: number, over: Partial<GameMeta> = {}): GameMeta {
  return {
    appid,
    name: `Игра ${appid}`,
    tags: { Action: 100 },
    genres: [],
    categories: [],
    ...over,
  }
}

/** Живая игра в пуле: предикат требует tag_count > 0, а его считает upsert. */
async function addGame(db: Db, appid: number, reviewsTotal: number): Promise<void> {
  await upsertGameMeta(db, meta(appid, { reviewsTotal }), NOW)
  await replaceGameTags(db, appid, [{ tag: 'Action', weight: 100 }])
}

function reviews(n: number): ParsedReviews {
  return {
    score: 8,
    scoreDesc: 'Very Positive',
    totalPositive: 900,
    totalNegative: 100,
    reviews: Array.from({ length: n }, (_, i) => ({
      id: String(i),
      text: `Отличная игра номер ${i}, играю уже долго и не жалею ни минуты`,
      votedUp: i % 2 === 0,
      votesUp: 10 + i,
      playtimeAtReview: 600,
    })),
  }
}

/** Ни один тест не должен уходить в сеть — фетчеры подменяются целиком. */
const stubs = (over: Partial<Parameters<typeof runPageSlice>[1]> = {}) => ({
  deadlineAt: Date.now() + 60_000,
  nowSec: NOW,
  fetchDetails: async (appid: number) => meta(appid, { screenshots: ['a.jpg', 'b.jpg'] }),
  fetchReviewsFn: async () => reviews(6),
  prosConsFn: async () => ({ pros: ['красиво'], cons: ['дорого'] }),
  ...over,
})

describe('очередь обогащения карточек', () => {
  test('сначала ни разу не тронутые, потом по числу отзывов', async () => {
    const db = await freshDb()
    await addGame(db, 10, 50)
    await addGame(db, 20, 900)
    await addGame(db, 30, 400)
    await markPageEnriched(db, 20, NOW)

    // 20 уже трогали — она уходит в хвост, остальные по отзывам
    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10)).toEqual([30, 10])
  })

  test('пустой поход не выдаёт себя за удачный: карточка возвращается в очередь', async () => {
    // Ровно тот случай, что стоил проду 596 карточек из 721: appdetails молчит
    // (лимит), карточка помечается сделанной и выпадает из очереди на полгода.
    const db = await freshDb()
    await addGame(db, 10, 100)

    await runPageSlice(db, stubs({ fetchDetails: async () => null }))

    const opts = { maxTries: PAGE_MAX_TRIES }
    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10, opts)).toEqual([10])
  })

  test('удачный поход убирает карточку из повторов', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)
    const opts = { maxTries: PAGE_MAX_TRIES }

    await runPageSlice(db, stubs({ fetchDetails: async () => null }))
    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10, opts)).toEqual([10])

    // данные приехали — счётчик сброшен
    await runPageSlice(db, stubs())
    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10, opts)).toEqual([])
  })

  test('после потолка попыток карточка перестаёт занимать бюджет', async () => {
    // Дверь, ради которой отметка и ставилась при неудаче: игра, у которой
    // Steam молчит всегда, не должна возвращаться в очередь бесконечно.
    const db = await freshDb()
    await addGame(db, 10, 100)
    const opts = { maxTries: PAGE_MAX_TRIES }

    for (let i = 0; i < PAGE_MAX_TRIES; i++) {
      await runPageSlice(db, stubs({ fetchDetails: async () => null }))
    }
    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10, opts)).toEqual([])
    expect(await countPageEnrichDue(db, NOW - PAGE_MAX_AGE_SEC, PAGE_MAX_TRIES)).toBe(0)
  })

  test('повтор идёт в первой группе, а не в хвосте за пятью тысячами нетронутых', async () => {
    // Пустые походы достались верху каталога: очередь выгребается по убыванию
    // reviews_total. Чинить CS2 после всех, кого никто не ищет, — не починка.
    const db = await freshDb()
    await addGame(db, 10, 900) // популярная, поход был пустым
    await addGame(db, 20, 50) // непопулярная, ни разу не тронутая
    await runPageSlice(db, stubs({ fetchDetails: async () => null, nowSec: NOW }))

    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10, { maxTries: PAGE_MAX_TRIES })).toEqual([
      10, 20,
    ])
  })

  test('без maxTries поведение прежнее: повторов нет', async () => {
    // Значение по умолчанию — ноль, и вызывающий, который про повторы не
    // просил, получает ровно то же, что получал до их появления.
    const db = await freshDb()
    await addGame(db, 10, 100)
    await runPageSlice(db, stubs({ fetchDetails: async () => null }))

    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10)).toEqual([])
  })

  test('разовый бэкфилл возвращает в очередь карточки, помеченные без данных', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)
    // так выглядит наследство: отметка стоит, скриншотов нет, счётчик нулевой
    await markPageEnriched(db, 10, NOW)

    // миграция уже прошла при createDb — снимаем флаг и прогоняем ещё раз
    await db.execute("DELETE FROM catalog_meta WHERE key = 'page_tries_backfilled_v1'")
    await migrateDb(db)

    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10, { maxTries: PAGE_MAX_TRIES })).toEqual([
      10,
    ])
  })

  test('бэкфилл не трогает карточки, у которых скриншоты есть', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)
    await runPageSlice(db, stubs()) // приехали и скриншоты, и pros/cons

    await db.execute("DELETE FROM catalog_meta WHERE key = 'page_tries_backfilled_v1'")
    await migrateDb(db)

    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10, { maxTries: PAGE_MAX_TRIES })).toEqual([])
  })

  test('карточка с эвристическими pros/cons возвращается в очередь, когда есть модель', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)

    // прогон без модели: карточка наполнена, но цитатами из отзывов
    await runPageSlice(db, stubs({ prosConsFn: async () => null }))
    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10)).toEqual([])

    // ключ появился — карточку надо пересобрать, а не ждать полгода
    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10, { redoHeuristic: true })).toEqual([10])
  })

  test('--no-llm модель не зовёт, карточку наполняет эвристикой', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)

    // заглушка prosConsFn тут есть и вернула бы pros/cons — но флаг сильнее
    const res = await runPageSlice(db, stubs({ useClaude: false }))

    expect(res.viaClaude).toBe(0)
    expect(res.withProsCons).toBe(1)
    expect(await getGameJson(db, 10, 'pros_cons_json')).toMatchObject({ source: 'reviews' })
  })

  test('--no-llm не тащит обратно карточку, собранную эвристикой', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)

    // карточку однажды собрали без модели — pros/cons процитированы из отзывов
    await runPageSlice(db, stubs({ prosConsFn: async () => null }))
    expect(await getGameJson(db, 10, 'pros_cons_json')).toMatchObject({ source: 'reviews' })

    // прогон с --no-llm её брать не должен: переписывать эвристику эвристикой
    // не за чем. Раньше флаг приезжал заглушкой prosConsFn, Boolean(prosConsFn)
    // включал «модель есть», тот включал redoHeuristic — и прогон крутился
    // вечно, по два запроса в Steam на каждую карточку.
    const again = await runPageSlice(db, stubs({ useClaude: false }))
    expect(again.enriched).toBe(0)
  })

  test('карточка, собранная моделью, повторно не берётся', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)
    await runPageSlice(db, stubs())

    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10, { redoHeuristic: true })).toEqual([])
  })

  test('обогащённая свежая карточка в очередь не попадает, протухшая возвращается', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)

    await markPageEnriched(db, 10, NOW)
    expect(await countPageEnrichDue(db, NOW - PAGE_MAX_AGE_SEC)).toBe(0)

    // спустя полгода с хвостиком
    const later = NOW + PAGE_MAX_AGE_SEC + 1
    expect(await countPageEnrichDue(db, later - PAGE_MAX_AGE_SEC)).toBe(1)
  })
})

describe('runPageSlice', () => {
  test('заполняет скриншоты, вердикт и pros/cons', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)

    const res = await runPageSlice(db, stubs())

    expect(res.enriched).toBe(1)
    expect(res.withShots).toBe(1)
    expect(res.viaClaude).toBe(1)
    expect(await getGameJson(db, 10, 'reviews_summary_json')).toEqual({
      scoreDesc: 'Very Positive',
      totalPositive: 900,
      totalNegative: 100,
    })
    expect(await getGameJson(db, 10, 'pros_cons_json')).toEqual({
      pros: ['красиво'],
      cons: ['дорого'],
      source: 'claude',
    })
  })

  test('без модели карточка всё равно наполняется — эвристикой из отзывов', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)

    const res = await runPageSlice(db, stubs({ prosConsFn: async () => null }))

    expect(res.viaClaude).toBe(0)
    expect(res.withProsCons).toBe(1)
    const pc = (await getGameJson(db, 10, 'pros_cons_json')) as { source: string }
    expect(pc.source).toBe('reviews')
  })

  test('отказ модели не засчитывается за карточку и не роняет срез', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)
    await addGame(db, 20, 90)

    const res = await runPageSlice(
      db,
      stubs({
        prosConsFn: async () => {
          throw new LlmUnavailableError(402, 'кончились деньги')
        },
      }),
    )

    // обе карточки обработаны, обе получили эвристику
    expect(res.enriched).toBe(2)
    expect(res.withProsCons).toBe(2)
    expect(res.viaClaude).toBe(0)
  })

  test('карточку отмечают даже когда Steam ничего не отдал — иначе очередь встанет', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)

    await runPageSlice(
      db,
      stubs({
        fetchDetails: async () => null,
        fetchReviewsFn: async () => null,
      }),
    )

    expect(await countPageEnrichDue(db, NOW - PAGE_MAX_AGE_SEC)).toBe(0)
  })

  test('три отказа сети подряд останавливают срез: это закрылся Steam, а не игры плохие', async () => {
    const db = await freshDb()
    for (let i = 1; i <= 6; i++) await addGame(db, i * 10, 100 - i)

    const res = await runPageSlice(
      db,
      stubs({
        limit: 6,
        fetchDetails: async () => {
          throw new Error('HTTP 429')
        },
        fetchReviewsFn: async () => {
          throw new Error('HTTP 429')
        },
      }),
    )

    expect(res.stopped).toBe('blocked')
    expect(res.enriched).toBe(3)
    expect(res.hasMore).toBe(false)
  })
})

describe('срез останавливается, когда закрылась любая из двух ручек', () => {
  test('душимый appdetails тоже останавливает срез, а не жжёт весь набор', async () => {
    // Ровно тот механизм, из-за которого 596 карточек остались без скриншотов:
    // отзывы отвечают, appdetails душат, а страж смотрел только на отзывы и
    // обнулялся на каждом их успехе. Срез доходил до конца и помечал всё.
    const db = await freshDb()
    for (let i = 1; i <= 8; i++) await addGame(db, i * 10, 1000 - i)

    const res = await runPageSlice(
      db,
      stubs({
        fetchDetails: async () => {
          throw new Error('HTTP 429')
        },
      }),
    )

    expect(res.stopped).toBe('blocked')
    expect(res.enriched).toBe(MAX_BLOCKED_RUN)
  })

  test('«игры нет в ответе» — не отказ сети и срез не останавливает', async () => {
    // fetchAppDetails возвращает null, когда ответ пришёл, но игры в нём нет
    // (снятая с продажи, не game). Это про игру, а не про наш IP.
    const db = await freshDb()
    for (let i = 1; i <= 6; i++) await addGame(db, i * 10, 1000 - i)

    const res = await runPageSlice(db, stubs({ fetchDetails: async () => null }))

    expect(res.stopped).toBe('done')
    expect(res.enriched).toBe(6)
  })
})
describe('карта сайта', () => {
  test('отдаёт живые игры по убыванию отзывов и не ждёт обогащения', async () => {
    const db = await freshDb()
    await addGame(db, 10, 50)
    await addGame(db, 20, 900)

    const rows = await sitemapGames(db, 10)
    expect(rows.map((r) => r.appid)).toEqual([20, 10])
    expect(rows[0].updatedAt).toBe(NOW)
  })

  test('игры без тегов в карту не попадают: страница была бы пустой', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, { ...meta(10), tags: {} }, NOW)

    expect(await sitemapGames(db, 10)).toEqual([])
  })
})
