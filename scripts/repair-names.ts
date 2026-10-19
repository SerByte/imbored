/**
 * Английские названия играм, у которых в games.name лежит русское.
 *
 *   npm run catalog:repair-names -- --dry-run         показать, что починится
 *   npm run catalog:repair-names                      починить
 *   npm run catalog:repair-names -- --file=<путь>     другой файл базы, например копию
 *
 * Куда пишет — как все скрипты наполнения (scripts/opendb.ts): в
 * data/catalog.db, а с TURSO_DATABASE_URL — в облако. --dry-run на облаке
 * открывает его без миграций (openCloud с readOnly): посмотреть не значит
 * довести прод до схемы ветки.
 *
 * Что чинится. До раскладки названий по колонкам (НАЗВАНИЕ в lib/db.ts)
 * карточка клала русское имя магазина поверх английского. Апсерт теперь сам
 * уводит русское во второе название (name_ru), но только при английской
 * записи — а прогрев переписывает игру, лишь когда она протухла в чьей-то
 * библиотеке. На проде 19.10.2026 так стояли 80 игр из 5921, и на /en шли
 * русскими в <title>, og и JSON-LD — «Is Ведьмак 3: Дикая Охота — Обновлённое
 * издание worth playing?», — а английский поиск не находил «witcher 3» и
 * «last of us». Этот проход — та же английская запись сразу
 * (repairRussianNames в lib/catalog): один GetItems на двести игр.
 *
 * Игры, которые магазин и по-английски зовёт по-русски («ЕСТЬ ДВА СТУЛА»,
 * «Скуф на рыбалке»), не трогаются — это данные. Отчёт называет их отдельно.
 *
 * ПОСЛЕ ПРОХОДА — REDEPLOY, как после catalog:media: карточки /game/… и хабы
 * лежат в кэше ISR, индекс поиска (/search-index.json) перегенерируется раз в
 * сутки, и вне сервера Next сбросить их нечем (DEPLOY.md). Сколько таких
 * строк осталось — строкой в npm run catalog:report.
 */

import fs from 'node:fs'
import path from 'node:path'
import { repairRussianNames } from '../lib/catalog'
import { createDb, type Db } from '../lib/db'
import { openCloud, openDb } from './opendb'

/** Сколько строк показать в отчёте поимённо */
const SHOW = 100

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

async function open(dryRun: boolean): Promise<Db> {
  const file = arg('file')
  if (file) {
    const abs = path.resolve(file)
    if (!fs.existsSync(abs)) throw new Error(`нет файла базы: ${abs}`)
    console.log(`база: ${abs}`)
    return createDb(`file:${abs}`)
  }
  const remote = process.env.TURSO_DATABASE_URL
  if (remote && dryRun) {
    console.log('база: Turso (облако), только чтение')
    return openCloud(remote, process.env.TURSO_AUTH_TOKEN, { readOnly: true })
  }
  return openDb()
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const db = await open(dryRun)
  const { fixed, kept, missing } = await repairRussianNames(db, { dryRun })

  if (!fixed.length && !kept.length && !missing.length) {
    console.log('русских названий без второго нет, чинить нечего')
    return
  }
  console.log(`\nанглийское название есть: ${fixed.length}`)
  for (const r of fixed.slice(0, SHOW)) console.log(`  ${String(r.appid).padStart(8)}  ${r.from}  →  ${r.to}`)
  if (fixed.length > SHOW) console.log(`  … и ещё ${fixed.length - SHOW}`)
  if (kept.length) {
    console.log(`\nмагазин и по-английски зовёт по-русски (не трогаем): ${kept.length}`)
    for (const r of kept.slice(0, SHOW)) console.log(`  ${String(r.appid).padStart(8)}  ${r.from}`)
  }
  if (missing.length) {
    console.log(`\nGetItems не ответил (снята с продажи, чужой регион): ${missing.length}`)
    console.log(`  ${missing.slice(0, SHOW).join(', ')}`)
  }
  console.log(dryRun ? '\n--dry-run: ничего не записано' : '\nготово: строки переписаны — теперь redeploy')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
