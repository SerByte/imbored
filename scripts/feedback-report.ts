/**
 * Попадания подбора по снимкам выдачи — для проверки гипотез, а не для экрана.
 *
 *   npm run feedback:report                        по data/imbored.db
 *   npm run feedback:report -- --db=путь/к.db      другая локальная база
 *   npm run feedback:report -- --remote            по облаку (TURSO_* из .env.turso), только чтение
 *   npm run feedback:report -- --days=14           окно (по умолчанию 30 дней)
 *   npm run feedback:report -- --with-demo         вместе с демо-личностями
 *
 * Считает долю «зашло» против «не то» по осям снимка (lib/feedbackctx): герой
 * против выбранного из «Ещё вариантов», модель против подбора по тегам, с
 * подталкиванием и без, рулетка, источник кандидата. Счёт — lib/feedbackreport,
 * тот же, что у feedbackStats в продукте.
 *
 * Только чтение: клиент без migrateDb, ни локальную базу, ни облако отчёт не
 * меняет. Демо-личности по умолчанию не считаются: они листают чужую
 * библиотеку, и их «зашло» говорит о лендинге, а не о подборе.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { parseFeedbackCtx } from '../lib/feedbackctx'
import { isFeedbackAction } from '../lib/feedbackkinds'
import { REPORT_AXES, formatRates, hitRates, type ReportRow } from '../lib/feedbackreport'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

function open(): Client {
  if (flag('remote')) {
    const url = process.env.TURSO_DATABASE_URL
    if (!url) throw new Error('--remote: нужен TURSO_DATABASE_URL (например, в .env.turso)')
    console.log('база: Turso (облако), только чтение')
    return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
  }
  const file = path.resolve(arg('db') ?? path.join(process.cwd(), 'data', 'imbored.db'))
  if (!fs.existsSync(file)) throw new Error(`нет базы: ${file}`)
  console.log(`база: ${file}`)
  return createClient({ url: `file:${file}` })
}

async function main() {
  const days = Math.max(1, Number(arg('days') ?? 30) || 30)
  const withDemo = flag('with-demo')
  const db = open()
  const since = Math.floor(Date.now() / 1000) - days * 86_400

  // Условие повторяет предикат idx_feedback_ctx: читаются только строки со
  // снимком, а не весь фидбек (Turso считает прочитанные строки)
  const res = await db.execute({
    sql: `SELECT steamid, appid, action, reason, ctx_json FROM feedback
          WHERE ctx_json IS NOT NULL AND created_at >= ?
            ${withDemo ? '' : "AND steamid NOT GLOB '000*'"}`,
    args: [since],
  })

  const rows: ReportRow[] = []
  for (const r of res.rows) {
    const action = r.action
    if (!isFeedbackAction(action)) continue
    let ctx = null
    try {
      ctx = parseFeedbackCtx(JSON.parse(String(r.ctx_json)))
    } catch {
      ctx = null
    }
    rows.push({
      steamid: String(r.steamid),
      appid: Number(r.appid),
      action,
      reason: r.reason === null ? null : String(r.reason),
      ctx,
    })
  }

  const people = new Set(rows.map((r) => r.steamid)).size
  console.log(
    `окно: ${days} дн, строк со снимком: ${rows.length}, людей: ${people}` +
      (withDemo ? ' (с демо)' : ' (без демо)'),
  )
  for (const axis of REPORT_AXES) {
    console.log('')
    for (const line of formatRates(axis, hitRates(rows, axis))) console.log(line)
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
