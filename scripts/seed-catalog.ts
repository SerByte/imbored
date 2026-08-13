/**
 * Наполнение большого каталога игр. Запускается вручную, не в рантайме запроса.
 *
 *   npm run seed:catalog -- --pages=20          пробный прогон на 2000 играх
 *   npm run seed:catalog                        весь каталог (~170 тысяч, 10-15 минут)
 *   npm run seed:catalog -- --dry-run           только показать, что распарсилось
 *
 * По умолчанию пишет в локальный файл data/catalog.db: отладка прямо по Turso
 * сожгла бы квоту записей. Чтобы залить в облако, задайте TURSO_DATABASE_URL.
 *
 * Прогон возобновляемый: курсор страницы хранится в catalog_meta, повторный
 * запуск продолжает с места обрыва, а не начинает заново.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createDb, countIngest, getCatalogMeta, setCatalogMeta, upsertIngestRows } from '../lib/db'
import { fetchSearchPage, SEARCH_PAGE_SIZE } from '../lib/ingest'

const CURSOR_KEY = 'search_start'
/** Steam отдаёт 429 при бёрсте; на такой паузе полный обход занимает ~12 минут */
const PACE_MS = 350
const MAX_RETRIES = 5

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function openDb() {
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

/** Отступаем на 429 и сетевых сбоях, а не падаем: обход длинный */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const wait = Math.min(5000 * 2 ** attempt, 120_000)
      console.warn(`  ${label}: ${(err as Error).message}; жду ${Math.round(wait / 1000)}с`)
      await sleep(wait)
    }
  }
  console.error(`  ${label}: не удалось после ${MAX_RETRIES} попыток, пропускаю`)
  return null
}

async function main() {
  const dryRun = flag('dry-run')
  const maxPages = Number(arg('pages') ?? Number.POSITIVE_INFINITY)
  const restart = flag('restart')

  const db = await openDb()
  if (restart) await setCatalogMeta(db, CURSOR_KEY, '0')

  let start = Number((await getCatalogMeta(db, CURSOR_KEY)) ?? 0)
  if (!Number.isFinite(start) || start < 0) start = 0

  const first = await fetchSearchPage(start)
  const total = first.totalCount
  console.log(`всего игр в каталоге: ${total.toLocaleString('ru-RU')}`)
  console.log(`старт со страницы ${Math.floor(start / SEARCH_PAGE_SIZE) + 1}\n`)

  if (dryRun) {
    console.log(`распарсено строк: ${first.rows.length}`)
    for (const r of first.rows.slice(0, 5)) {
      console.log(
        `  ${r.appid}\t${r.name.slice(0, 42).padEnd(42)}` +
          `теги:${r.tagids.length}\tгод:${r.releaseYear ?? '—'}\t` +
          `отзывы:${r.reviewsTotal ?? '—'} (${r.reviewsPercent ?? '—'}%)`,
      )
    }
    const withTags = first.rows.filter((r) => r.tagids.length).length
    const withYear = first.rows.filter((r) => r.releaseYear).length
    const withReviews = first.rows.filter((r) => r.reviewsTotal).length
    console.log(
      `\nпокрытие на странице: теги ${withTags}/${first.rows.length}, ` +
        `год ${withYear}/${first.rows.length}, отзывы ${withReviews}/${first.rows.length}`,
    )
    return
  }

  const nowSec = Math.floor(Date.now() / 1000)
  let pages = 0
  let saved = 0

  let page: typeof first | null = first
  while (page && page.rows.length && pages < maxPages && start < total) {
    // Запись тоже под повтор: локальный файл может быть занят соседним
    // скриптом, и ронять из-за этого часовой прогон незачем
    const rows = page.rows
    const written = await withRetry('запись', async () => {
      await upsertIngestRows(db, rows, nowSec)
      return true
    })
    if (!written) break
    saved += page.rows.length
    start += SEARCH_PAGE_SIZE
    pages++
    await setCatalogMeta(db, CURSOR_KEY, String(start))

    if (pages % 10 === 0 || start >= total) {
      const pct = Math.min(100, Math.round((start / total) * 100))
      console.log(`${pct}%\tстраниц: ${pages}\tзаписано: ${saved.toLocaleString('ru-RU')}`)
    }
    if (pages >= maxPages || start >= total) break

    await sleep(PACE_MS)
    page = await withRetry(`страница ${start}`, () => fetchSearchPage(start))
  }

  const inDb = await countIngest(db)
  console.log(`\nготово. в каталоге: ${inDb.toLocaleString('ru-RU')} игр`)
  if (start < total) console.log(`продолжить: npm run seed:catalog (курсор на ${start})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
