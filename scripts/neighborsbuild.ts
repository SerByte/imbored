import { loadTagStats, upsertNeighbors, type Db } from '../lib/db'
import { buildNeighbors, type Neighbor, type NeighborGame } from '../lib/neighbors'
import { tagWeightFrom } from '../lib/tagweight'

/**
 * Работа neighbors:build без обвязки командной строки: векторы из game_tags,
 * соседи по lib/neighbors, запись в локальную базу и заливка в облако.
 * Отдельно от скрипта — ради тестов на базе в памяти, как semanticsbuild.
 *
 * Сети и модели здесь нет: всё считается из того, что уже лежит в каталоге.
 */

/** Живая игра пула — тот же предикат, что у ALIVE_POOL в lib/db */
const LIVE = 'g.alive = 1 AND g.superseded_by IS NULL AND g.tag_count > 0'

/** Игр за одно чтение при обходе локальной таблицы соседей */
const PAGE = 500

/**
 * Векторы живых игр из game_tags — топ тегов каждой игры, тот же, по которому
 * идёт полка по тегу и пул открытий. Одним чтением: база локальная, а соседей
 * без всех векторов сразу не посчитать.
 */
export async function loadNeighborGames(db: Db): Promise<NeighborGame[]> {
  const res = await db.execute(
    `SELECT g.appid, g.name, g.reviews_total, gt.tag, gt.weight
     FROM games g JOIN game_tags gt ON gt.appid = g.appid
     WHERE ${LIVE}
     ORDER BY g.appid`,
  )
  const byAppid = new Map<number, NeighborGame>()
  for (const r of res.rows as unknown as Array<{
    appid: number
    name: string
    reviews_total: number | null
    tag: string
    weight: number
  }>) {
    const appid = Number(r.appid)
    let g = byAppid.get(appid)
    if (!g) {
      g = { appid, name: String(r.name ?? ''), tags: {}, reviewsTotal: Number(r.reviews_total ?? 0) }
      byAppid.set(appid, g)
    }
    g.tags[String(r.tag)] = Number(r.weight)
  }
  return [...byAppid.values()]
}

/** Счёт на хранение: четыре знака — порядок тот же, а пересборка не переписывает строки из-за шума */
const roundScore = (s: number) => Math.round(s * 10_000) / 10_000

/**
 * Соседи всего каталога — в локальную базу. Строки игр, которых в пуле больше
 * нет, снимаются: локальная таблица — ровно последний расчёт, и заливка везёт
 * именно его.
 */
export async function buildNeighborTable(
  db: Db,
): Promise<{ games: number; rows: number; weighted: boolean; lists: Map<number, Neighbor[]> }> {
  const games = await loadNeighborGames(db)
  const w = tagWeightFrom(await loadTagStats(db))
  const built = buildNeighbors(games, w)
  const lists = new Map<number, Neighbor[]>()
  let rows = 0
  for (const [appid, list] of built) {
    lists.set(
      appid,
      list.map((nb) => ({ ...nb, score: roundScore(nb.score) })),
    )
    rows += list.length
  }
  await upsertNeighbors(db, lists)
  await db.execute({
    sql: 'DELETE FROM game_neighbors WHERE appid NOT IN (SELECT value FROM json_each(?))',
    args: [JSON.stringify([...lists.keys()])],
  })
  return { games: games.length, rows, weighted: w !== null, lists }
}

/**
 * Локальная таблица соседей — в облако, по спискам игр.
 *
 * Список игры заменяется целиком, совпавшие строки не переписываются
 * (upsertNeighbors), а игр, которых локально нет, заливка не трогает: у облака
 * может быть своё мнение о пуле, и стирать по чужому снимку — не её дело.
 * Отдаёт, сколько игр проехало и сколько строк реально записано — столько
 * спишется с квоты записи Turso.
 */
export async function publishNeighbors(
  local: Db,
  remote: Db,
  onProgress?: (line: string) => void,
): Promise<{ games: number; written: number }> {
  let after = Number.MIN_SAFE_INTEGER
  let games = 0
  let written = 0
  for (;;) {
    const ids = await local.execute({
      sql: 'SELECT DISTINCT appid FROM game_neighbors WHERE appid > ? ORDER BY appid LIMIT ?',
      args: [after, PAGE],
    })
    const appids = ids.rows.map((r) => Number(r.appid))
    if (!appids.length) break
    const res = await local.execute({
      sql: `SELECT appid, rank, neighbor, score, shared_json FROM game_neighbors
            WHERE appid IN (SELECT value FROM json_each(?)) ORDER BY appid, rank`,
      args: [JSON.stringify(appids)],
    })
    const lists = new Map<number, Neighbor[]>(appids.map((a) => [a, []]))
    for (const r of res.rows as unknown as Array<{
      appid: number
      neighbor: number
      score: number
      shared_json: string
    }>) {
      let shared: string[] = []
      try {
        const v = JSON.parse(String(r.shared_json)) as unknown
        if (Array.isArray(v)) shared = v.filter((t): t is string => typeof t === 'string')
      } catch {
        // битая подпись — не повод терять соседа
      }
      lists.get(Number(r.appid))!.push({ neighbor: Number(r.neighbor), score: Number(r.score), shared })
    }
    written += (await upsertNeighbors(remote, lists)).written
    games += appids.length
    after = appids[appids.length - 1]
    onProgress?.(`  соседи: ${games.toLocaleString('ru-RU')} игр, записано строк ${written.toLocaleString('ru-RU')}`)
  }
  return { games, written }
}
