/**
 * Что каталог решил и почему — для глазного ревью.
 *
 *   npm run catalog:report
 *   npm run catalog:report -- --name=counter
 *
 * Вытеснение версий — главный репутационный риск всей затеи: «почему мне
 * никогда не показывают Portal?» хуже, чем «показали CS 1.6». Поэтому решения
 * должны быть видимы, а не растворяться в базе.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createDb, type Db } from '../lib/db'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

async function openDb(): Promise<Db> {
  const remote = process.env.TURSO_DATABASE_URL
  if (remote) return createDb(remote, process.env.TURSO_AUTH_TOKEN)
  const file = path.join(process.cwd(), 'data', 'catalog.db')
  if (!fs.existsSync(file)) throw new Error(`нет базы каталога: ${file}`)
  return createDb(`file:${file}`)
}

async function main() {
  const db = await openDb()
  const name = arg('name')

  const totals = await db.execute(`SELECT
      (SELECT COUNT(*) FROM catalog_ingest) AS ingest,
      (SELECT COUNT(*) FROM games) AS games,
      (SELECT COUNT(*) FROM game_tags) AS tags,
      (SELECT COUNT(*) FROM games WHERE alive = 0) AS dead,
      (SELECT COUNT(*) FROM games WHERE superseded_by IS NOT NULL) AS old`)
  const t = totals.rows[0]
  console.log('карта территории:', Number(t.ingest).toLocaleString('ru-RU'))
  console.log('в пуле:          ', Number(t.games).toLocaleString('ru-RU'))
  console.log('строк тегов:     ', Number(t.tags).toLocaleString('ru-RU'))
  console.log('отсеяно живостью:', Number(t.dead))
  console.log('устаревших версий:', Number(t.old))

  const reasons = await db.execute(
    'SELECT dead_reason AS r, COUNT(*) AS n FROM games WHERE dead_reason IS NOT NULL GROUP BY r ORDER BY n DESC',
  )
  if (reasons.rows.length) {
    console.log('\nпричины отсева:')
    for (const row of reasons.rows) console.log(`  ${row.r}: ${row.n}`)
  }

  const sup = await db.execute(`SELECT o.name AS old_name, o.reviews_30d AS old_recent,
      n.name AS new_name, n.reviews_30d AS new_recent
    FROM games o JOIN games n ON n.appid = o.superseded_by
    WHERE o.superseded_by IS NOT NULL ORDER BY n.reviews_30d DESC LIMIT 40`)
  if (sup.rows.length) {
    console.log('\nвытеснены как устаревшие версии:')
    for (const r of sup.rows) {
      console.log(
        `  ${String(r.old_name).slice(0, 34).padEnd(34)} (${r.old_recent ?? '—'})` +
          `  →  ${String(r.new_name).slice(0, 34)} (${r.new_recent ?? '—'})`,
      )
    }
  }

  if (name) {
    const found = await db.execute({
      sql: `SELECT appid, name, alive, dead_reason, superseded_by, reviews_total, reviews_30d,
                   is_multiplayer, tag_count
            FROM games WHERE lower(name) LIKE ? ORDER BY reviews_total DESC LIMIT 25`,
      args: [`%${name.toLowerCase()}%`],
    })
    console.log(`\nпоиск «${name}»:`)
    for (const r of found.rows) {
      const state = r.superseded_by
        ? `устарела → ${r.superseded_by}`
        : Number(r.alive)
          ? 'актуальна'
          : `отсеяна: ${r.dead_reason}`
      console.log(
        `  ${String(r.appid).padEnd(8)}${String(r.name).slice(0, 38).padEnd(38)}` +
          `отз:${String(r.reviews_total ?? '—').padEnd(9)}за30д:${String(r.reviews_30d ?? '—').padEnd(8)}${state}`,
      )
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
