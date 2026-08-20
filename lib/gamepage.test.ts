import { describe, expect, test } from 'vitest'
import { createDb, replaceGameTags, setGameJson, upsertGameMeta, type Db } from './db'
import { loadGamePage, reviewFacts, topTagOf } from './gamepage'
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

describe('topTagOf', () => {
  test('берёт самый характерный тег, а не первый попавшийся', () => {
    expect(topTagOf(meta(1, { tags: { Indie: 300, Roguelike: 900, Action: 500 } }))).toBe('Roguelike')
  })

  test('при равных весах порядок не зависит от порядка ключей', () => {
    // Страница кэшируется на сутки и пререндерится: блок «похожие» не имеет
    // права меняться от того, как Object.entries вернул ключи после пересборки
    const a = topTagOf(meta(1, { tags: { Zzz: 500, Aaa: 500 } }))
    const b = topTagOf(meta(1, { tags: { Aaa: 500, Zzz: 500 } }))
    expect(a).toBe('Aaa')
    expect(a).toBe(b)
  })

  test('игра без тегов не роняет карточку', () => {
    expect(topTagOf(meta(1, { tags: {} }))).toBeNull()
  })
})

describe('похожие на карточке', () => {
  test('подбираются по характерности тега, а не по популярности', async () => {
    const db = await withDb()
    // герой страницы + три соседа с разной характерностью Roguelike
    for (const [appid, weight, reviews] of [
      [1, 1000, 100],
      [2, 900, 5],
      [3, 200, 900_000],
      [4, 600, 50],
    ] as Array<[number, number, number]>) {
      await upsertGameMeta(
        db,
        meta(appid, { tags: { Roguelike: weight }, reviewsTotal: reviews }),
        NOW,
      )
      await replaceGameTags(db, appid, [{ tag: 'Roguelike', weight }])
    }

    const page = await loadGamePage(1)
    expect(page?.similarTag).toBe('Roguelike')
    // блокбастер с 900k отзывов, но слабым тегом, стоит ПОСЛЕДНИМ
    expect(page?.similar.map((g) => g.appid)).toEqual([2, 4, 3])
    // сама игра в свои же похожие не попадает
    expect(page?.similar.map((g) => g.appid)).not.toContain(1)
  })

  test('игра без тегов отдаёт пустой список, а не падает', async () => {
    const db = await withDb()
    await upsertGameMeta(db, meta(50, { tags: {} }), NOW)
    const page = await loadGamePage(50)
    expect(page?.similar).toEqual([])
    expect(page?.similarTag).toBeNull()
  })

  test('соседи есть и у записей чужих магазинов', async () => {
    const db = await withDb()
    await upsertGameMeta(db, meta(-7, { tags: { Roguelike: 800 } }), NOW)
    await replaceGameTags(db, -7, [{ tag: 'Roguelike', weight: 800 }])
    await upsertGameMeta(db, meta(9, { tags: { Roguelike: 500 } }), NOW)
    await replaceGameTags(db, 9, [{ tag: 'Roguelike', weight: 500 }])

    const page = await loadGamePage(-7)
    // патчей и отзывов Steam у такой записи нет, а похожие — есть
    expect(page?.news).toEqual([])
    expect(page?.similar.map((g) => g.appid)).toEqual([9])
  })
})

/**
 * Страница игры называется «стоит ли играть», а кольцо с процентом рисовалось
 * только из сводки отзывов, которую наполняет крон. В каталоге на тысячу игр
 * её нет у 278 — то есть 28% страниц не отвечали на вопрос из собственного
 * заголовка, при том что процент и количество лежат в той же строке базы и
 * заполнены у всех до одной.
 */
describe('reviewFacts', () => {
  const summary = { scoreDesc: 'Very Positive', totalPositive: 90, totalNegative: 10 }

  test('сводка точнее: процент считается из сырых количеств', () => {
    expect(reviewFacts({ reviewsPercent: 50, reviewsTotal: 2 }, summary)).toEqual({
      percent: 90,
      total: 100,
      label: 'Very Positive',
    })
  })

  test('без сводки берутся колонки — ровно тот случай, ради которого всё и делалось', () => {
    expect(reviewFacts({ reviewsPercent: 95, reviewsTotal: 13_440 }, null)).toEqual({
      percent: 95,
      total: 13_440,
      label: null,
    })
  })

  /**
   * Числа — факт площадки, и мы их пересказываем. Словесная шкала — её
   * суждение, и придумывать его за неё нельзя, как бы ни хотелось заполнить
   * пустое место словом.
   */
  test('слово без сводки не выдумывается', () => {
    expect(reviewFacts({ reviewsPercent: 97, reviewsTotal: 60_000 }, null)?.label).toBeNull()
  })

  test('пустая сводка не считается сводкой', () => {
    const empty = { scoreDesc: 'No user reviews', totalPositive: 0, totalNegative: 0 }
    expect(reviewFacts({ reviewsPercent: 80, reviewsTotal: 10 }, empty)).toEqual({
      percent: 80,
      total: 10,
      label: null,
    })
  })

  test('когда нечего показать — null, а не ноль процентов', () => {
    expect(reviewFacts({}, null)).toBeNull()
    expect(reviewFacts({ reviewsPercent: 90 }, null)).toBeNull()
    expect(reviewFacts({ reviewsTotal: 100 }, null)).toBeNull()
    expect(reviewFacts({ reviewsPercent: 90, reviewsTotal: 0 }, null)).toBeNull()
  })

  test('процент из колонок зажимается в 0…100', () => {
    expect(reviewFacts({ reviewsPercent: 140, reviewsTotal: 5 }, null)?.percent).toBe(100)
    expect(reviewFacts({ reviewsPercent: -3, reviewsTotal: 5 }, null)?.percent).toBe(0)
  })
})
