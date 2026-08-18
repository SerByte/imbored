/**
 * Разложить очередь опроса по суткам.
 *
 *   npm run news:spread              — только показать, ничего не трогая
 *   npm run news:spread -- --apply   — записать
 *
 * Зачем это существует. Каденция в nextPollAt раньше была ровным `now + сутки`,
 * а ровное сложение сохраняет время суток. Постановка в очередь размазывает
 * всего на час (enrollNewsPoll, appid % 3600), поэтому одна массовая заливка
 * склеила набор в одну часовую полосу, и он остался в ней навсегда: замер
 * 18.08.2026 показал 184 из 190 горячих игр со сроком в 13:00 UTC. Пятнадцать
 * часовых триггеров из двадцати четырёх находили пустую очередь, лента менялась
 * одним залпом раз в сутки, а медианный лаг патча составлял 20 часов.
 *
 * Слот в nextPollAt чинит это на будущее, но сам по себе он расцепит очередь
 * только когда каждая игра дождётся своего срока — то есть после ещё одного
 * залпа. Скрипт делает то же самое сразу.
 *
 * Каденция и хэш слота НЕ переписаны здесь своими словами: pollInterval и
 * pollSlot импортируются из lib/newsjob, иначе скрипт и крон разошлись бы на
 * первом же изменении порога.
 *
 * Отличие от крона ровно одно: nextPollAt отсчитывает от «не раньше половины
 * каденции» (следующий опрос), а здесь нужна ближайшая точка сетки от СЕЙЧАС —
 * очередь должна растечься по ближайшим суткам, а не по послезавтрашним.
 */

import { createClient } from '@libsql/client'
import { pollInterval, pollSlot } from '../lib/newsjob'

const HOUR = 3600
const DAY = 86_400

function openDb() {
  const url = process.env.TURSO_DATABASE_URL
  if (!url) {
    throw new Error(
      'нет TURSO_DATABASE_URL. Учётки лежат в .env.turso — запускать через\n' +
        '  npx tsx --env-file=.env.turso scripts/spread-news-poll.ts',
    )
  }
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
}

const apply = process.argv.includes('--apply')
const db = openDb()
const now = Math.floor(Date.now() / 1000)

type Row = { appid: number; status: string; next_at: number; last_pub_at: number | null }

/** Ближайшая точка персональной сетки игры, не раньше «сейчас». */
function gridFromNow(appid: number, intervalSec: number): number {
  const slot = pollSlot(appid, intervalSec)
  return Math.ceil((now - slot) / intervalSec) * intervalSec + slot
}

/** Гистограмма по часам вперёд от «сейчас», окно 24 часа. */
function histogram(label: string, ats: number[]) {
  const buckets = new Array<number>(24).fill(0)
  let beyond = 0
  for (const at of ats) {
    const h = Math.floor((at - now) / HOUR)
    if (h >= 0 && h < 24) buckets[h]++
    else beyond++
  }
  console.log(`\n  ${label}`)
  for (let h = 0; h < 24; h++) {
    if (!buckets[h]) continue
    const clock = new Date((now + h * HOUR) * 1000).toISOString().slice(11, 13)
    console.log(
      `    +${String(h).padStart(2)}ч (${clock}:00 UTC)  ${'█'.repeat(Math.min(70, buckets[h]))} ${buckets[h]}`,
    )
  }
  console.log(`    позже суток: ${beyond}`)
}

async function main() {
  const res = await db.execute({
    // 'gone' пропускаем — их воскрешает reviveGoneNewsPoll со своим разбросом.
    // 'error' пропускаем — у них не каденция, а экспоненциальный откат, и
    // растягивать повтор до полусуток значит терять игру на ровном месте.
    sql: `SELECT appid, status, next_at, last_pub_at FROM news_poll
           WHERE status NOT IN ('gone', 'error')`,
    args: [],
  })
  const rows = res.rows as unknown as Row[]

  const planned = rows.map((r) => {
    const interval = pollInterval(
      { status: r.status as never, ...(r.last_pub_at != null ? { lastPubAt: r.last_pub_at } : {}) },
      now,
    )
    return { appid: r.appid, was: r.next_at, now: gridFromNow(r.appid, interval), interval }
  })

  const hot = planned.filter((p) => p.interval === 24 * HOUR)

  console.log(`\nочередь: ${rows.length} игр (без 'gone' и 'error'), из них горячих ${hot.length}`)
  console.log(`режим: ${apply ? 'ЗАПИСЬ' : 'только показ (--apply чтобы записать)'}`)

  histogram('БЫЛО — горячие игры по часам вперёд:', hot.map((p) => p.was))
  histogram('СТАНЕТ — горячие игры по часам вперёд:', hot.map((p) => p.now))

  const earlier = planned.filter((p) => p.now < p.was).length
  const later = planned.filter((p) => p.now > p.was).length
  const soon = planned.filter((p) => p.now - now < DAY).length
  console.log(`\n  сдвинуто раньше: ${earlier}   позже: ${later}   без изменений: ${planned.length - earlier - later}`)
  console.log(`  попадёт в ближайшие сутки: ${soon} игр (ёмкость крона 480/сут)`)

  const hours = new Set(hot.map((p) => Math.floor(((p.now % DAY) / HOUR)))).size
  console.log(`  горячие займут ${hours} из 24 часов суток\n`)

  if (!apply) {
    console.log('ничего не записано. Повтори с --apply.\n')
  } else {
    const CHUNK = 200
    const changed = planned.filter((p) => p.now !== p.was)
    for (let i = 0; i < changed.length; i += CHUNK) {
      await db.batch(
        changed.slice(i, i + CHUNK).map((p) => ({
          sql: 'UPDATE news_poll SET next_at = ? WHERE appid = ?',
          args: [p.now, p.appid],
        })),
        'write',
      )
    }
    console.log(`записано: ${changed.length} строк\n`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
