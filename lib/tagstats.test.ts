import { createClient } from '@libsql/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { buildCandidates } from './candidates'
import { migrateDb, saveLibrarySnapshot, upsertGamesMeta, type Db } from './db'
import { NEUTRAL_MOOD } from './mood'
import { TAG_STATS_TTL_SEC, tagStatsFor } from './tagstats'

/**
 * Карта тегов каталога — вся таблица tags, около 430 строк Turso, — читалась
 * на каждый подбор, «Что-то другое», колоду исследователя, сравнение и колоду
 * комнаты, хотя меняется только с заливкой каталога. Память на процесс уже
 * была у карточки игры; здесь — что её получили горячие пути и что она не
 * прячет ни сбоев, ни свежий каталог.
 */

const NOW = 1_780_000_000
const ME = '76561197960287930'

async function freshDb(): Promise<Db> {
  return migrateDb(createClient({ url: ':memory:' }))
}

/** Прогретая карта: самый частый тег не реже MIN_TAG_STATS — редкость считается */
async function warmTags(db: Db): Promise<void> {
  const rows: Array<[string, number]> = [
    ['Singleplayer', 3031],
    ['Indie', 1750],
    ['Puzzle', 732],
    ['Automation', 91],
  ]
  for (const [i, [name, count]] of rows.entries()) {
    await db.execute({
      sql: 'INSERT INTO tags (tagid, name, game_count) VALUES (?, ?, ?)',
      args: [i + 1, name, count],
    })
  }
}

/** Сколько раз читалась таблица tags — через тот же клиент, что у запроса */
function countTagReads(db: Db): () => number {
  const spy = vi.spyOn(db, 'execute')
  return () =>
    spy.mock.calls.filter((args) => {
      const stmt: unknown = args[0]
      const sql = typeof stmt === 'string' ? stmt : (stmt as { sql?: unknown }).sql
      return typeof sql === 'string' && /FROM tags\b/.test(sql)
    }).length
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tagStatsFor', () => {
  test('в пределах TTL таблица читается один раз', async () => {
    const db = await freshDb()
    await warmTags(db)
    const reads = countTagReads(db)
    const a = await tagStatsFor(db, NOW)
    const b = await tagStatsFor(db, NOW + TAG_STATS_TTL_SEC - 1)
    expect(reads()).toBe(1)
    expect(b).toBe(a)
    expect(a.get('Automation')).toBe(91)
  })

  test('по истечении TTL — свежее чтение: новая заливка каталога доезжает', async () => {
    const db = await freshDb()
    await warmTags(db)
    await tagStatsFor(db, NOW)
    await db.execute("UPDATE tags SET game_count = 120 WHERE name = 'Automation'")
    expect((await tagStatsFor(db, NOW + TAG_STATS_TTL_SEC)).get('Automation')).toBe(120)
  })

  /*
   * Непрогретая база (самый частый тег реже MIN_TAG_STATS): карта пригодной
   * не считается, и запоминать её незачем — иначе каталог, залитый следом,
   * дошёл бы до подбора только через шесть часов.
   */
  test('непрогретая карта не запоминается', async () => {
    const db = await freshDb()
    await db.execute("INSERT INTO tags (tagid, name, game_count) VALUES (1, 'Puzzle', 3)")
    const reads = countTagReads(db)
    await tagStatsFor(db, NOW)
    await tagStatsFor(db, NOW + 1)
    expect(reads()).toBe(2)
  })

  test('у каждой базы своя память', async () => {
    const one = await freshDb()
    const two = await freshDb()
    await warmTags(one)
    expect((await tagStatsFor(one, NOW)).size).toBe(4)
    expect((await tagStatsFor(two, NOW)).size).toBe(0)
  })

  /*
   * Сбой чтения без запомненной карты бросает, как бросал loadTagStats:
   * молча отданная пустая карта перевела бы подбор на «как без каталога», и
   * никто бы этого не увидел. С запомненной — отдаётся она, пусть и старая.
   */
  test('сбой без памяти — бросает; с просроченной памятью — отдаёт её', async () => {
    const cold = await freshDb()
    vi.spyOn(cold, 'execute').mockRejectedValueOnce(new Error('turso down'))
    await expect(tagStatsFor(cold, NOW)).rejects.toThrow('turso down')

    const db = await freshDb()
    await warmTags(db)
    const first = await tagStatsFor(db, NOW)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(db, 'execute').mockRejectedValueOnce(new Error('turso down'))
    expect(await tagStatsFor(db, NOW + TAG_STATS_TTL_SEC + 1)).toBe(first)
  })

  test('два подбора подряд читают таблицу тегов один раз', async () => {
    const db = await freshDb()
    await warmTags(db)
    await upsertGamesMeta(
      db,
      [1, 2, 3].map((appid) => ({
        appid,
        name: `Игра ${appid}`,
        tags: { Puzzle: 100 },
        genres: [],
        categories: [2],
      })),
      NOW,
    )
    await saveLibrarySnapshot(
      db,
      ME,
      [
        { appid: 1, name: 'Игра 1', playtimeForever: 600, playtime2Weeks: 0 },
        { appid: 2, name: 'Игра 2', playtimeForever: 0, playtime2Weeks: 0 },
        { appid: 3, name: 'Игра 3', playtimeForever: 0, playtime2Weeks: 0 },
      ],
      NOW,
    )
    const reads = countTagReads(db)
    for (const at of [NOW, NOW + 60]) {
      const set = await buildCandidates(db, ME, NEUTRAL_MOOD, 'all', { nowSec: at })
      if (typeof set === 'string') throw new Error(set)
      expect(set.tagWeight).not.toBeNull()
    }
    expect(reads()).toBe(1)
  })
})
