import type { InArgs, InStatement } from '@libsql/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  claimPageEnrichBatch,
  countPageEnrichDue,
  createDb,
  getGameJson,
  markPageEnriched,
  markPageMissed,
  migrateDb,
  replaceGameTags,
  setGameJson,
  sitemapGames,
  upsertGameMeta,
  type Db,
} from './db'
import { LlmUnavailableError } from './llm'
import {
  MAX_BLOCKED_RUN,
  PAGE_MAX_AGE_SEC,
  PAGE_MAX_TRIES,
  PROS_CONS_MIN_REVIEWS,
  runPageSlice,
} from './pagejob'
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

/** Где карточка стоит в очереди: ровно то, что блок Steam не должен трогать. */
async function queueState(db: Db, appid: number) {
  const res = await db.execute({
    sql: 'SELECT page_at, page_tries FROM games WHERE appid = ?',
    args: [appid],
  })
  const r = res.rows[0] as unknown as { page_at: number | null; page_tries: number }
  return { pageAt: r.page_at, tries: Number(r.page_tries) }
}

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

  test('две группы выборки в сумме — ровно то, что считает countPageEnrichDue', async () => {
    // Выборка разбита на два запроса ради индекса (см. claimPageEnrichBatch),
    // и разбиение обязано быть точным: иначе отчёт крона говорит одно, а
    // очередь делает другое. Перебираем все сочетания, которые различает
    // предикат, при обеих политиках повторов и с пересборкой и без.
    const db = await freshDb()
    const stale = NOW - PAGE_MAX_AGE_SEC
    const cases: Array<{ pageAt: number | null; tries: number; heuristic: boolean }> = []
    for (const pageAt of [null, stale - 1, NOW])
      for (const tries of [0, 1, PAGE_MAX_TRIES])
        for (const heuristic of [false, true]) cases.push({ pageAt, tries, heuristic })
    let appid = 10
    for (const c of cases) {
      await addGame(db, appid, 1000 - appid)
      if (c.heuristic) await setGameJson(db, appid, 'pros_cons_json', { pros: [], cons: [], source: 'reviews' })
      await db.execute({
        sql: 'UPDATE games SET page_at = ?, page_tries = ? WHERE appid = ?',
        args: [c.pageAt, c.tries, appid],
      })
      appid += 10
    }

    for (const maxTries of [0, PAGE_MAX_TRIES])
      for (const redoHeuristic of [false, true]) {
        const claimed = await claimPageEnrichBatch(db, stale, 1000, { maxTries, redoHeuristic })
        const due = await countPageEnrichDue(db, stale, maxTries, { redoHeuristic })
        expect(claimed.length, `maxTries=${maxTries} redo=${redoHeuristic}`).toBe(due)
        expect(new Set(claimed).size).toBe(claimed.length)
      }
  })

  test('обе группы выборки идут по частичному индексу, а не сортируют каталог', async () => {
    // Ради этого выборка и разбита на два запроса: выражение в ORDER BY
    // частичному индексу не соответствовало, и SQLite читал и сортировал весь
    // каталог ради двадцати appid (USE TEMP B-TREE FOR ORDER BY).
    const db = await freshDb()
    const issued: Array<{ sql: string; args: unknown[] }> = []
    const spy = {
      execute: (q: InStatement) => {
        if (typeof q !== 'string') issued.push({ sql: q.sql, args: (q.args ?? []) as unknown[] })
        return db.execute(q)
      },
    } as unknown as Db

    await claimPageEnrichBatch(spy, NOW - PAGE_MAX_AGE_SEC, 20, {
      maxTries: PAGE_MAX_TRIES,
      redoHeuristic: true,
    })

    expect(issued).toHaveLength(2)
    for (const q of issued) {
      const plan = await db.execute({ sql: `EXPLAIN QUERY PLAN ${q.sql}`, args: q.args as InArgs })
      const detail = plan.rows.map((r) => String(r.detail)).join(' | ')
      expect(detail).toContain('idx_games_pool')
      expect(detail).not.toContain('TEMP B-TREE')
    }
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

  test('на исходе бюджета модель не зовём, но карточку наполняем', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)

    let звали = 0
    // Срок ещё не прошёл — цикл в карточку зайдёт и сходит в Steam, — но
    // остатка заведомо мало: у вызова свои 30с × 2, и они утащили бы инстанс
    // за maxDuration вместе с finally, где передача цепочки и снятие аренды.
    const res = await runPageSlice(
      db,
      stubs({
        deadlineAt: Date.now() + 2_000,
        prosConsFn: async () => {
          звали++
          return { pros: ['красиво'], cons: ['дорого'] }
        },
      }),
    )

    expect(звали).toBe(0)
    expect(res.viaClaude).toBe(0)
    // но карточка не пустая: эвристика считается и пишется до модели
    expect(res.withProsCons).toBe(1)
    expect(await getGameJson(db, 10, 'pros_cons_json')).toMatchObject({ source: 'reviews' })
    // и она вернётся за пересказом сама — ровно этой веткой
    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10, { redoHeuristic: true })).toEqual([10])
  })

  test('запаса хватает — модель зовём и остаток бюджета отдаём ей', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)

    const бюджеты: Array<number | undefined> = []
    await runPageSlice(
      db,
      stubs({
        deadlineAt: Date.now() + 40_000,
        prosConsFn: async (_n: string, _r: unknown, budgetMs?: number) => {
          бюджеты.push(budgetMs)
          return { pros: ['красиво'], cons: ['дорого'] }
        },
      }),
    )

    expect(бюджеты).toHaveLength(1)
    expect(бюджеты[0]).toBeGreaterThan(30_000)
    expect(бюджеты[0]).toBeLessThanOrEqual(40_000)
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

  test('исчерпавшая попытки карточка не возвращается и через пересборку эвристики', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)
    // эвристические pros/cons — то есть кандидат на пересборку моделью
    await setGameJson(db, 10, 'pros_cons_json', { pros: ['а'], cons: [], source: 'reviews' })
    // и при этом счётчик пустых походов уже упёрся в потолок
    for (let i = 0; i < PAGE_MAX_TRIES; i++) await markPageMissed(db, 10, NOW)

    const opts = { redoHeuristic: true, maxTries: PAGE_MAX_TRIES }
    // Ветка пересборки стояла без оглядки на счётчик: карточка, у которой
    // appdetails молчит, а эвристика записана, возвращалась бы в очередь
    // вечно — тот самый head-of-line, ради которого потолок и заводили.
    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10, opts)).toEqual([])
  })

  test('без политики повторов пересборка эвристики работает как прежде', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)
    await setGameJson(db, 10, 'pros_cons_json', { pros: ['а'], cons: [], source: 'reviews' })
    await markPageEnriched(db, 10, NOW)

    // maxTries по умолчанию 0 означает «повторов нет», и голое сравнение
    // page_tries < maxTries убило бы ветку целиком: у карточки счётчик ноль.
    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10, { redoHeuristic: true })).toEqual([10])
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
    // серия отказов — это Steam, а не игры: отметок нет, попытки не тратятся
    expect(res.enriched).toBe(0)
    expect(res.deferred).toBe(3)
    expect(res.hasMore).toBe(false)
    for (const appid of [10, 20, 30]) {
      expect(await queueState(db, appid)).toEqual({ pageAt: null, tries: 0 })
    }
    // и после блока те же карточки идут первыми, а не в хвост за нетронутыми
    const opts = { maxTries: PAGE_MAX_TRIES }
    expect((await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 3, opts)).sort()).toEqual([
      10, 20, 30,
    ])
  })

  test('блок не списывает попытку и с карточки, у которой они уже шли', async () => {
    // Четыре дня блока раньше хоронили верх каталога на полгода: каждый день
    // по попытке из PAGE_MAX_TRIES на те же три карточки.
    const db = await freshDb()
    for (let i = 1; i <= 3; i++) await addGame(db, i * 10, 100 - i)
    await db.execute({
      sql: 'UPDATE games SET page_at = ?, page_tries = ? WHERE appid = 10',
      args: [NOW - 86_400, PAGE_MAX_TRIES - 1],
    })

    const res = await runPageSlice(
      db,
      stubs({
        fetchDetails: async () => {
          throw new Error('HTTP 429')
        },
      }),
    )

    expect(res.stopped).toBe('blocked')
    expect(await queueState(db, 10)).toEqual({ pageAt: NOW - 86_400, tries: PAGE_MAX_TRIES - 1 })
  })

  test('отказ, за которым чистый поход, — про игру: попытка списывается как раньше', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)
    await addGame(db, 20, 50)

    const res = await runPageSlice(
      db,
      stubs({
        fetchDetails: async (appid: number) => {
          if (appid === 10) throw new Error('HTTP 500')
          return meta(appid, { screenshots: ['a.jpg'] })
        },
      }),
    )

    expect(res.stopped).toBe('done')
    expect(res.enriched).toBe(2)
    expect(res.deferred).toBe(0)
    expect(await queueState(db, 10)).toEqual({ pageAt: NOW, tries: 1 })
    expect(await queueState(db, 20)).toEqual({ pageAt: NOW, tries: 0 })
  })

  test('серия, не дошедшая до стража к концу пачки, блоком не считается', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)
    await addGame(db, 20, 50)

    const res = await runPageSlice(
      db,
      stubs({
        fetchDetails: async () => {
          throw new Error('HTTP 429')
        },
      }),
    )

    expect(res.stopped).toBe('done')
    expect(res.enriched).toBe(2)
    expect(await queueState(db, 10)).toEqual({ pageAt: NOW, tries: 1 })
  })
})

describe('срез не начинает карточку, которая не уложится до срока', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('самая долгая из пройденных карточек задаёт запас: следующая не начинается', async () => {
    // Срок проверялся только «прошёл ли он». Карточка, начатая за пять секунд
    // до срока, доезжала до конца за ним — ровно в хвост, отведённый под
    // finally с передачей звена, а на проде это значило снятие по maxDuration.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW * 1000)
    const db = await freshDb()
    for (let i = 1; i <= 5; i++) await addGame(db, i * 10, 1000 - i)

    const deadlineAt = Date.now() + 25_000
    const res = await runPageSlice(
      db,
      stubs({
        limit: 5,
        deadlineAt,
        useClaude: false,
        // каждая карточка идёт десять секунд по настенным часам: два похода в
        // Steam с шагом пейсера и медленным ответом
        fetchDetails: async (appid: number) => {
          vi.setSystemTime(Date.now() + 10_000)
          return meta(appid, { screenshots: ['a.jpg'] })
        },
      }),
    )

    // на 20-й секунде до срока пять — а карточка идёт десять: не начинаем
    expect(res.stopped).toBe('budget')
    expect(res.enriched).toBe(2)
    expect(Date.now()).toBeLessThanOrEqual(deadlineAt)
    // и хвост очереди не потерян: цепочка продолжит с него
    expect(res.hasMore).toBe(true)
  })

  test('первая карточка идёт по одному сроку: сравнить её ещё не с чем', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW * 1000)
    const db = await freshDb()
    await addGame(db, 10, 100)
    await addGame(db, 20, 50)

    const one = { limit: 1, useClaude: false }
    const res = await runPageSlice(db, stubs({ ...one, deadlineAt: Date.now() + 1 }))
    expect(res.enriched).toBe(1)

    const late = await runPageSlice(db, stubs({ ...one, deadlineAt: Date.now() - 1 }))
    expect(late.stopped).toBe('budget')
    expect(late.enriched).toBe(0)
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
    expect(res.deferred).toBe(MAX_BLOCKED_RUN)
    expect(res.enriched).toBe(0)
  })

  test('душимые отзывы тоже останавливают срез, хотя appdetails отвечает', async () => {
    // Вторая ось стража. Пока fetchReviews возвращал null вместо исключения,
    // 429 на appreviews не взводил счётчик вовсе: срез доходил до конца и
    // уводил карточки из очереди на полгода без вердикта отзывов и pros/cons.
    const db = await freshDb()
    for (let i = 1; i <= 8; i++) await addGame(db, i * 10, 1000 - i)

    const res = await runPageSlice(
      db,
      stubs({
        fetchReviewsFn: async () => {
          throw new Error('appreviews 10: HTTP 429')
        },
      }),
    )

    expect(res.stopped).toBe('blocked')
    expect(res.deferred).toBe(MAX_BLOCKED_RUN)
    // appdetails приехал и записан, но «обогащена» карточка не помечена: иначе
    // она полгода стояла бы без вердикта отзывов и pros/cons
    expect(await queueState(db, 10)).toEqual({ pageAt: null, tries: 0 })
    expect(await getGameJson(db, 10, 'reviews_summary_json')).toBeNull()
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

/**
 * В модель — только отзывы, которые кто-то счёл полезными.
 *
 * Pros/cons уходят на публичную страницу из текста посторонних людей. У
 * малоизвестной игры выборка берёт любой отзыв, в том числе написанный под
 * модель, — «полезно» от другого игрока отсекает хотя бы безымянный вброс.
 */
describe('pros/cons только из полезных отзывов', () => {
  /** n отзывов, из них useful с голосами «полезно», остальные без единого */
  function mixed(n: number, useful: number): ParsedReviews {
    const r = reviews(n)
    r.reviews.forEach((x, i) => {
      x.votesUp = i < useful ? 5 : 0
    })
    return r
  }

  test('модель видит только отзывы с хотя бы одним «полезно»', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)

    const видела: Array<Array<{ text: string }>> = []
    const res = await runPageSlice(
      db,
      stubs({
        fetchReviewsFn: async () => mixed(12, PROS_CONS_MIN_REVIEWS),
        prosConsFn: async (_n: string, r: Array<{ text: string }>) => {
          видела.push(r)
          return { pros: ['красиво'], cons: ['дорого'] }
        },
      }),
    )

    expect(res.viaClaude).toBe(1)
    expect(видела).toHaveLength(1)
    expect(видела[0]).toHaveLength(PROS_CONS_MIN_REVIEWS)
  })

  test('полезных меньше пяти — модель не зовём, и в очередь карточка не возвращается', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)

    let звали = 0
    const res = await runPageSlice(
      db,
      stubs({
        fetchReviewsFn: async () => mixed(40, PROS_CONS_MIN_REVIEWS - 1),
        prosConsFn: async () => {
          звали++
          return { pros: ['реклама'], cons: [] }
        },
      }),
    )

    expect(звали).toBe(0)
    expect(res.viaClaude).toBe(0)
    expect(await getGameJson(db, 10, 'pros_cons_json')).toMatchObject({ source: 'thin' })
    // С маркером 'reviews' ветка пересборки брала бы её на каждом прогоне:
    // пересобрать нечем — модель не позовём и в следующий раз
    const opts = { redoHeuristic: true, maxTries: PAGE_MAX_TRIES }
    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10, opts)).toEqual([])
    expect(await countPageEnrichDue(db, NOW - PAGE_MAX_AGE_SEC, PAGE_MAX_TRIES, opts)).toBe(0)
  })

  test('старый маркер пересборки снимается, даже когда эвристике нечего сказать', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)
    // прошлый прогон без модели оставил маркер «пересобрать моделью»
    await setGameJson(db, 10, 'pros_cons_json', { pros: ['а'], cons: [], source: 'reviews' })
    await markPageEnriched(db, 10, NOW)

    // голосов «полезно» нет ни у кого — эвристика (votesUp >= 3) тоже пуста
    const res = await runPageSlice(db, stubs({ fetchReviewsFn: async () => mixed(10, 0) }))

    expect(res.enriched).toBe(1)
    expect(res.withProsCons, 'пустой список — не наполненная карточка').toBe(0)
    expect(await getGameJson(db, 10, 'pros_cons_json')).toEqual({ pros: [], cons: [], source: 'thin' })
    const opts = { redoHeuristic: true, maxTries: PAGE_MAX_TRIES }
    expect(await claimPageEnrichBatch(db, NOW - PAGE_MAX_AGE_SEC, 10, opts)).toEqual([])
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

  test('lastmod — самая поздняя из трёх отметок: заливка, обогащение, патчноут', async () => {
    // updated_at после массовой заливки у всех один и тот же, сигнал несут
    // обогащение и свежий патчноут — см. докблок sitemapGames
    const db = await freshDb()
    await addGame(db, 10, 900)
    await addGame(db, 20, 500)
    await addGame(db, 30, 100)
    await markPageEnriched(db, 20, NOW + 500)
    await db.execute({
      sql: `INSERT INTO news_items (appid, gid, title, url, published_at, created_at, updated_at)
            VALUES (30, 'g1', 't', 'u', ?, ?, ?)`,
      args: [NOW + 900, NOW, NOW],
    })

    const rows = await sitemapGames(db, 10)
    expect(rows).toEqual([
      { appid: 10, updatedAt: NOW },
      { appid: 20, updatedAt: NOW + 500 },
      { appid: 30, updatedAt: NOW + 900 },
    ])
  })

  test('игры без тегов в карту не попадают: страница была бы пустой', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, { ...meta(10), tags: {} }, NOW)

    expect(await sitemapGames(db, 10)).toEqual([])
  })
})
