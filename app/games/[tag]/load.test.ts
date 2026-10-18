import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getGamePageRow, replaceGameTags, setGameJson, upsertGameMeta, type Db } from '@/lib/db'
import { reviewFacts, type GamePageData } from '@/lib/gamepage'
import { reviewsBrief } from '@/lib/gametraits'
import { freshDb } from '@/lib/testing/route'
import type { GameMeta } from '@/lib/types'
import { loadGenre } from './load'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

const NOW = 1_790_000_000
const ISAAC = 250900
const QUIET = 1_000_001

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

async function rogue(appid: number, over: Partial<GameMeta>): Promise<void> {
  await upsertGameMeta(
    db,
    { appid, name: `Игра ${appid}`, tags: { Roguelike: 900 }, genres: [], categories: [2], ...over },
    NOW,
  )
  await replaceGameTags(db, appid, [{ tag: 'Roguelike', weight: 900 }])
}

/**
 * Плитка хаба жанра и кольцо карточки — одна игра, одно число.
 *
 * Было: The Binding of Isaac на /games/roguelike — «96% из 165 тыс.»
 * (англоязычная шкала порогов, reviews_total), а на /game/250900 — «97% из
 * 459 857». Человек, перешедший с хаба на карточку, видел, как отзывы
 * утроились. Теперь обе берут shownReviews — все языки из сверки каталога.
 */
describe('отзывы на плитке хаба', () => {
  test('та же пара, что кольцо карточки, — и не англоязычная шкала', async () => {
    await rogue(ISAAC, { reviewsTotal: 165_000, reviewsPercent: 96 })
    await db.execute({
      sql: 'UPDATE games SET reviews_all_total = ?, reviews_all_percent = ?, reviews_all_score = ? WHERE appid = ?',
      args: [459_857, 97, 9, ISAAC],
    })
    // Сводка карточки полугодовой давности — у кольца она лишь запасной путь
    await setGameJson(db, ISAAC, 'reviews_summary_json', {
      scoreDesc: 'Overwhelmingly Positive',
      totalPositive: 380_000,
      totalNegative: 20_000,
    })

    const genre = await loadGenre('roguelike')
    const tile = genre?.games.find((g) => g.appid === ISAAC)?.reviews
    const row = (await getGamePageRow(db, ISAAC))!
    const facts = reviewFacts(row.meta, row.reviewsSummary as GamePageData['reviewsSummary'])

    expect(facts).toMatchObject({ percent: 97, total: 459_857 })
    expect(tile).toEqual(reviewsBrief(facts?.percent, facts?.total))
    expect(tile?.short).toBe('97% из 460 тыс.')
    expect(tile?.full).not.toContain('165')
  })

  /*
   * Отбор полки — по англоязычной шкале, а номер места в углу плитки стоит
   * рядом с числом всех языков. У хита, который хвалят не по-английски, эти
   * два порядка расходятся, и №1 «из 400 тыс.» над №2 «из 1 млн» выглядел
   * бы выдумкой. Плитка без чисел остаётся на месте отбора.
   */
  test('порядок плиток — по напечатанному числу, а не по англоязычному', async () => {
    const [WEST, EAST, PENDING] = [2_000_001, 2_000_002, 2_000_003]
    await rogue(WEST, { reviewsTotal: 300_000, reviewsPercent: 90 })
    await rogue(PENDING, { reviewsTotal: 250_000, reviewsPercent: 90 })
    await rogue(EAST, { reviewsTotal: 200_000, reviewsPercent: 90 })
    for (const [appid, total] of [
      [WEST, 400_000],
      [EAST, 1_000_000],
    ]) {
      await db.execute({
        sql: 'UPDATE games SET reviews_all_total = ?, reviews_all_percent = 91 WHERE appid = ?',
        args: [total, appid],
      })
    }
    const games = (await loadGenre('roguelike'))?.games ?? []
    expect(games.map((g) => g.appid)).toEqual([EAST, PENDING, WEST])
    expect(games.map((g) => g.reviews?.short ?? null)).toEqual(['91% из 1 млн', null, '91% из 400 тыс.'])
  })

  test('сверка до игры ещё не дошла — плитка молчит, а не печатает англоязычные', async () => {
    await rogue(QUIET, { reviewsTotal: 1_261, reviewsPercent: 72 })
    const genre = await loadGenre('roguelike')
    expect(genre?.games.find((g) => g.appid === QUIET)?.reviews).toBeNull()
  })
})
