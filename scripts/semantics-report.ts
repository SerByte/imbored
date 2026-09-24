/**
 * Отчёт о семантике игр: покрытие, распределения и сверка с ручной разметкой.
 *
 *   npm run semantics:report                        по data/catalog.db
 *   npm run semantics:report -- --db=путь/к.db      другая локальная база
 *   npm run semantics:report -- --remote            по облаку (TURSO_* из .env.turso), только чтение
 *
 * Выходит с кодом 1, если согласие с разметкой (scripts/semantics-golden.json)
 * ниже 70% или сверять нечего: приор, который расходится с игроками чаще
 * раза из трёх, в скоринг пускать рано. Что именно разошлось — список ниже
 * сводки; править надо таблицу TAG_PRIOR в lib/semantics.ts или разметку, а
 * не порог.
 *
 * Только чтение: ни локальную базу, ни облако отчёт не меняет.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { ALIVE_POOL, ALIVE_POOL_G, parseSemantics } from '../lib/db'
import { plural } from '../lib/plural'
import type { GameSemantics } from '../lib/types'
import {
  compareGolden,
  GOLDEN_FIELDS,
  GOLDEN_MIN_AGREEMENT,
  parseGolden,
  summarize,
} from './semanticsgold'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

/**
 * Клиент без migrateDb: отчёт только читает, и создавать таблицы в чужой базе
 * ему незачем. Нет таблицы — значит, semantics:build ещё не запускали.
 */
function open(): Client {
  if (flag('remote')) {
    const url = process.env.TURSO_DATABASE_URL
    if (!url) throw new Error('--remote: нужен TURSO_DATABASE_URL (например, в .env.turso)')
    console.log('база: Turso (облако), только чтение')
    return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
  }
  const file = path.resolve(arg('db') ?? path.join(process.cwd(), 'data', 'catalog.db'))
  if (!fs.existsSync(file)) throw new Error(`нет базы: ${file}`)
  console.log(`база: ${file}`)
  return createClient({ url: `file:${file}` })
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—')
const ru = (n: number) => n.toLocaleString('ru-RU')

function head(title: string) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`)
}

function row(label: string, counts: Record<string, number>, of: number) {
  const cells = Object.entries(counts).map(([k, n]) => `${k} ${ru(n)} (${pct(n, of)})`)
  console.log(`  ${label.padEnd(14)}${cells.join('   ')}`)
}

async function main() {
  const db = open()
  const has = await db.execute(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'game_semantics'",
  )
  if (!has.rows.length) throw new Error('таблицы game_semantics нет: сначала npm run semantics:build')

  const live = Number(
    (
      await db.execute(
        `SELECT COUNT(*) AS n FROM games WHERE ${ALIVE_POOL}`,
      )
    ).rows[0]?.n ?? 0,
  )
  const res = await db.execute(
    `SELECT s.appid, s.json, s.reviews_at FROM game_semantics s
     JOIN games g ON g.appid = s.appid
     WHERE ${ALIVE_POOL_G}`,
  )
  const byAppid = new Map<number, GameSemantics>()
  let unreadable = 0
  let reviewed = 0
  for (const r of res.rows) {
    const s = parseSemantics(r.json)
    if (!s) {
      unreadable++
      continue
    }
    byAppid.set(Number(r.appid), s)
    if (r.reviews_at !== null) reviewed++
  }
  const sum = summarize([...byAppid.values()])

  head('A. Покрытие')
  console.log(`  живых игр ${ru(live)}, с семантикой ${ru(sum.total)} (${pct(sum.total, live)})`)
  row('по basis', sum.basis, sum.total)
  console.log(`  отзывы спрошены у ${ru(reviewed)} (${pct(reviewed, sum.total)})`)
  if (unreadable) console.log(`  не читается (битая или чужая версия): ${ru(unreadable)}`)

  head('B. Длина захода')
  row('сессия', sum.session, sum.total)
  console.log(`  можно бросить в любой момент: ${ru(sum.stopAnytime)} (${pct(sum.stopAnytime, sum.total)})`)

  head('C. Время до веселья')
  row('старт', sum.timeToFun, sum.total)
  console.log(`  с числом часов из отзывов: ${ru(sum.ttfHours)}`)

  head('D. Оси')
  for (const a of ['challenge', 'complexity', 'pace'] as const) row(a, sum.axes[a], sum.total)

  head('E. Уверенность')
  const [c0, c1, c2, c3] = sum.confidence
  row('confidence', { '<0.2': c0, '0.2–0.4 (теги)': c1, '0.4–0.7': c2, '>0.7': c3 }, sum.total)

  head('F. Сверка с ручной разметкой')
  const goldenFile = path.join(process.cwd(), 'scripts', 'semantics-golden.json')
  const golden = parseGolden(JSON.parse(fs.readFileSync(goldenFile, 'utf8')))
  const cmp = compareGolden(golden, byAppid)
  console.log(`  размечено игр ${golden.length}, проверено человеком ${cmp.checked}`)
  for (const f of GOLDEN_FIELDS) {
    const { compared, agreed } = cmp.byField[f]
    if (compared) console.log(`  ${f.padEnd(12)} ${agreed} из ${compared} (${pct(agreed, compared)})`)
  }
  if (cmp.missing.length) {
    console.log(`  нет в базе: ${cmp.missing.map((g) => `${g.name} (${g.appid})`).join(', ')}`)
  }
  if (cmp.mismatches.length) {
    console.log('  расхождения (ждали → вышло):')
    for (const m of cmp.mismatches) {
      console.log(`    ${m.name} — ${m.field}: ${String(m.expected)} → ${String(m.actual)}`)
    }
  }

  if (cmp.agreement === null) {
    console.log('\nсверять нечего: ни одной размеченной игры с семантикой')
    process.exitCode = 1
    return
  }
  const verdict = cmp.agreement >= GOLDEN_MIN_AGREEMENT ? 'проходит' : 'НЕ проходит'
  console.log(
    `\nсогласие ${cmp.agreed} из ${cmp.compared} (${pct(cmp.agreed, cmp.compared)}) — ` +
      `${verdict} порог ${Math.round(GOLDEN_MIN_AGREEMENT * 100)}%`,
  )
  const draft = golden.length - cmp.checked
  if (draft) {
    console.log(
      `  без проверки ${draft} ${plural(draft, 'игра', 'игры', 'игр')} разметки — ` +
        'проверь метки руками и поставь checked: true',
    )
  }
  if (cmp.agreement < GOLDEN_MIN_AGREEMENT) process.exitCode = 1
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
