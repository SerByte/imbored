/**
 * Соседи игр для всего каталога: двенадцать похожих на каждую по всему
 * вектору тегов (lib/neighbors). Модель не зовётся нигде, сеть не нужна.
 *
 *   npm run neighbors:build                          посчитать в data/catalog.db, без сети
 *   npm run neighbors:build -- --show=1145360        плюс соседи этой игры — глазами
 *   npm run neighbors:build -- --publish             что поедет в облако — без подключения
 *   npm run neighbors:build -- --publish --yes       залить game_neighbors в Turso
 *   npm run neighbors:build -- --db=путь/к/копии.db  другая локальная база
 *
 * Пишет ВСЕГДА в локальный data/catalog.db (или --db), а не туда, куда
 * смотрит TURSO_DATABASE_URL. Облако — только отдельным шагом --publish, и
 * только с --yes: заливку на прод запускает владелец, а не опечатка в команде.
 *
 * Квота. Первая заливка — около семидесяти тысяч строк (двенадцать на игру);
 * повторная на том же каталоге пишет только изменившиеся строки
 * (upsertNeighbors), и скрипт называет, сколько записал. Перед первой
 * заливкой сверь остаток квоты записи в Turso Dashboard → Usage.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { createDb, migrateDb, type Db } from '../lib/db'
import { plural } from '../lib/plural'
import { buildNeighborTable, publishNeighbors } from './neighborsbuild'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

async function openLocal(): Promise<Db> {
  const file = path.resolve(arg('db') ?? path.join(process.cwd(), 'data', 'catalog.db'))
  if (!fs.existsSync(file)) {
    throw new Error(`нет локального каталога: ${file}. Сначала seed:catalog и catalog:promote`)
  }
  console.log(`база: ${file}`)
  return createDb(`file:${file}`)
}

async function count(db: Db): Promise<number> {
  return Number((await db.execute('SELECT COUNT(*) AS n FROM game_neighbors')).rows[0]?.n ?? 0)
}

async function main() {
  const publish = flag('publish')
  const yes = flag('yes')
  const show = arg('show')

  const local = await openLocal()

  const startedAt = Date.now()
  const built = await buildNeighborTable(local)
  console.log(
    `соседи: ${built.games.toLocaleString('ru-RU')} ${plural(built.games, 'игра', 'игры', 'игр')}, ` +
      `${built.rows.toLocaleString('ru-RU')} ${plural(built.rows, 'строка', 'строки', 'строк')} ` +
      `за ${((Date.now() - startedAt) / 1000).toFixed(1)} с`,
  )
  if (!built.weighted) {
    console.warn('карты тегов нет (tags.game_count пуст) — соседи посчитаны сырым косинусом, без веса редкости')
  }
  const lonely = [...built.lists.values()].filter((l) => l.length === 0).length
  if (lonely) console.log(`без соседей: ${lonely} — у них полка «Похожие» останется по тегу`)

  if (show) {
    const appid = Number(show)
    const list = built.lists.get(appid)
    if (!list) console.log(`\n${show}: нет в живом пуле`)
    else {
      const names = await local.execute({
        sql: 'SELECT appid, name FROM games WHERE appid IN (SELECT value FROM json_each(?))',
        args: [JSON.stringify([appid, ...list.map((n) => n.neighbor)])],
      })
      const nameOf = new Map(names.rows.map((r) => [Number(r.appid), String(r.name)]))
      console.log(`\n${nameOf.get(appid) ?? appid}:`)
      for (const nb of list) {
        console.log(`  ${nb.score.toFixed(3)}  ${nameOf.get(nb.neighbor) ?? nb.neighbor}  · ${nb.shared.join(', ')}`)
      }
    }
  }

  // ---- облако ----
  if (!publish) return
  const rows = await count(local)
  if (!yes) {
    console.log(
      `\n--publish без --yes: в облако поехали бы ${rows.toLocaleString('ru-RU')} ` +
        `${plural(rows, 'строка', 'строки', 'строк')} game_neighbors ` +
        '(записано будет меньше, если облако уже знает часть из них)',
    )
    console.log('к облаку не подключались. Залить: npm run neighbors:build -- --publish --yes')
    return
  }
  const url = process.env.TURSO_DATABASE_URL
  if (!url) throw new Error('нужен TURSO_DATABASE_URL (например, в .env.turso) — это заливка в облако')
  console.log(`\nприёмник: Turso, строк к сверке ${rows.toLocaleString('ru-RU')}`)
  // migrateDb создаст game_neighbors, если прод ещё не стартовал с новой схемой
  const remote = await migrateDb(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }))
  const res = await publishNeighbors(local, remote, (line) => console.log(line))
  console.log(
    `игр: ${res.games.toLocaleString('ru-RU')}, записано строк: ${res.written.toLocaleString('ru-RU')}; ` +
      `в облаке теперь ${(await count(remote)).toLocaleString('ru-RU')}`,
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
