import { describe, expect, test } from 'vitest'
import { createDb, getNeighbors, replaceGameTags, upsertGameMeta, upsertNeighbors, type Db } from '../lib/db'
import type { GameMeta } from '../lib/types'
import { buildNeighborTable, loadNeighborGames, publishNeighbors } from './neighborsbuild'

const NOW = 1_700_000_000
const freshDb = () => createDb(':memory:')

function meta(appid: number, tags: Record<string, number>, over: Partial<GameMeta> = {}): GameMeta {
  return { appid, name: `Игра ${appid}`, tags, genres: [], categories: [], ...over }
}

/** Игра каталога: мета, топ тегов в game_tags и вердикт курации, как у promote-catalog */
async function addGame(db: Db, appid: number, tags: Record<string, number>, over: Partial<GameMeta> = {}) {
  await upsertGameMeta(db, meta(appid, tags, over), NOW)
  await replaceGameTags(db, appid, Object.entries(tags).map(([tag, weight]) => ({ tag, weight })))
  await db.execute({ sql: 'UPDATE games SET signals_at = ?, alive = 1 WHERE appid = ?', args: [NOW, appid] })
}

/** Карта тегов каталога: без неё редкость неизвестна */
async function tagStats(db: Db, stats: Record<string, number>) {
  await db.batch(
    Object.entries(stats).map(([name, count], i) => ({
      sql: 'INSERT INTO tags (tagid, name, game_count) VALUES (?, ?, ?)',
      args: [i + 1, name, count],
    })),
    'write',
  )
}

/** Маленький каталог: два мифологических рогалика, рогалик, ферма и «костяк» */
async function catalog(db: Db) {
  await tagStats(db, {
    Singleplayer: 3031,
    Action: 2383,
    Indie: 1750,
    Roguelite: 400,
    'Action Roguelike': 300,
    Mythology: 60,
    'Farming Sim': 80,
  })
  await addGame(db, 1, { 'Action Roguelike': 1000, Mythology: 800, Action: 500 }, { name: 'Hades' })
  await addGame(db, 2, { 'Action Roguelike': 1000, Mythology: 900, Indie: 400 }, { name: 'Hades II' })
  await addGame(db, 3, { Roguelite: 1000, 'Action Roguelike': 900, Indie: 800 })
  await addGame(db, 4, { 'Farming Sim': 1000, Indie: 700 })
  await addGame(db, 5, { Singleplayer: 1000, Action: 900, Indie: 800 })
}

const rowsOf = async (db: Db) =>
  (await db.execute('SELECT appid, rank, neighbor FROM game_neighbors ORDER BY appid, rank')).rows.map(
    (r) => [Number(r.appid), Number(r.rank), Number(r.neighbor)],
  )

describe('векторы из game_tags', () => {
  test('только живые игры пула, теги — из game_tags', async () => {
    const db = await freshDb()
    await catalog(db)
    await db.execute('UPDATE games SET alive = 0 WHERE appid = 4')
    await db.execute('UPDATE games SET superseded_by = 1 WHERE appid = 5')
    const games = await loadNeighborGames(db)
    expect(games.map((g) => g.appid)).toEqual([1, 2, 3])
    expect(games[0]).toMatchObject({ name: 'Hades', tags: { 'Action Roguelike': 1000, Mythology: 800, Action: 500 } })
  })
})

describe('таблица соседей в локальной базе', () => {
  test('считается и читается getNeighbors по порядку', async () => {
    const db = await freshDb()
    await catalog(db)
    const res = await buildNeighborTable(db)
    expect(res).toMatchObject({ games: 5, weighted: true })

    const hades = await getNeighbors(db, 1)
    expect(hades[0]).toMatchObject({ appid: 2, name: 'Hades II', shared: ['Mythology', 'Action Roguelike'] })
    expect(hades.map((g) => g.appid)).not.toContain(1)
    expect(await getNeighbors(db, 1, 1)).toHaveLength(1)
  })

  test('умершего с пересчёта соседа getNeighbors не отдаёт', async () => {
    const db = await freshDb()
    await catalog(db)
    await buildNeighborTable(db)
    await db.execute('UPDATE games SET alive = 0 WHERE appid = 2')
    expect((await getNeighbors(db, 1)).map((g) => g.appid)).not.toContain(2)
  })

  test('игра, ушедшая из пула, теряет строки при следующей сборке', async () => {
    const db = await freshDb()
    await catalog(db)
    await buildNeighborTable(db)
    await db.execute('UPDATE games SET alive = 0 WHERE appid = 3')
    await buildNeighborTable(db)
    const rows = await rowsOf(db)
    expect(rows.some(([appid]) => appid === 3)).toBe(false)
    expect(rows.some(([, , neighbor]) => neighbor === 3)).toBe(false)
  })

  test('игра, которой соседей не посчитали, отдаёт пустой список', async () => {
    const db = await freshDb()
    await catalog(db)
    expect(await getNeighbors(db, 1)).toEqual([])
  })
})

describe('заливка в облако', () => {
  test('везёт списки как есть; повтор на том же не пишет ни строки', async () => {
    const local = await freshDb()
    const remote = await freshDb()
    await catalog(local)
    const built = await buildNeighborTable(local)

    const first = await publishNeighbors(local, remote)
    expect(first).toEqual({ games: 5, written: built.rows })
    expect(await rowsOf(remote)).toEqual(await rowsOf(local))

    expect(await publishNeighbors(local, remote)).toEqual({ games: 5, written: 0 })
  })

  test('короче ставший список снимает хвост, чужие игры облака не трогаются', async () => {
    const local = await freshDb()
    const remote = await freshDb()
    await upsertNeighbors(
      remote,
      new Map([
        [1, [2, 3, 4].map((neighbor) => ({ neighbor, score: 0.5, shared: [] }))],
        [99, [{ neighbor: 1, score: 0.4, shared: [] }]],
      ]),
    )
    await upsertNeighbors(local, new Map([[1, [{ neighbor: 3, score: 0.7, shared: ['Roguelite'] }]]]))

    // одна строка переписана, две снесены
    expect(await publishNeighbors(local, remote)).toEqual({ games: 1, written: 3 })
    expect(await rowsOf(remote)).toEqual([
      [1, 0, 3],
      [99, 0, 1],
    ])
  })
})
