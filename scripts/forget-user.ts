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
 *
 * Удаление то же, что у кнопки «Удалить всё обо мне» (app/api/forget), и так
 * же выпускает человека со всех устройств (signOutFrom): без отметки
 * удаления его старые куки по-прежнему пускали бы (см. таблицу forget_marks).
 *
 * Письмо часто приходит уже после кнопки. Тогда от человека осталась одна
 * отметка удаления, и скрипт так и говорит: уже удалён, такого-то числа,
 * применять нечего (hasUserRows в lib/db). Повтор с --apply ничего бы не
 * удалил, а только переставил отметку позже — и SteamID пролежал бы в базе
 * дольше обещанного.
 */

import { createClient } from '@libsql/client'
import { countUserRows, forgetMarkAt, forgetUser, hasUserRows, type ForgetReport } from '../lib/db'
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

  if (!hasUserRows(found)) {
    const at = await forgetMarkAt(db, steamid)
    if (at === null) {
      console.log('\nо таком игроке в базе ничего нет — удалять нечего.')
      return
    }
    console.log(
      `\nэтот игрок уже удалён — ${new Date(at * 1000).toISOString().slice(0, 10)} (UTC), кнопкой или по\n` +
        'прошлому письму. В базе осталась только отметка удаления (forget_marks —\n' +
        'SteamID и время), она уйдёт сама через год с месяцем. Применять нечего:\n' +
        '--apply только переставил бы отметку позже. Можно отвечать, что всё удалено.',
    )
    return
  }
  if (!apply) {
    console.log('\nничего не удалено. Удалить: та же команда с --apply')
    return
  }

  // Адреса выборов, которыми он поделился, — до удаления: после него их не
  // узнать, а карточки по ним ещё час живут в кэше
  const picks = await db.execute({ sql: 'SELECT id FROM shared_picks WHERE created_by = ?', args: [steamid] })
  const pickIds = picks.rows.map((r) => String(r.id))

  print('удалено строк:', await forgetUser(db, steamid, { signOutFrom: Math.floor(Date.now() / 1000) }))
  console.log(
    '\nГотово. Входы на всех устройствах погашены: в базе осталась только отметка\n' +
      'удаления (forget_marks — SteamID и время), она уйдёт сама через год с месяцем.\n' +
      'Что осталось вне базы и отсюда не достаётся:\n' +
      '  • картинки портрета, итогов года и сравнения (/portrait/<steamid>/card.png,\n' +
      '    /portrait/<steamid>/year/card.png, их opengraph-image и\n' +
      '    /compat/<steamid>/opengraph-image) живут в кэше Vercel до часа\n' +
      '    (revalidate 3600);\n' +
      (pickIds.length
        ? '  • карточки выборов, которыми он поделился, — тоже до часа:\n' +
          pickIds.map((id) => `    /pick/${id}/opengraph-image\n`).join('')
        : '') +
      '  • превью ссылок, которые уже закэшировали мессенджеры и соцсети (/privacy, раздел 05).',
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
