import { describe, expect, test } from 'vitest'
import {
  createDb,
  getGamesMetaLite,
  upsertGameMeta,
  upsertSemantics,
  type Db,
} from '../lib/db'
import { deriveSemantics, MIN_PLAYED_REVIEWS, MIN_REVIEWS, PLAYED_SINCE } from '../lib/semantics'
import type { GameMeta, GameSemantics } from '../lib/types'
import { BLOCKED_RUN, buildTagPrior, publishSemantics, reviewPass, reviewQueue } from './semanticsbuild'

const NOW = 1_700_000_000
const freshDb = () => createDb(':memory:')

const ROGUELITE = { Roguelite: 1000, 'Action Roguelike': 800 }

function meta(appid: number, over: Partial<GameMeta> = {}): GameMeta {
  return { appid, name: `Игра ${appid}`, tags: ROGUELITE, genres: [], categories: [], ...over }
}

/** Живая игра пула: курация пишет вердикт отдельным UPDATE, как promote-catalog */
async function addGame(db: Db, appid: number, reviewsTotal: number, over: Partial<GameMeta> = {}) {
  await upsertGameMeta(db, meta(appid, { reviewsTotal, ...over }), NOW)
  await db.execute({ sql: 'UPDATE games SET signals_at = ?, alive = 1 WHERE appid = ?', args: [NOW, appid] })
}

/** Ответ appreviews с n русскими отзывами */
function reviewsJson(n: number) {
  return {
    success: 1,
    reviews: Array.from({ length: n }, (_, i) => ({
      recommendationid: String(i),
      language: 'russian',
      review: `Забег минут на двадцать, ещё один и спать — отзыв ${i}`,
      voted_up: true,
      votes_up: 1,
      author: { playtime_at_review: 300, playtime_forever: 600 },
    })),
  }
}

async function basisOf(db: Db, appid: number): Promise<{ basis: string; reviewsAt: number | null } | null> {
  const res = await db.execute({
    sql: 'SELECT basis, reviews_at FROM game_semantics WHERE appid = ?',
    args: [appid],
  })
  const r = res.rows[0]
  return r ? { basis: String(r.basis), reviewsAt: r.reviews_at === null ? null : Number(r.reviews_at) } : null
}

describe('приор по тегам на весь каталог', () => {
  test('все живые игры, мёртвые и вытесненные мимо', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)
    await addGame(db, 20, 50)
    await addGame(db, 30, 900)
    await db.execute('UPDATE games SET alive = 0 WHERE appid = 20')
    await db.execute('UPDATE games SET superseded_by = 10 WHERE appid = 30')

    expect(await buildTagPrior(db, NOW)).toEqual({ games: 1 })
    expect(await basisOf(db, 10)).toEqual({ basis: 'tags', reviewsAt: null })
    expect(await basisOf(db, 20)).toBeNull()
    expect(await basisOf(db, 30)).toBeNull()
    expect((await getGamesMetaLite(db, [10])).get(10)?.semantics).toEqual(deriveSemantics(ROGUELITE, null))
  })

  test('обходит каталог страницами, а не одним чтением', async () => {
    const db = await freshDb()
    for (let appid = 1; appid <= 1203; appid++) await addGame(db, appid, appid)

    expect(await buildTagPrior(db, NOW)).toEqual({ games: 1203 })
    const n = await db.execute('SELECT COUNT(*) AS n FROM game_semantics')
    expect(Number(n.rows[0].n)).toBe(1203)
  })

  test('повторный прогон не откатывает посчитанное по отзывам', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)
    await reviewPass(db, { limit: 5, now: () => NOW, fetchRaw: async () => reviewsJson(MIN_REVIEWS + 2) })

    await buildTagPrior(db, NOW + 3600)

    expect(await basisOf(db, 10)).toEqual({ basis: 'tags+reviews', reviewsAt: NOW })
  })
})

describe('проход по отзывам', () => {
  test('очередь: сверху каталога и только те, за кем ещё не ходили', async () => {
    const db = await freshDb()
    await addGame(db, 10, 100)
    await addGame(db, 20, 900)
    await addGame(db, 30, 500)
    // у 30 отзывы уже спрашивали — тонкая или нет, второй раз не идём
    await upsertSemantics(db, [
      { appid: 30, semantics: deriveSemantics(ROGUELITE, null), computedAt: NOW, reviewsAt: NOW },
    ])

    expect((await reviewQueue(db, 10)).map((g) => g.appid)).toEqual([20, 10])
  })

  test('тонкая игра получает отметку и не возвращается в следующую порцию', async () => {
    const db = await freshDb()
    await addGame(db, 10, 900)
    await addGame(db, 20, 100)
    const спрошено: number[] = []
    const fetchRaw = async (appid: number) => {
      спрошено.push(appid)
      return reviewsJson(appid === 10 ? 2 : MIN_REVIEWS + 2)
    }

    const first = await reviewPass(db, { limit: 1, now: () => NOW, fetchRaw })
    const second = await reviewPass(db, { limit: 1, now: () => NOW, fetchRaw })

    expect(спрошено).toEqual([10, 20])
    expect(first).toEqual({ answered: 1, withReviews: 0, failed: 0, stopped: 'done' })
    expect(second).toEqual({ answered: 1, withReviews: 1, failed: 0, stopped: 'done' })
    expect(await basisOf(db, 10)).toEqual({ basis: 'tags', reviewsAt: NOW })
    expect(await basisOf(db, 20)).toEqual({ basis: 'tags+reviews', reviewsAt: NOW })
  })

  test('отказы подряд останавливают проход, и игры остаются в очереди', async () => {
    const db = await freshDb()
    for (let i = 1; i <= BLOCKED_RUN + 3; i++) await addGame(db, i, 1000 - i)
    let спрошено = 0

    const res = await reviewPass(db, {
      limit: 50,
      now: () => NOW,
      fetchRaw: async () => {
        спрошено++
        throw new Error('appreviews: HTTP 429')
      },
    })

    expect(res).toEqual({ answered: 0, withReviews: 0, failed: BLOCKED_RUN, stopped: 'blocked' })
    expect(спрошено).toBe(BLOCKED_RUN)
    expect(await reviewQueue(db, 50)).toHaveLength(BLOCKED_RUN + 3)
  })

  test('одиночный отказ серию не начинает: удачный ответ её обрывает', async () => {
    const db = await freshDb()
    for (let i = 1; i <= 6; i++) await addGame(db, i, 1000 - i)

    const res = await reviewPass(db, {
      limit: 50,
      now: () => NOW,
      fetchRaw: async (appid) => {
        if (appid % 2) throw new Error('HTTP 500')
        return reviewsJson(MIN_REVIEWS)
      },
    })

    expect(res).toEqual({ answered: 3, withReviews: 3, failed: 3, stopped: 'done' })
  })
})

describe('разовый догон «Наиграли»', () => {
  const DAY = 86_400
  /** Запись по отзывам, разобранным до «Наиграли»: played в ней нет */
  const OLD_REVIEWS: GameSemantics = {
    ...deriveSemantics(ROGUELITE, null),
    n: 40,
    basis: 'tags+reviews',
    confidence: 0.6,
  }

  async function playedOf(db: Db, appid: number): Promise<unknown> {
    const res = await db.execute({ sql: 'SELECT json FROM game_semantics WHERE appid = ?', args: [appid] })
    return (JSON.parse(String(res.rows[0].json)) as GameSemantics).played ?? null
  }

  test('в очередь — только запись по отзывам без played, разобранная до отсечки', async () => {
    const db = await freshDb()
    for (const [appid, total] of [[10, 900], [20, 800], [30, 700], [40, 600]]) await addGame(db, appid, total)
    await upsertSemantics(db, [
      // разобрана до «Наиграли» — хваливших не считали: догоняем
      { appid: 10, semantics: OLD_REVIEWS, computedAt: PLAYED_SINCE - DAY, reviewsAt: PLAYED_SINCE - DAY },
      // разобрана после — played нет, потому что хваливших с временем мало: не догоняем
      { appid: 20, semantics: OLD_REVIEWS, computedAt: PLAYED_SINCE + DAY, reviewsAt: PLAYED_SINCE + DAY },
      // played уже есть — догонять нечего
      {
        appid: 30,
        semantics: { ...OLD_REVIEWS, played: { posMedianMin: 600, posN: 45 } },
        computedAt: PLAYED_SINCE - DAY,
        reviewsAt: PLAYED_SINCE - DAY,
      },
      // по тегам: отзывов не хватило сдвинуть оси, played без них не пишется
      {
        appid: 40,
        semantics: deriveSemantics(ROGUELITE, null),
        computedAt: PLAYED_SINCE - DAY,
        reviewsAt: PLAYED_SINCE - DAY,
      },
    ])

    expect((await reviewQueue(db, 10)).map((g) => g.appid)).toEqual([10])
  })

  test('после похода игра уходит из очереди — и с наигранным, и тонкая', async () => {
    const db = await freshDb()
    await addGame(db, 10, 900)
    await addGame(db, 20, 800)
    await upsertSemantics(
      db,
      [10, 20].map((appid) => ({
        appid,
        semantics: OLD_REVIEWS,
        computedAt: PLAYED_SINCE - DAY,
        reviewsAt: PLAYED_SINCE - DAY,
      })),
    )
    const спрошено: number[] = []
    const fetchRaw = async (appid: number) => {
      спрошено.push(appid)
      // у 10 хваливших с временем хватает, у 20 их меньше порога
      return reviewsJson(appid === 10 ? MIN_PLAYED_REVIEWS + 5 : MIN_REVIEWS + 2)
    }

    const at = PLAYED_SINCE + DAY
    expect(await reviewPass(db, { limit: 10, now: () => at, fetchRaw })).toMatchObject({ answered: 2 })
    expect(await playedOf(db, 10)).toEqual({ posMedianMin: 300, posN: MIN_PLAYED_REVIEWS + 5 })
    expect(await playedOf(db, 20)).toBeNull()

    expect(await reviewQueue(db, 10)).toEqual([])
    await reviewPass(db, { limit: 10, now: () => at + DAY, fetchRaw })
    expect(спрошено).toEqual([10, 20])
  })

  test('Steam отдал меньше отзывов, чем раньше: запись не откатывается, а игра всё равно уходит из очереди', async () => {
    const db = await freshDb()
    await addGame(db, 10, 900)
    await upsertSemantics(db, [
      { appid: 10, semantics: OLD_REVIEWS, computedAt: PLAYED_SINCE - DAY, reviewsAt: PLAYED_SINCE - DAY },
    ])

    const at = PLAYED_SINCE + DAY
    // два отзыва — меньше MIN_REVIEWS: приор по тегам, и upsertSemantics его поверх не пишет
    await reviewPass(db, { limit: 10, now: () => at, fetchRaw: async () => reviewsJson(2) })

    expect(await basisOf(db, 10)).toEqual({ basis: 'tags+reviews', reviewsAt: at })
    expect(await reviewQueue(db, 10)).toEqual([])
  })
})

describe('заливка в облако', () => {
  const BY_TAGS = deriveSemantics(ROGUELITE, null)
  const BY_REVIEWS: GameSemantics = { ...BY_TAGS, n: 40, basis: 'tags+reviews', confidence: 0.6 }

  test('приор из локальной базы не затирает посчитанное кроном по отзывам', async () => {
    const local = await freshDb()
    const remote = await freshDb()
    await upsertSemantics(local, [
      { appid: 10, semantics: BY_TAGS, computedAt: NOW + 3600 },
      { appid: 20, semantics: BY_REVIEWS, computedAt: NOW, reviewsAt: NOW },
    ])
    await upsertSemantics(remote, [
      { appid: 10, semantics: BY_REVIEWS, computedAt: NOW, reviewsAt: NOW },
      { appid: 20, semantics: BY_TAGS, computedAt: NOW + 3600 },
    ])

    expect(await publishSemantics(local, remote)).toEqual({ sent: 2, skipped: 0 })

    expect(await basisOf(remote, 10)).toEqual({ basis: 'tags+reviews', reviewsAt: NOW })
    expect(await basisOf(remote, 20)).toEqual({ basis: 'tags+reviews', reviewsAt: NOW })
  })

  test('нечитаемая строка не едет', async () => {
    const local = await freshDb()
    const remote = await freshDb()
    await upsertSemantics(local, [{ appid: 10, semantics: BY_TAGS, computedAt: NOW }])
    await local.execute({
      sql: `INSERT INTO game_semantics (appid, v, json, basis, computed_at) VALUES (20, 1, ?, 'tags', ?)`,
      args: ['{"v":1}', NOW],
    })

    expect(await publishSemantics(local, remote)).toEqual({ sent: 1, skipped: 1 })
    expect(await basisOf(remote, 20)).toBeNull()
  })
})
