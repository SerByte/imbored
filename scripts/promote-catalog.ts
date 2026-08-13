/**
 * Перенос игр из карты территории в рабочий пул рекомендаций.
 *
 *   npm run catalog:promote -- --limit=3000
 *
 * Карта территории (catalog_ingest) — это все ~170 тысяч игр Steam. Показывать
 * из них можно далеко не всё: асет-флипы, мёртвые мультиплееры и устаревшие
 * версии в выдаче не нужны. Этот скрипт отбирает достойное, догружает глубину
 * и раскладывает по таблицам, из которых читает рантайм.
 *
 * Порядок такой:
 *   1. берём самые обсуждаемые игры, которых ещё нет в пуле;
 *   2. одним батчем на 200 штук тянем теги с весами, категории и арт;
 *   3. для совместных игр спрашиваем отзывы за 30 дней — сигнал «живо ли это»;
 *   4. считаем живость и устаревшие версии внутри серий;
 *   5. пишем games + game_tags, откуда и берёт кандидатов lib/pool.
 *
 * Допустимость решается ЗДЕСЬ, офлайн. Рантайм только читает — поэтому
 * актуальность физически не может протечь в скоринг и перебить личный вкус.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  createDb,
  loadTagDictionary,
  nextIngestBatch,
  rebuildTagStats,
  replaceGameTags,
  saveTagDictionary,
  setIngestStatus,
  upsertGameMeta,
  type Db,
} from '../lib/db'
import { fetchStoreItems, fetchTagDictionary } from '../lib/catalog'
import { fetchCurrentPlayers, fetchRecentReviews } from '../lib/ingest'
import { judgeLiveness, playMode } from '../lib/liveness'
import { buildSeriesIndex, type SeriesMember } from '../lib/series'
import type { GameMeta } from '../lib/types'

const STORE_BATCH = 200
/** Топ-N тегов на игру: хвост на косинус почти не влияет, а строк экономит кратно */
const TAGS_PER_GAME = 12
const REVIEW_PACE_MS = 250
const STORE_PACE_MS = 1500

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Отступаем на таймаутах и лимитах, а не роняем прогон на тысячи игр */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const wait = Math.min(5000 * 2 ** attempt, 60_000)
      console.warn(`  ${label}: ${(err as Error).message}; жду ${Math.round(wait / 1000)}с`)
      await sleep(wait)
    }
  }
  return null
}

async function openDb(): Promise<Db> {
  const remote = process.env.TURSO_DATABASE_URL
  if (remote) {
    console.log('база: Turso (облако)')
    return createDb(remote, process.env.TURSO_AUTH_TOKEN)
  }
  const dir = path.join(process.cwd(), 'data')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'catalog.db')
  console.log(`база: ${file}`)
  return createDb(`file:${file}`)
}

/** Топ-N тегов по весу — в проекцию, из которой идёт выборка кандидатов */
function topTags(tags: Record<string, number>): Array<{ tag: string; weight: number }> {
  const sorted = Object.entries(tags).sort((a, b) => b[1] - a[1])
  const max = sorted[0]?.[1] ?? 0
  if (!max) return []
  // вес = характерность (доля от главного тега игры), а не популярность:
  // «топ по тегу Roguelike» должен давать самые рогаликовые игры, а не самые продаваемые
  return sorted.slice(0, TAGS_PER_GAME).map(([tag, weight]) => ({
    tag,
    weight: Math.round((weight / max) * 1000),
  }))
}

async function main() {
  const limit = Number(arg('limit') ?? 2000)
  const db = await openDb()
  const nowSec = Math.floor(Date.now() / 1000)

  let tagNames = await loadTagDictionary(db)
  if (!tagNames.size) {
    tagNames = await fetchTagDictionary()
    await saveTagDictionary(db, tagNames)
    console.log(`словарь тегов: ${tagNames.size}`)
  }

  // Перенос идёт по игре за раз, но серии определяются по группе целиком:
  // чтобы пересчитать решения после правки логики, берём и уже перенесённые
  if (process.argv.includes('--redo')) {
    await db.execute("UPDATE catalog_ingest SET status = 'seen' WHERE status = 'promoted'")
  }

  const queue = await nextIngestBatch(db, 'seen', limit)
  if (!queue.length) {
    console.log('очередь пуста — карта территории ещё не наполнена или всё уже перенесено')
    return
  }
  console.log(`в очереди: ${queue.length}\n`)

  const metas: GameMeta[] = []
  const done: number[] = []
  for (let i = 0; i < queue.length; i += STORE_BATCH) {
    const chunk = queue.slice(i, i + STORE_BATCH)
    const fetched = await withRetry(`батч ${i}`, () =>
      fetchStoreItems(
        chunk.map((r) => r.appid),
        { tagNames },
      ),
    )
    if (fetched === null) {
      // Steam перестал отвечать: останавливаемся, а не крутим вхолостую.
      // Необработанные игры остаются в очереди и догрузятся следующим прогоном.
      console.warn('  Steam не отвечает, останавливаюсь — очередь сохранена')
      break
    }
    done.push(...chunk.map((r) => r.appid))

    // сигналы из карты территории уже есть, переносим их на метаданные
    const byAppid = new Map(chunk.map((r) => [r.appid, r]))
    for (const m of fetched) {
      const src = byAppid.get(m.appid)
      if (src?.releaseYear) m.releaseYear = src.releaseYear
      if (src?.reviewsTotal) m.reviewsTotal = src.reviewsTotal
      if (src?.reviewsPercent) m.reviewsPercent = src.reviewsPercent
      if (src?.priceFinal !== undefined && m.priceFinal === undefined) m.priceFinal = src.priceFinal
    }
    metas.push(...fetched)
    console.log(`глубина: ${metas.length}/${queue.length}`)
    await sleep(STORE_PACE_MS)
  }

  // Сигналы спрашиваем только у совместных игр: живость гейтит только их,
  // а поштучный запрос на весь пул стоил бы часы. Онлайн важнее отзывов —
  // он резче отделяет мёртвое, поэтому берём его первым.
  const multiplayer = metas.filter((m) => isMultiplayer(m))
  console.log(`\nсигналы для ${multiplayer.length} совместных игр…`)
  for (const [i, m] of multiplayer.entries()) {
    m.ccu = await fetchCurrentPlayers(m.appid).catch(() => undefined)
    await sleep(REVIEW_PACE_MS)
    m.reviews30d = await fetchRecentReviews(m.appid, nowSec).catch(() => undefined)
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${multiplayer.length}`)
    await sleep(REVIEW_PACE_MS)
  }

  // живость
  const verdicts = new Map<number, ReturnType<typeof judgeLiveness>>()
  for (const m of metas) {
    verdicts.set(
      m.appid,
      judgeLiveness({
        categories: m.categories,
        ccu: m.ccu,
        reviews30d: m.reviews30d,
        reviewsTotal: m.reviewsTotal,
        reviewsPercent: m.reviewsPercent,
      }),
    )
  }

  // устаревшие версии внутри серий
  const members: SeriesMember[] = metas.map((m) => ({
    appid: m.appid,
    name: m.name,
    isMultiplayer: isMultiplayer(m),
    alive: verdicts.get(m.appid)?.alive ?? true,
    soloCapable: playMode(m.categories) === 'solo-capable',
    // сигнал «аудитория переехала»: онлайн точнее, отзывы — запасной вариант
    ...((m.ccu ?? m.reviews30d) !== undefined ? { audience: m.ccu ?? m.reviews30d } : {}),
    ...(m.releaseYear !== undefined ? { releaseYear: m.releaseYear } : {}),
    ...(m.developer ? { developer: m.developer } : {}),
    ...(m.publisher ? { publisher: m.publisher } : {}),
  }))
  const superseded = buildSeriesIndex(members)

  // запись
  let promoted = 0
  let dropped = 0
  for (const m of metas) {
    const verdict = verdicts.get(m.appid) ?? { alive: true, reason: null }
    const replacedBy = superseded.get(m.appid) ?? null
    await upsertGameMeta(db, m, nowSec)
    await db.execute({
      sql: 'UPDATE games SET alive = ?, dead_reason = ?, superseded_by = ?, signals_at = ? WHERE appid = ?',
      args: [verdict.alive ? 1 : 0, verdict.reason, replacedBy, nowSec, m.appid],
    })

    const eligible = verdict.alive && replacedBy === null && Object.keys(m.tags).length > 0
    // В проекции лежат только допустимые игры: иначе «топ-60 по тегу» вернул бы
    // мертвецов, JS отфильтровал бы их, и выдача осталась бы пустой
    await replaceGameTags(db, m.appid, eligible ? topTags(m.tags) : [])
    if (eligible) promoted++
    else dropped++
  }

  // Помечаем только то, что реально обработали: иначе сорванный прогон
  // «съел» бы тысячи игр, не записав по ним ничего
  await setIngestStatus(db, done, 'promoted')
  await rebuildTagStats(db)

  const reasons = new Map<string, number>()
  for (const [appid, v] of verdicts) {
    const key = superseded.has(appid) ? 'устаревшая версия' : (v.reason ?? '')
    if (key) reasons.set(key, (reasons.get(key) ?? 0) + 1)
  }

  console.log(`\nв пул: ${promoted}, отсеяно: ${dropped}`)
  for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`)
  }
  const examples = [...superseded.entries()].slice(0, 12)
  if (examples.length) {
    const names = new Map(metas.map((m) => [m.appid, m.name]))
    console.log('\nвытеснены как устаревшие версии:')
    for (const [oldId, newId] of examples) {
      console.log(`  ${names.get(oldId) ?? oldId}  →  ${names.get(newId) ?? newId}`)
    }
  }
}

const MULTIPLAYER_IDS = new Set([1, 9, 24, 36, 38, 39, 49])
function isMultiplayer(m: GameMeta): boolean {
  return m.categories.some((c) => MULTIPLAYER_IDS.has(c))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
