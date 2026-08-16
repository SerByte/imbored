import { createClient } from '@libsql/client'
import { describe, expect, test } from 'vitest'
import {
  countIngest,
  getPoolSize,
  loadTagStats,
  migrateDb,
  rebuildTagStats,
  replaceGameTags,
  saveTagDictionary,
  upsertGameMeta,
  upsertIngestRows,
  type Db,
} from './db'
import { fetchDiscoveryPool, pickQueryTags, rotationSlot } from './pool'
import type { GameMeta } from './types'

const NOW = 1_700_000_000

async function freshDb(): Promise<Db> {
  return migrateDb(createClient({ url: ':memory:' }))
}

function meta(appid: number, over: Partial<GameMeta> = {}): GameMeta {
  return {
    appid,
    name: `Игра ${appid}`,
    tags: {},
    genres: [],
    categories: [2],
    ...over,
  }
}

/** Каталог: 3 рогалика разной популярности + мультиплеерный шутер */
async function seed(db: Db) {
  const games: Array<[number, string, number, number[], Array<[string, number]>]> = [
    [1, 'Нишевый рогалик', 500, [2], [['Roguelike', 1000], ['Indie', 300]]],
    [2, 'Средний рогалик', 50_000, [2], [['Roguelike', 800], ['Indie', 900]]],
    [3, 'Блокбастер', 900_000, [2], [['Roguelike', 200], ['Indie', 100]]],
    [4, 'Шутер с друзьями', 300_000, [1, 9], [['Shooter', 1000], ['Indie', 200]]],
  ]
  for (const [appid, name, reviews, cats, tags] of games) {
    await upsertGameMeta(
      db,
      meta(appid, {
        name,
        categories: cats,
        reviewsTotal: reviews,
        tags: Object.fromEntries(tags),
      }),
      NOW,
    )
    await replaceGameTags(
      db,
      appid,
      tags.map(([tag, weight]) => ({ tag, weight })),
    )
  }
}

describe('fetchDiscoveryPool', () => {
  test('находит кандидатов по тегам профиля', async () => {
    const db = await freshDb()
    await seed(db)
    const pool = await fetchDiscoveryPool(db, { tags: ['Roguelike'], limit: 10 })
    expect(pool.map((m) => m.appid).sort()).toEqual([1, 2, 3])
  })

  test('сортирует по характерности тега, а не по популярности', async () => {
    // Ключевой инвариант против «вечных хитов»: первым идёт тот, кто БОЛЬШЕ
    // всего является рогаликом, а не тот, у кого больше отзывов
    const db = await freshDb()
    await seed(db)
    const pool = await fetchDiscoveryPool(db, { tags: ['Roguelike'], limit: 10 })
    expect(pool[0].appid).toBe(1)
    expect(pool[0].reviewsTotal).toBeLessThan(pool[2].reviewsTotal ?? 0)
  })

  test('уважает лимит и не тащит весь каталог', async () => {
    const db = await freshDb()
    await seed(db)
    expect(await fetchDiscoveryPool(db, { tags: ['Roguelike'], limit: 2 })).toHaveLength(2)
  })

  test('фильтр совместной игры отсекает одиночные', async () => {
    const db = await freshDb()
    await seed(db)
    const pool = await fetchDiscoveryPool(db, {
      tags: ['Roguelike', 'Shooter'],
      requireMultiplayer: true,
      limit: 10,
    })
    expect(pool.map((m) => m.appid)).toEqual([4])
  })

  test('скрытые игры не возвращаются', async () => {
    const db = await freshDb()
    await seed(db)
    const pool = await fetchDiscoveryPool(db, {
      tags: ['Roguelike'],
      bannedAppids: [1, 2],
      limit: 10,
    })
    expect(pool.map((m) => m.appid)).toEqual([3])
  })

  test('пустой профиль уходит в холодный старт по популярности', async () => {
    const db = await freshDb()
    await seed(db)
    const pool = await fetchDiscoveryPool(db, { tags: [], limit: 2 })
    expect(pool[0].appid).toBe(3)
  })

  test('разные слоты ротации дают разные срезы хвоста', async () => {
    const db = await freshDb()
    await seed(db)
    const a = await fetchDiscoveryPool(db, { tags: ['Roguelike'], perTag: 1, limit: 5 })
    const b = await fetchDiscoveryPool(db, { tags: ['Roguelike'], perTag: 1, rotation: 1, limit: 5 })
    expect(a.map((m) => m.appid)).not.toEqual(b.map((m) => m.appid))
  })

  test('игра без тегов в проекции не всплывает', async () => {
    const db = await freshDb()
    await upsertGameMeta(db, meta(99, { reviewsTotal: 10_000 }), NOW)
    expect(await fetchDiscoveryPool(db, { tags: ['Roguelike'], limit: 5 })).toEqual([])
  })

  /**
   * Фильтр живости в ветке по тегам держится только на этих двух проверках.
   * Он там отсутствовал, хотя в холодном старте стоял с самого начала, — то
   * есть мёртвые игры видели все, у кого есть профиль вкуса, и никто, у кого
   * его нет. Ровно поэтому расхождение и не бросалось в глаза.
   */
  test('мёртвая игра не попадает в выдачу по тегам', async () => {
    const db = await freshDb()
    await seed(db)
    await db.execute({ sql: 'UPDATE games SET alive = 0 WHERE appid = ?', args: [2] })

    const pool = await fetchDiscoveryPool(db, { tags: ['Roguelike'], limit: 10 })
    expect(pool.map((m) => m.appid).sort()).toEqual([1, 3])
  })

  test('игра, переехавшая в сиквел, не попадает в выдачу по тегам', async () => {
    const db = await freshDb()
    await seed(db)
    await db.execute({ sql: 'UPDATE games SET superseded_by = ? WHERE appid = ?', args: [3, 1] })

    const pool = await fetchDiscoveryPool(db, { tags: ['Roguelike'], limit: 10 })
    expect(pool.map((m) => m.appid).sort()).toEqual([2, 3])
  })

  test('цена и скидка доезжают в проекции', async () => {
    // Без этих колонок карточка открытия знала бы цену, но не знала бы, что
    // она распродажная, — тот же класс потери, что был у developer
    const db = await freshDb()
    await seed(db)
    await upsertGameMeta(
      db,
      meta(1, {
        name: 'Нишевый рогалик',
        reviewsTotal: 500,
        tags: { Roguelike: 1000, Indie: 300 },
        priceFinal: 500,
        priceInitial: 1000,
        discountPercent: 50,
        discountEndsAt: NOW + 86_400,
        priceAt: NOW,
      }),
      NOW,
    )
    const [first] = await fetchDiscoveryPool(db, { tags: ['Roguelike'], limit: 5 })
    expect(first.priceFinal).toBe(500)
    expect(first.priceInitial).toBe(1000)
    expect(first.discountPercent).toBe(50)
    expect(first.discountEndsAt).toBe(NOW + 86_400)
    expect(first.priceAt).toBe(NOW)
  })

  test('wildcard добирает заметное вне тегов профиля', async () => {
    // Единственная дверь наружу из собственного вкуса: без неё любитель
    // рогаликов не увидит ни одной большой игры другого жанра
    const db = await freshDb()
    await seed(db)
    const byTaste = await fetchDiscoveryPool(db, { tags: ['Shooter'], limit: 10 })
    expect(byTaste.map((m) => m.appid)).toEqual([4])

    // Три заметных по отзывам: 3 (900k), 4 (300k), 2 (50k). Четвёртый уже
    // нашёлся по тегу и не задваивается — добавка идёт хвостом, после вкуса.
    const widened = await fetchDiscoveryPool(db, { tags: ['Shooter'], limit: 10, wildcard: 3 })
    expect(widened.map((m) => m.appid)).toEqual([4, 3, 2])
  })

  test('wildcard не задваивает то, что уже нашлось по вкусу', async () => {
    const db = await freshDb()
    await seed(db)
    const pool = await fetchDiscoveryPool(db, { tags: ['Roguelike'], limit: 10, wildcard: 3 })
    expect(new Set(pool.map((m) => m.appid)).size).toBe(pool.length)
  })

  test('wildcard подчиняется общим фильтрам: скрытое и одиночное', async () => {
    const db = await freshDb()
    await seed(db)
    const pool = await fetchDiscoveryPool(db, {
      tags: ['Roguelike'],
      requireMultiplayer: true,
      bannedAppids: [4],
      wildcard: 5,
      limit: 10,
    })
    expect(pool).toEqual([])
  })
})

describe('pickQueryTags', () => {
  const stats = new Map([
    ['Indie', 8000],
    ['Roguelike', 400],
    ['Deckbuilder', 120],
  ])

  test('берёт характерные теги профиля и выкидывает слишком частые', () => {
    // Indie есть у трети каталога и о вкусе не говорит ничего
    const tags = pickQueryTags({ Indie: 900, Roguelike: 700, Deckbuilder: 500 }, stats, 10_000)
    expect(tags).toContain('Roguelike')
    expect(tags).not.toContain('Indie')
  })

  test('ограничивает количество тегов', () => {
    const profile = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`Тег${i}`, 100 - i]),
    )
    expect(pickQueryTags(profile, new Map(), 10_000, 8)).toHaveLength(8)
  })

  test('пустой профиль даёт пустой список, а не мусор', () => {
    expect(pickQueryTags({}, stats, 10_000)).toEqual([])
  })

  test('нулевой знаменатель выключает фильтр, а не роняет подбор', () => {
    // Витрина ещё не публиковалась: лучше пропустить всё, чем упасть
    const tags = pickQueryTags({ Indie: 900, Roguelike: 700 }, stats, 0)
    expect(tags).toContain('Indie')
  })
})

/**
 * Регрессия на разъехавшиеся популяции.
 *
 * game_count считается по game_tags (витрина), а знаменатель раньше брался из
 * countIngest (карта территории). Пока обе величины не считаются по одному и
 * тому же множеству, доля тега занижена, порог не срабатывает, и в запрос
 * уходят Indie с Singleplayer — то есть теги, которые есть у всех.
 */
describe('знаменатель стоп-слов', () => {
  test('считается по витрине, а не по карте территории', async () => {
    const db = await freshDb()
    await seed(db)
    // Карта территории намеренно много больше витрины — как в жизни
    await upsertIngestRows(
      db,
      Array.from({ length: 40 }, (_, i) => ({
        appid: 1000 + i,
        name: `Карта ${i}`,
        tagids: [1],
        reviewsTotal: 10,
      })),
      NOW,
    )
    // rebuildTagStats делает UPDATE tags — то есть видит только теги, уже
    // заведённые в словаре Steam. Без словаря частотность остаётся пустой и
    // фильтр молча выключается: это отдельный способ потерять стоп-слова.
    await saveTagDictionary(
      db,
      new Map([
        [1, 'Roguelike'],
        [2, 'Indie'],
        [3, 'Shooter'],
      ]),
    )
    await rebuildTagStats(db)

    expect(await countIngest(db)).toBe(40)
    expect(await getPoolSize(db)).toBe(4)

    const tagStats = await loadTagStats(db)
    // Indie есть у всех четырёх игр витрины — это стоп-слово по определению
    expect(tagStats.get('Indie')).toBe(4)
    const tags = pickQueryTags({ Indie: 900, Roguelike: 700 }, tagStats, await getPoolSize(db))
    expect(tags).not.toContain('Indie')
    // ...а с прежним знаменателем 4/40 = 0.1 проходило порог и попадало в запрос
    expect(pickQueryTags({ Indie: 900 }, tagStats, await countIngest(db))).toContain('Indie')
  })

  test('на непубликованной базе знаменатель равен нулю', async () => {
    const db = await freshDb()
    expect(await getPoolSize(db)).toBe(0)
  })
})

describe('rotationSlot', () => {
  test('детерминирован для игрока и недели', () => {
    expect(rotationSlot('76561198000000000', NOW)).toBe(rotationSlot('76561198000000000', NOW))
  })

  test('разные игроки видят разные срезы', () => {
    const a = rotationSlot('76561198000000001', NOW)
    const b = rotationSlot('76561198000000002', NOW)
    const c = rotationSlot('76561198000000003', NOW)
    expect(new Set([a, b, c]).size).toBeGreaterThan(1)
  })

  test('срез меняется от недели к неделе', () => {
    const week = 7 * 86_400
    const slots = new Set([0, 1, 2, 3].map((i) => rotationSlot('76561198000000000', NOW + i * week)))
    expect(slots.size).toBeGreaterThan(1)
  })

  test('всегда попадает в диапазон слотов', () => {
    for (let i = 0; i < 50; i++) {
      const s = rotationSlot(`7656119800000${i}`, NOW + i * 86_400, 5)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThan(5)
    }
  })
})
