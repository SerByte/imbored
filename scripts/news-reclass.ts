/**
 * Переклассифицировать уже записанные патчи по нынешнему правилу lib/news.
 * НЕОБЯЗАТЕЛЬНО — зачем и когда, в докблоке scripts/newsreclass.ts.
 *
 *   npm run news:reclass                          — только показать план
 *   npm run news:reclass -- --apply               — патчи-не-патчи → kind = 'news'
 *   npm run news:reclass -- --apply --redigest    — и вернуть подозрительные
 *                                                   пересказы окна к модели
 *
 * --redigest одноразовый: повтор после того, как крон пересказов разобрал
 * сброшенное, оплатит те же пересказы ещё раз (модель снова скажет «major» у
 * настоящих патчей — и примета в тексте никуда не денется).
 *
 * createDb здесь нет намеренно, по той же причине, что у news-report: он
 * тянет migrateDb, а прогону по проду схема ветки не нужна — он трогает
 * только kind, updated_at и колонки пересказа, которые там давно есть.
 */

import { createClient } from '@libsql/client'
import { applyNewsReclass, planNewsReclass } from './newsreclass'

function openDb() {
  const url = process.env.TURSO_DATABASE_URL
  if (!url) {
    throw new Error(
      'нет TURSO_DATABASE_URL. Учётки лежат в .env.turso — запускать через\n' +
        '  npx tsx --env-file=.env.turso scripts/news-reclass.ts\n' +
        'или npm run news:reclass',
    )
  }
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
}

const apply = process.argv.includes('--apply')
const redigest = process.argv.includes('--redigest')

async function main() {
  const db = openDb()
  const now = Math.floor(Date.now() / 1000)
  const plan = await planNewsReclass(db, now)

  console.log(`\nпатчи, которые нынешнее правило считает новостями: ${plan.demote.length}`)
  for (const r of plan.demote) console.log(`  ${r.appid}/${r.gid}  ${r.title}`)
  console.log(`\nпересказы окна карты сайта с приметами невышедшего: ${plan.redigest.length}`)
  for (const r of plan.redigest) console.log(`  ${r.appid}/${r.gid}  ${r.title}`)

  if (!apply) {
    console.log('\nничего не записано: добавь --apply (и --redigest для пересказов)')
    return
  }
  const res = await applyNewsReclass(db, plan, { redigest }, now)
  console.log(`\nзаписано: в новости ${res.demoted}, к модели ${res.redigested}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
