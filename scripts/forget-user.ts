/**
 * Удалить всё, что сервис хранит об игроке, — по письму из /privacy, раздел 06.
 *
 *   npm run user:forget -- <steamid или ссылка>           — показать, что найдётся
 *   npm run user:forget -- <steamid или ссылка> --apply   — удалить
 *
 * Учётки Turso берутся из .env.turso (так устроен npm-скрипт). Для дев-базы:
 *
 *   TURSO_DATABASE_URL=file:data/imbored.db npx tsx scripts/forget-user.ts <steamid>
 *
 * Принимает то, что человек пришлёт в письме: SteamID64 или ссылку на профиль.
 * Ссылка с коротким именем (/id/…) разворачивается через Steam API, для этого
 * нужен STEAM_API_KEY в окружении; без него скрипт попросит SteamID64.
 *
 * Здесь намеренно НЕТ createDb и openDb из соседнего opendb.ts. createDb тянет
 * migrateDb с ALTER TABLE и бэкфиллами, и скрипт, запущенный из ветки, прогнал
 * бы её миграции на проде раньше деплоя. А openDb без адреса открывает
 * data/catalog.db — каталог, в котором людей нет вовсе: удаление «успешно»
 * прошло бы мимо.
 *
 * Оборотная сторона: схема не догоняется, поэтому запускать скрипт против
 * прода стоит из того кода, что задеплоен. Если в базе ещё нет таблицы из
 * списка, пачка упадёт на «no such table» и откатится целиком, ничего не
 * удалив, — это громко и безопасно.
 *
 * Что именно и почему удаляется, описано у forgetUser в lib/db.ts. Скрипт
 * только находит steamid и печатает счёт — список таблиц у него свой быть не
 * должен.
 */

import { createClient } from '@libsql/client'
import { countUserRows, forgetUser, type ForgetReport } from '../lib/db'
import { parseProfileInput, resolveVanity } from '../lib/steam'

function openDb() {
  const url = process.env.TURSO_DATABASE_URL
  if (!url) {
    throw new Error(
      'нет TURSO_DATABASE_URL. Учётки лежат в .env.turso — запускать через\n' +
        '  npm run user:forget -- <steamid>\n' +
        'или для дев-базы: TURSO_DATABASE_URL=file:data/imbored.db npx tsx scripts/forget-user.ts <steamid>',
    )
  }
  console.log(`база: ${url.startsWith('file:') ? url : 'Turso (облако)'}`)
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
}

async function steamidOf(raw: string): Promise<string> {
  const input = parseProfileInput(raw)
  if (!input) throw new Error(`не похоже ни на SteamID64, ни на ссылку на профиль: «${raw}»`)
  if (input.kind === 'steamid64') return input.value

  const apiKey = process.env.STEAM_API_KEY
  if (!apiKey) {
    throw new Error(
      `короткое имя «${input.value}» без STEAM_API_KEY не развернуть. Попроси у человека\n` +
        `SteamID64 или задай STEAM_API_KEY в окружении.`,
    )
  }
  const steamid = await resolveVanity(input.value, { apiKey })
  if (!steamid) throw new Error(`Steam не знает профиля «${input.value}»`)
  console.log(`«${input.value}» → ${steamid}`)
  return steamid
}

function print(title: string, report: ForgetReport) {
  console.log(`\n${title}`)
  const width = Math.max(...report.map((r) => r.table.length))
  for (const r of report) console.log(`  ${r.table.padEnd(width)}  ${r.rows}`)
  console.log(`  ${'всего'.padEnd(width)}  ${report.reduce((s, r) => s + r.rows, 0)}`)
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const raw = args.find((a) => !a.startsWith('--'))
  if (!raw) {
    throw new Error('укажи SteamID64 или ссылку на профиль: npm run user:forget -- <steamid> [--apply]')
  }

  const steamid = await steamidOf(raw)
  const db = openDb()
  console.log(`игрок: ${steamid}`)

  const found = await countUserRows(db, steamid)
  print('найдено строк:', found)

  if (!found.some((r) => r.rows > 0)) {
    console.log('\nо таком игроке в базе ничего нет — удалять нечего.')
    return
  }
  if (!apply) {
    console.log('\nничего не удалено. Удалить: та же команда с --apply')
    return
  }

  print('удалено строк:', await forgetUser(db, steamid))
  console.log(
    '\nГотово. Что осталось вне базы и отсюда не достаётся:\n' +
      '  • картинки портрета и итогов года (/portrait/<steamid>/card.png,\n' +
      '    /portrait/<steamid>/year/card.png и их opengraph-image) живут в кэше\n' +
      '    Vercel до часа (revalidate 3600);\n' +
      '  • превью ссылок, которые уже закэшировали мессенджеры и соцсети (/privacy, раздел 05).',
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
