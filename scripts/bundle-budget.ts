/**
 * npm run budget — сверить вес первой загрузки с bundle-budget.json.
 *
 * Запускается после `next build`: читает то, что сборка уже записала, и сама
 * ничего не собирает. Логика и объяснение — в scripts/bundlebudget.ts.
 */
import fs from 'node:fs'
import path from 'node:path'
import { plural } from '../lib/plural'
import { checkBudget, type Budget, type RouteStat } from './bundlebudget'

const ROOT = path.join(__dirname, '..')
const read = <T>(p: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')) as T

const STATS = '.next/diagnostics/route-bundle-stats.json'
if (!fs.existsSync(path.join(ROOT, STATS))) {
  console.error(`Нет ${STATS}: сначала npm run build.`)
  process.exit(1)
}

const stats = read<RouteStat[]>(STATS)
const budget = read<Budget>('bundle-budget.json')
const prerendered = Object.keys(read<{ routes: Record<string, unknown> }>('.next/prerender-manifest.json').routes)
const v = checkBudget(stats, budget, prerendered)

for (const r of v.rows) {
  const mark = r.kb > r.limitKb ? '✗' : ' '
  console.log(`${mark} ${r.route.padEnd(32)} ${String(r.kb).padStart(5)} КБ  из ${r.limitKb}`)
}

const problems = [
  ...v.over.map((r) => `${r.route}: ${r.kb} КБ при потолке ${r.limitKb} — найди, что приехало (npx next experimental-analyze), или подними потолок осознанно`),
  ...v.stale.map((r) => `${r}: строка бюджета без маршрута — удали её из bundle-budget.json`),
  ...v.notStatic.map((r) => `${r}: маршрут перестал быть статическим (○) — что-то на нём читает cookies, headers или searchParams`),
]
if (problems.length) {
  console.error('\n' + problems.join('\n'))
  process.exit(1)
}
console.log(`\nВсе ${v.rows.length} ${plural(v.rows.length, 'маршрут', 'маршрута', 'маршрутов')} в бюджете.`)
