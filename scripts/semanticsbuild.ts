import {
  ALIVE_POOL_G,
  parseSemantics,
  parseTagMap,
  upsertSemantics,
  type Db,
  type SemanticsRow,
} from '../lib/db'
import { mineReviews, parseReviewsRaw } from '../lib/reviewmine'
import { fetchReviewsRaw } from '../lib/reviews'
import { deriveSemantics, SEMANTICS_V } from '../lib/semantics'

/**
 * Работа semantics:build без обвязки командной строки: приор по тегам на весь
 * каталог, проход по отзывам и заливка в облако. Отдельно от скрипта — ради
 * тестов на базе в памяти, как scripts/lease.ts и scripts/publishsql.ts.
 *
 * Модели здесь нет и не будет: семантика считается lib/semantics и
 * lib/reviewmine, а из сети — только appreviews Steam, бесплатный.
 */

/** Строк за одно чтение при обходе таблиц: каталог не держим в памяти целиком */
const PAGE = 1000

/**
 * Подряд идущие отказы appreviews, после которых проход останавливается:
 * Steam закрылся от этого IP, и дальше будут те же отказы. Число — как у
 * MAX_BLOCKED_RUN в lib/pagejob; импортировать его оттуда значило бы тянуть в
 * скрипт весь срез карточек вместе с модулем модели.
 */
export const BLOCKED_RUN = 3

/**
 * Приор по тегам для всех живых игр — без сети, секунды на весь каталог.
 *
 * Посчитанное по отзывам не затирается: это решает upsertSemantics. Поэтому
 * прогон можно повторять сколько угодно — после правки таблицы TAG_PRIOR,
 * после заливки новых тегов, просто так.
 */
export async function buildTagPrior(db: Db, nowSec: number): Promise<{ games: number }> {
  let after = Number.MIN_SAFE_INTEGER
  let games = 0
  for (;;) {
    const res = await db.execute({
      sql: `SELECT g.appid, g.tags_json FROM games g
            WHERE ${ALIVE_POOL_G} AND g.appid > ? ORDER BY g.appid LIMIT ?`,
      args: [after, PAGE],
    })
    const rows = res.rows as unknown as Array<{ appid: number; tags_json: unknown }>
    if (!rows.length) break
    await upsertSemantics(
      db,
      rows.map((r) => ({
        appid: Number(r.appid),
        semantics: deriveSemantics(parseTagMap(r.tags_json), null),
        computedAt: nowSec,
      })),
    )
    games += rows.length
    after = Number(rows[rows.length - 1].appid)
  }
  return { games }
}

/**
 * Очередь за отзывами: живые игры, за чьими отзывами ещё не ходили (или
 * ходили под старую версию формата), — сверху каталога по числу отзывов.
 *
 * Игра, которой Steam ответил, но отзывов не хватило, сюда не возвращается:
 * у неё стоит reviews_at (см. upsertSemantics). Иначе каждый запуск порцией
 * начинался бы с одних и тех же тонких игр.
 */
export async function reviewQueue(
  db: Db,
  limit: number,
): Promise<Array<{ appid: number; tags: Record<string, number> }>> {
  const res = await db.execute({
    sql: `SELECT g.appid, g.tags_json FROM games g
          LEFT JOIN game_semantics s ON s.appid = g.appid
          WHERE ${ALIVE_POOL_G} AND g.appid > 0
            AND (s.appid IS NULL OR s.reviews_at IS NULL OR s.v < ?)
          ORDER BY g.reviews_total DESC, g.appid
          LIMIT ?`,
    args: [SEMANTICS_V, limit],
  })
  return (res.rows as unknown as Array<{ appid: number; tags_json: unknown }>).map((r) => ({
    appid: Number(r.appid),
    tags: parseTagMap(r.tags_json),
  }))
}

export type ReviewPass = {
  /** Игр, по которым Steam ответил и семантика записана */
  answered: number
  /** Из них — с basis 'tags+reviews': отзывов хватило сдвинуть оси */
  withReviews: number
  /** Отказов сети (игра остаётся в очереди) */
  failed: number
  stopped: 'done' | 'blocked'
}

/**
 * Проход по отзывам для limit игр из очереди. Каждый запрос идёт через
 * pace('steam-store') внутри fetchReviewsRaw: полторы-две секунды на игру,
 * пятьсот игр — около четверти часа.
 *
 * Запись — после каждой игры, а не пачкой в конце: прерванный прогон
 * (Ctrl+C, блок Steam) не теряет того, что уже спросил.
 */
export async function reviewPass(
  db: Db,
  opts: {
    limit: number
    /** часы подменяются в тестах; по умолчанию — настоящее время на каждую игру */
    now?: () => number
    fetchRaw?: (appid: number) => Promise<unknown>
    onProgress?: (line: string) => void
  },
): Promise<ReviewPass> {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000))
  const fetchRaw = opts.fetchRaw ?? ((appid: number) => fetchReviewsRaw(appid))
  const log = opts.onProgress ?? (() => {})
  const queue = await reviewQueue(db, opts.limit)

  let answered = 0
  let withReviews = 0
  let failed = 0
  let failedRun = 0
  let stopped: ReviewPass['stopped'] = 'done'

  for (const { appid, tags } of queue) {
    let raw: unknown
    try {
      raw = await fetchRaw(appid)
    } catch (err) {
      failed++
      failedRun++
      log(`  ${appid}: ${err instanceof Error ? err.message : String(err)}`)
      if (failedRun >= BLOCKED_RUN) {
        stopped = 'blocked'
        break
      }
      continue
    }
    failedRun = 0
    const all = parseReviewsRaw(raw)
    const semantics = deriveSemantics(tags, all ? mineReviews(all) : null)
    const at = now()
    await upsertSemantics(db, [{ appid, semantics, computedAt: at, reviewsAt: at }])
    answered++
    if (semantics.basis === 'tags+reviews') withReviews++
    if (answered % 25 === 0) {
      log(`  ${answered} из ${queue.length}: с отзывами ${withReviews}, отказов ${failed}`)
    }
  }
  return { answered, withReviews, failed, stopped }
}

/**
 * Локальная семантика — в облако, по тем же правилам upsertSemantics: приор
 * по тегам не затрёт того, что крон страниц уже посчитал в проде по отзывам,
 * а старое не откатит свежее.
 *
 * Строка, которая не читается (битый json, чужая версия), не едет: в облаке
 * она была бы тем же «семантики нет», только занимала бы место.
 */
export async function publishSemantics(
  local: Db,
  remote: Db,
  onProgress?: (line: string) => void,
): Promise<{ sent: number; skipped: number }> {
  let after = Number.MIN_SAFE_INTEGER
  let sent = 0
  let skipped = 0
  for (;;) {
    const res = await local.execute({
      sql: `SELECT appid, json, computed_at, reviews_at FROM game_semantics
            WHERE appid > ? ORDER BY appid LIMIT ?`,
      args: [after, PAGE],
    })
    const rows = res.rows as unknown as Array<{
      appid: number
      json: unknown
      computed_at: number
      reviews_at: number | null
    }>
    if (!rows.length) break
    const batch: SemanticsRow[] = []
    for (const r of rows) {
      const semantics = parseSemantics(r.json)
      if (!semantics) {
        skipped++
        continue
      }
      batch.push({
        appid: Number(r.appid),
        semantics,
        computedAt: Number(r.computed_at),
        reviewsAt: r.reviews_at === null ? null : Number(r.reviews_at),
      })
    }
    await upsertSemantics(remote, batch)
    sent += batch.length
    after = Number(rows[rows.length - 1].appid)
    onProgress?.(`  семантика: ${sent.toLocaleString('ru-RU')}`)
  }
  return { sent, skipped }
}
