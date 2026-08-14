import { describe, expect, test } from 'vitest'
import { createDb, replaceGameTags, setGameJson, upsertGameMeta, type Db } from './db'
import { loadGamePage } from './gamepage'
import type { GameMeta } from './types'

/**
 * Карточка игры — единственная публичная страница проекта, и правил у неё
 * ровно два. Оба нарушались, и оба стоили дорого, поэтому оба под тестом.
 */

const NOW = 1_700_000_000

function meta(appid: number, over: Partial<GameMeta> = {}): GameMeta {
  return { appid, name: `Игра ${appid}`, tags: { Action: 100 }, genres: [], categories: [], ...over }
}

async function addGame(db: Db, appid: number): Promise<void> {
  await upsertGameMeta(db, meta(appid), NOW)
  await replaceGameTags(db, appid, [{ tag: 'Action', weight: 100 }])
}

/** loadGamePage читает базу через getDb(), поэтому подменяем её на файловую. */
async function withDb(): Promise<Db> {
  const db = await createDb(':memory:')
  const g = globalThis as typeof globalThis & { __imboredDb?: Promise<Db> }
  g.__imboredDb = Promise.resolve(db)
  return db
}

describe('loadGamePage', () => {
  test('незнакомый appid — null, чтобы краулер получил 404 после одного чтения', async () => {
    await withDb()
    expect(await loadGamePage(999_999_999)).toBeNull()
  })

  /**
   * Эвристические pros/cons — это первые предложения самых залайканных отзывов
   * как есть. В проде это дало китайский, испанский, зацензуренный мат и прямую
   * непристойность в блоке «за что любят» на русскоязычной странице из карты
   * сайта. Отбор по числу голосов не помогает: залайкивают как раз шутки.
   */
  test('эвристические pros/cons наружу не отдаются', async () => {
    const db = await withDb()
    await addGame(db, 10)
    await setGameJson(db, 10, 'pros_cons_json', {
      pros: ['纯萌新，请问星星炮300颗星星能不能打过骷髅王'],
      cons: ['buen juego pero todavia no sacan un parche'],
      source: 'reviews',
    })

    const page = await loadGamePage(10)
    expect(page?.prosCons).toBeNull()
  })

  test('собранное моделью отдаётся как есть', async () => {
    const db = await withDb()
    await addGame(db, 20)
    const fromClaude = { pros: ['красиво'], cons: ['дорого'], source: 'claude' as const }
    await setGameJson(db, 20, 'pros_cons_json', fromClaude)

    expect((await loadGamePage(20))?.prosCons).toEqual(fromClaude)
  })

  test('остальное содержимое карточки от pros/cons не зависит', async () => {
    const db = await withDb()
    await addGame(db, 30)
    await setGameJson(db, 30, 'pros_cons_json', { pros: ['x'], cons: [], source: 'reviews' })
    await setGameJson(db, 30, 'reviews_summary_json', {
      scoreDesc: 'Very Positive',
      totalPositive: 900,
      totalNegative: 100,
    })

    const page = await loadGamePage(30)
    // блок отзывов и сама игра на месте — пустеет только pros/cons
    expect(page?.meta.name).toBe('Игра 30')
    expect(page?.reviewsSummary?.scoreDesc).toBe('Very Positive')
    expect(page?.prosCons).toBeNull()
  })
})
