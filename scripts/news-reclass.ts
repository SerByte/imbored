/**
 * Переклассифицировать уже записанные патчи по нынешнему правилу lib/news.
 * НЕОБЯЗАТЕЛЬНО — зачем и когда, в докблоке scripts/newsreclass.ts.
 * Кэш сайта скрипт не сбрасывает: общая лента догонит за сутки или со
 * следующим кроном новостей, страницы патчей — сбросом по адресам
 * (/api/cron/revalidate, DEPLOY.md).
 *
 *   npm run news:reclass                          — только показать план
 *   npm run news:reclass -- --apply               — патчи-не-патчи → kind = 'news'
 *   npm run news:reclass -- --apply --redigest    — и вернуть подозрительные
 *                                                   пересказы к модели
 *   npm run news:reclass -- --apply --renone      — вернуть модели все её
 *                                                   вердикты «не патч»
 *   npm run news:reclass -- --apply --renone=730/123,570/456
 *                                                 — только эти (ключи — из плана)
 *
 * --redigest одноразовый: повтор после того, как крон пересказов разобрал
 * сброшенное, оплатит те же пересказы ещё раз (модель снова скажет «major» у
 * настоящих патчей — и примета в тексте никуда не денется).
 *
 * --renone без списка — после правки промпта, когда «не патч» мог измениться
 * у многих: с тем же промптом модель, скорее всего, ответит то же, и вызов
 * пропадёт зря. Со списком — когда владелец прочёл план и нашёл в «не патчах»
 * настоящий патч. Сами вердикты план показывает всегда, и без --renone тоже.
 *
 * createDb здесь нет намеренно, по той же причине, что у news-report: он
 * тянет migrateDb, а прогону по проду схема ветки не нужна — он трогает
 * только kind, scale, updated_at и колонки пересказа, которые там давно есть.
 */

import { createClient } from '@libsql/client'
import { applyNewsReclass, planNewsReclass, reclassKey } from './newsreclass'

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
/** --renone — все вердикты «не патч», --renone=k1,k2 — только эти ключи «appid/gid» */
const renoneArg = process.argv.find((a) => a === '--renone' || a.startsWith('--renone='))
const renone: boolean | string[] = !renoneArg
  ? false
  : renoneArg.includes('=')
    ? renoneArg
        .slice(renoneArg.indexOf('=') + 1)
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
    : true

async function main() {
  const db = openDb()
  const now = Math.floor(Date.now() / 1000)
  const plan = await planNewsReclass(db)

  console.log(`\nпатчи, которые нынешнее правило считает новостями: ${plan.demote.length}`)
  for (const r of plan.demote) console.log(`  ${reclassKey(r)}  ${r.title}`)
  console.log(`\nпересказы с приметами невышедшего: ${plan.redigest.length}`)
  for (const r of plan.redigest) console.log(`  ${reclassKey(r)}  ${r.title}`)
  console.log(`\n«не патч» по мнению модели (вернуть — --renone): ${plan.none.length}`)
  for (const r of plan.none) console.log(`  ${reclassKey(r)}  ${r.title}`)

  if (Array.isArray(renone)) {
    // Опечатка в ключе иначе молча сводилась бы к «записано: 0»
    const known = new Set(plan.none.map(reclassKey))
    const stray = renone.filter((k) => !known.has(k))
    if (stray.length) console.log(`\nнет среди «не патчей», пропущены: ${stray.join(', ')}`)
  }

  if (!apply) {
    console.log('\nничего не записано: добавь --apply (и --redigest, --renone по желанию)')
    return
  }
  const res = await applyNewsReclass(db, plan, { redigest, renone }, now)
  console.log(
    `\nзаписано: в новости ${res.demoted}, пересказов к модели ${res.redigested}, вердиктов к модели ${res.renoned}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
