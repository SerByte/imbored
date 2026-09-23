/**
 * Починка JSON-колонок игр в локальном каталоге.
 *
 *   npm run catalog:repair-tags -- --dry-run         показать, что починится
 *   npm run catalog:repair-tags                      починить data/catalog.db
 *   npm run catalog:repair-tags -- --file=<путь>     другой файл, например копию
 *
 * Что чинится. У части игр tags_json оказался закодирован дважды: в колонке
 * не объект, а JSON-строка с объектом внутри. Приложение такое уже читает
 * (parseTagMap в lib/db.ts), но tag_count у этих строк врёт, а catalog:publish
 * теперь отказывается везти их в облако. Дважды закодированное разворачивается
 * без потерь; что не разбирается вовсе, становится пустым — так его и видело
 * приложение. Правило одно на всех: repairGameJson.
 *
 * Облако этот скрипт не трогает и переменные TURSO_* не читает: продовую базу
 * один раз чинит сама миграция (repair_tags_v1 в migrateDb) при первом старте
 * после деплоя. Порядок для владельца — в DEPLOY.md, раздел 6.5.
 *
 * Файл открывается голым клиентом, без migrateDb: миграция сама починила бы
 * строки при открытии, и --dry-run показал бы пустоту.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { repairGameJson } from '../lib/db'

/** Сколько строк показать в отчёте поимённо */
const SHOW = 30

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const file = path.resolve(arg('file') ?? path.join(process.cwd(), 'data', 'catalog.db'))
  if (!fs.existsSync(file)) {
    throw new Error(`нет файла базы: ${file}. Сначала seed:catalog и catalog:promote`)
  }
  console.log(`база: ${file}`)

  const db = createClient({ url: `file:${file}` })
  const report = await repairGameJson(db, { dryRun })

  if (!report.length) {
    console.log('битых JSON-колонок нет, чинить нечего')
    return
  }

  const emptied = report.filter((r) => r.tags === 0)
  console.log(
    `\nбитых строк: ${report.length}; развернулось с тегами: ${report.length - emptied.length}, ` +
      `без тегов после разбора: ${emptied.length}`,
  )
  for (const r of report.slice(0, SHOW)) {
    console.log(`  ${String(r.appid).padStart(8)}  ${r.name} — тегов: ${r.tags}`)
  }
  if (report.length > SHOW) console.log(`  … и ещё ${report.length - SHOW}`)

  console.log(dryRun ? '\n--dry-run: ничего не записано' : '\nготово: строки переписаны')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
