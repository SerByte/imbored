import {
  ALIVE_POOL_G,
  loadTagStats,
  parseIdList,
  parseSemantics,
  SEMANTICS_JOIN,
  upsertNeighbors,
  type Db,
} from '../lib/db'
import { buildNeighbors, playModeOf, type Neighbor, type NeighborGame } from '../lib/neighbors'
import { SEMANTICS_MIN_CONFIDENCE } from '../lib/semantics'
import { tagWeightFrom } from '../lib/tagweight'

/**
 * Работа neighbors:build без обвязки командной строки: векторы из game_tags,
 * соседи по lib/neighbors, запись в локальную базу и заливка в облако.
 * Отдельно от скрипта — ради тестов на базе в памяти, как semanticsbuild.
 *
 * Сети и модели здесь нет: всё считается из того, что уже лежит в каталоге.
 */

/** Игр за одно чтение при обходе локальной таблицы соседей */
const PAGE = 500

/**
 * Векторы живых игр из game_tags — топ тегов каждой игры, тот же, по которому
 * идёт полка по тегу и пул открытий, — и то, по чему соседи судят, как в игру
 * играют (lib/neighbors): режим по категориям Steam, доля положительных
 * отзывов и уверенная семантика. Двумя чтениями, а не одним JOIN: строка игры
 * с семантикой повторилась бы на каждый из двенадцати её тегов. База
 * локальная, а соседей без всех векторов сразу не посчитать.
 *
 * Семантика ниже SEMANTICS_MIN_CONFIDENCE не кладётся: по одним тегам она
 * повторяет сами теги (см. NeighborFeel), и поправка за ощущение услышала бы
 * их второй раз.
 */
export async function loadNeighborGames(db: Db): Promise<NeighborGame[]> {
  const games = await db.execute(
    `SELECT g.appid, g.name, g.reviews_total, g.reviews_percent, g.categories_json, s.json AS semantics_json
     FROM games g ${SEMANTICS_JOIN}
     WHERE ${ALIVE_POOL_G}
     ORDER BY g.appid`,
  )
  const byAppid = new Map<number, NeighborGame>()
  for (const r of games.rows as unknown as Array<{
    appid: number
    name: string
    reviews_total: number | null
    reviews_percent: number | null
    categories_json: string | null
    semantics_json: string | null
  }>) {
    const appid = Number(r.appid)
    const g: NeighborGame = { appid, name: String(r.name ?? ''), tags: {}, reviewsTotal: Number(r.reviews_total ?? 0) }
    const mode = playModeOf(parseIdList(r.categories_json))
    if (mode) g.mode = mode
    if (r.reviews_percent !== null && r.reviews_percent !== undefined) g.percent = Number(r.reviews_percent)
    const sem = parseSemantics(r.semantics_json)
    if (sem && sem.confidence >= SEMANTICS_MIN_CONFIDENCE) {
      g.feel = { session: sem.session.bucket, pace: sem.axes.pace }
    }
    byAppid.set(appid, g)
  }
  const tags = await db.execute(
    `SELECT gt.appid, gt.tag, gt.weight
     FROM games g JOIN game_tags gt ON gt.appid = g.appid
     WHERE ${ALIVE_POOL_G}`,
  )
  for (const r of tags.rows as unknown as Array<{ appid: number; tag: string; weight: number }>) {
    const g = byAppid.get(Number(r.appid))
    if (g) g.tags[String(r.tag)] = Number(r.weight)
  }
  // Игра пула без единой строки game_tags соседей не получает и соседом не
  // бывает — как и при прежнем JOIN
  return [...byAppid.values()].filter((g) => Object.keys(g.tags).length > 0)
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
