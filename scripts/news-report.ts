/**
 * Почему лента «Что нового» показывает старое — для глазного ревью.
 *
 *   npm run news:report
 *
 * Читает и только читает. Здесь намеренно НЕТ createDb: он тянет за собой
 * migrateDb с попытками ALTER TABLE и двумя безусловными UPDATE games —
 * диагностика продовой базы не имеет права её править. Клиент поднимается
 * напрямую.
 *
 * Отчёт отвечает на один вопрос: лента бедна потому, что нечего показывать
 * (охват), или потому, что показываемое отфильтровано (классификация и rank),
 * или потому, что окно из ста двадцати строк занято парой издателей
 * (OVERFETCH). Лечится это тремя разными способами, поэтому сначала замер.
 */

import { createClient } from '@libsql/client'

const DAY = 86_400
const OVERFETCH = 4
const FEED_LIMIT = 30

/** Предикат гостевой ленты — дословная копия idx_news_feed (см. lib/db.ts). */
const FEED = "kind = 'patch' AND scale = 'major' AND rank > 0"

function openDb() {
  const url = process.env.TURSO_DATABASE_URL
  if (!url) {
    throw new Error(
      'нет TURSO_DATABASE_URL. Учётки лежат в .env.turso — запускать через\n' +
        '  npx tsx --env-file=.env.turso scripts/news-report.ts\n' +
        'или npm run news:report',
    )
  }
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
}

const db = openDb()
const now = Math.floor(Date.now() / 1000)

async function rows(sql: string, args: unknown[] = []) {
  const res = await db.execute({ sql, args: args as never })
  return res.rows as unknown as Record<string, unknown>[]
}

async function one(sql: string, args: unknown[] = []) {
  return (await rows(sql, args))[0] ?? {}
}

const n = (v: unknown) => Number(v ?? 0)
const ru = (v: unknown) => n(v).toLocaleString('ru-RU')

/** «14 дней назад» / «—» для unix-секунд. */
function ago(v: unknown): string {
  if (v == null) return '—'
  const days = Math.floor((now - n(v)) / DAY)
  const d = new Date(n(v) * 1000).toISOString().slice(0, 10)
  return `${d} (${days} дн назад)`
}

function head(title: string) {
  console.log(`\n${'─'.repeat(72)}\n${title}\n`)
}

async function main() {
  console.log(`отчёт по ленте новостей, ${new Date(now * 1000).toISOString()}`)

  // ── A. Форма пула ──────────────────────────────────────────────────────
  // Сужаем срез шаг за шагом. Где обвал — там и виноватый.
  head('A. Форма пула: от всех новостей до того, что видит гость')
  const a = await one(`SELECT
      COUNT(*) AS rows_all,
      COUNT(DISTINCT appid) AS games_all,
      SUM(kind = 'patch') AS patch_rows,
      COUNT(DISTINCT CASE WHEN kind = 'patch' THEN appid END) AS patch_games,
      SUM(kind = 'patch' AND scale = 'major') AS major_rows,
      COUNT(DISTINCT CASE WHEN kind = 'patch' AND scale = 'major' THEN appid END) AS major_games,
      SUM(${FEED}) AS feed_rows,
      COUNT(DISTINCT CASE WHEN ${FEED} THEN appid END) AS feed_games
    FROM news_items`)
  console.log(`  всего строк:        ${ru(a.rows_all).padStart(9)}   игр: ${ru(a.games_all)}`)
  console.log(`  kind='patch':       ${ru(a.patch_rows).padStart(9)}   игр: ${ru(a.patch_games)}`)
  console.log(`  + scale='major':    ${ru(a.major_rows).padStart(9)}   игр: ${ru(a.major_games)}`)
  console.log(`  + rank>0 (лента):   ${ru(a.feed_rows).padStart(9)}   игр: ${ru(a.feed_games)}`)
  console.log(`\n  → feed_games ≈ 18  — настоящий провал охвата`)
  console.log(`  → major_games >> feed_games — виноват фильтр rank>0`)

  // ── B. Окно в 120 строк ────────────────────────────────────────────────
  // getMajorFeed берёт limit*OVERFETCH строк и только потом схлопывает
  // onePerGame. Если игр в этом окне мало, а строк в пуле много — виноват
  // не охват, а OVERFETCH: пара плодовитых издателей занимает всё окно.
  head(`B. Окно, которое реально видит страница (LIMIT ${FEED_LIMIT * OVERFETCH})`)
  const b = await one(
    `SELECT COUNT(*) AS rows_in_window, COUNT(DISTINCT appid) AS games_in_window,
            MIN(published_at) AS oldest, MAX(published_at) AS newest
       FROM (SELECT appid, published_at FROM news_items
              WHERE ${FEED} AND published_at < 2000000000
              ORDER BY published_at DESC LIMIT ?)`,
    [FEED_LIMIT * OVERFETCH],
  )
  console.log(`  строк в окне:  ${ru(b.rows_in_window)}`)
  console.log(`  разных игр:    ${ru(b.games_in_window)}   ← столько карточек и покажет лента`)
  console.log(`  самая свежая:  ${ago(b.newest)}`)
  console.log(`  самая старая:  ${ago(b.oldest)}`)
  if (n(b.rows_in_window) >= FEED_LIMIT * OVERFETCH && n(b.games_in_window) < FEED_LIMIT) {
    console.log(`\n  !! окно забито: ${ru(b.rows_in_window)} строк на ${ru(b.games_in_window)} игр.`)
    console.log(`     Если feed_rows из A сильно больше — правка в OVERFETCH, а не в охвате.`)
  }

  const top = await rows(
    `SELECT appid, COUNT(*) AS majors FROM (
        SELECT appid FROM news_items WHERE ${FEED} AND published_at < 2000000000
         ORDER BY published_at DESC LIMIT ?
      ) GROUP BY appid ORDER BY majors DESC LIMIT 10`,
    [FEED_LIMIT * OVERFETCH],
  )
  console.log('\n  кто занимает окно:')
  for (const r of top) {
    const g = await one('SELECT name FROM games WHERE appid = ?', [r.appid])
    console.log(`    ${String(r.appid).padEnd(8)}${String(g.name ?? '—').slice(0, 34).padEnd(36)}${r.majors}`)
  }

  // ── C. Матрица kind × scale ────────────────────────────────────────────
  head('C. Матрица kind × scale')
  const c = await rows(`SELECT kind, COALESCE(scale, '(null)') AS scale,
      COUNT(*) AS rows, COUNT(DISTINCT appid) AS games,
      SUM(tldr IS NOT NULL) AS with_tldr, SUM(rank > 0) AS ranked
    FROM news_items GROUP BY 1, 2 ORDER BY rows DESC`)
  console.log('  kind      scale        строк      игр   с tldr   rank>0')
  for (const r of c) {
    console.log(
      `  ${String(r.kind).padEnd(10)}${String(r.scale).padEnd(10)}${ru(r.rows).padStart(8)}` +
        `${ru(r.games).padStart(9)}${ru(r.with_tldr).padStart(9)}${ru(r.ranked).padStart(9)}`,
    )
  }

  // ── D. Кто понизил до hotfix ───────────────────────────────────────────
  // Храповик односторонний: getUnsummarized исключает scale IS NOT 'hotfix',
  // поэтому помеченное эвристикой один раз не пересматривается никогда.
  head('D. Кто пометил hotfix — эвристика или Claude')
  const d = await one(`SELECT
      SUM(kind='patch' AND scale='hotfix' AND tldr IS NULL)     AS by_heuristic,
      SUM(kind='patch' AND scale='hotfix' AND tldr IS NOT NULL) AS by_claude,
      SUM(kind='patch' AND scale='major'  AND tldr IS NOT NULL) AS major_claude,
      SUM(kind='patch' AND scale='major'  AND tldr IS NULL)     AS major_pending
    FROM news_items`)
  console.log(`  hotfix эвристикой (looksTrivial):  ${ru(d.by_heuristic).padStart(8)}  ← назад пути нет`)
  console.log(`  hotfix моделью:                    ${ru(d.by_claude).padStart(8)}`)
  console.log(`  major подтверждён моделью:         ${ru(d.major_claude).padStart(8)}`)
  console.log(`  major ждёт пересказа:              ${ru(d.major_pending).padStart(8)}`)

  // ── E. Форензика rank ──────────────────────────────────────────────────
  head('E. Крупные патчи, выпавшие из ленты по rank = 0')
  const e = await rows(`SELECT n.appid, COUNT(*) AS majors, g.name, g.alive,
        g.superseded_by, g.tag_count, g.reviews_total, g.ccu
      FROM news_items n LEFT JOIN games g ON g.appid = n.appid
      WHERE n.kind = 'patch' AND n.scale = 'major' AND n.rank = 0
      GROUP BY n.appid ORDER BY majors DESC LIMIT 25`)
  if (!e.length) console.log('  таких нет — фильтр rank невиновен')
  for (const r of e) {
    const why =
      r.name == null
        ? 'нет в games (библиотечная)'
        : !n(r.alive)
          ? 'alive=0'
          : r.superseded_by != null
            ? `вытеснена → ${r.superseded_by}`
            : !n(r.tag_count)
              ? 'tag_count=0'
              : 'ранг не посчитан'
    console.log(
      `  ${String(r.appid).padEnd(8)}${String(r.name ?? '—').slice(0, 30).padEnd(32)}` +
        `патчей:${String(r.majors).padEnd(5)}${why}`,
    )
  }

  // ── F. Здоровье очереди ────────────────────────────────────────────────
  // Главный запрос. Библиотеки записываются в очередь с tier 0 (saveSnapshot),
  // а в nextPollAt ветка tier===0 стоит раньше проверки stale — значит
  // мёртвая с 2019-го библиотечная игра опрашивается раз в 72 часа вечно.
  head('F. Очередь опроса (news_poll)')
  const f1 = await rows(
    `SELECT status, COUNT(*) AS n,
        SUM(next_at <= ?) AS due_now,
        SUM(last_at IS NULL) AS never,
        SUM(last_at > ?) AS polled_24h,
        SUM(last_at > ?) AS polled_7d
      FROM news_poll GROUP BY status ORDER BY n DESC`,
    [now, now - DAY, now - 7 * DAY],
  )
  console.log('  status        всего     due    ни разу   за 24ч    за 7д')
  let due = 0
  for (const r of f1) {
    due += n(r.due_now)
    console.log(
      `  ${String(r.status).padEnd(12)}${ru(r.n).padStart(7)}${ru(r.due_now).padStart(8)}` +
        `${ru(r.never).padStart(10)}${ru(r.polled_24h).padStart(9)}${ru(r.polled_7d).padStart(9)}`,
    )
  }

  const f2 = await rows(
    `SELECT tier, COUNT(*) AS n, SUM(next_at <= ?) AS due_now,
        SUM(last_pub_at IS NOT NULL AND ? - last_pub_at < 14*86400) AS hot,
        SUM(last_pub_at IS NOT NULL AND ? - last_pub_at > 180*86400) AS stale
      FROM news_poll GROUP BY tier ORDER BY tier`,
    [now, now, now],
  )
  console.log('\n  tier    всего      due     горячих   протухших')
  for (const r of f2) {
    console.log(
      `  ${String(r.tier).padEnd(6)}${ru(r.n).padStart(7)}${ru(r.due_now).padStart(9)}` +
        `${ru(r.hot).padStart(11)}${ru(r.stale).padStart(12)}`,
    )
  }
  const t0 = f2.find((r) => n(r.tier) === 0)
  if (t0 && n(t0.n) > 200) {
    console.log(
      `\n  !! tier 0 = ${ru(t0.n)} строк. Каждая опрашивается раз в 72ч ВЕЧНО` +
        ` (ветка tier===0\n     в nextPollAt стоит раньше stale) — это ${Math.round(n(t0.n) / 3)} опросов в сутки,` +
        `\n     и все они идут мимо гостевой ленты: rank>0 только у tier 1.`,
    )
  }

  const f3 = await rows('SELECT fail_count, COUNT(*) AS n FROM news_poll GROUP BY fail_count ORDER BY fail_count')
  console.log('\n  сбоев подряд: ' + f3.map((r) => `${r.fail_count}→${r.n}`).join('  '))

  // Похороненные и когда каждая вернётся: 'gone' больше не вечен, но порог
  // по last_at намеренно ленивый — см. reviveGoneNewsPoll.
  const gone = await rows(
    `SELECT n.appid, n.last_at, g.name FROM news_poll n
      LEFT JOIN games g ON g.appid = n.appid
      WHERE n.status = 'gone' ORDER BY n.last_at LIMIT 20`,
  )
  if (gone.length) {
    console.log('\n  похоронены (вернутся через 30 дней после последней попытки):')
    for (const r of gone) {
      const due = n(r.last_at) + 30 * DAY
      const left = Math.ceil((due - now) / DAY)
      console.log(
        `    ${String(r.appid).padEnd(8)}${String(r.name ?? '—').slice(0, 30).padEnd(32)}` +
          (left > 0 ? `через ${left} дн` : 'готова к воскрешению'),
      )
    }
  }

  // ── G. Спрос против пропускной способности ─────────────────────────────
  head('G. Спрос очереди против пропускной способности')
  const g = await rows(
    `SELECT CASE
        WHEN last_pub_at IS NULL                  THEN 'никогда не публиковала'
        WHEN ? - last_pub_at <  14*86400          THEN 'горячие (<14д)'
        WHEN ? - last_pub_at < 180*86400          THEN 'обычные'
        ELSE 'мёртвые (>180д)' END AS bucket,
       tier, COUNT(*) AS n
      FROM news_poll WHERE status != 'gone' GROUP BY bucket, tier ORDER BY n DESC`,
    [now, now],
  )
  let demand = 0
  console.log('  бакет                       tier   игр   опросов/сут')
  for (const r of g) {
    const bucket = String(r.bucket)
    const tier = n(r.tier)
    // те же интервалы, что в nextPollAt
    const everyDays = bucket.startsWith('горячие') ? 1 : tier === 0 ? 3 : bucket.startsWith('мёртвые') ? 28 : 7
    const perDay = n(r.n) / everyDays
    demand += perDay
    console.log(
      `  ${bucket.padEnd(28)}${String(tier).padEnd(6)}${ru(r.n).padStart(6)}${perDay.toFixed(0).padStart(13)}`,
    )
  }
  console.log(`\n  спрос:      ~${demand.toFixed(0)} опросов/сут`)
  console.log(`  ёмкость:     480/сут (24 звена × 20), и только если цепочка доходит до конца`)
  console.log(`  просрочено:  ${ru(due)} прямо сейчас`)
  if (demand > 480) console.log(`\n  !! спрос выше ёмкости — очередь не может догнать себя в принципе`)

  // ── H. Лестница свежести ───────────────────────────────────────────────
  head('H. Что самое свежее на каждом уровне фильтра')
  const h = await one(`SELECT
      (SELECT MAX(published_at) FROM news_items) AS any_news,
      (SELECT MAX(published_at) FROM news_items WHERE kind='patch') AS patch,
      (SELECT MAX(published_at) FROM news_items WHERE kind='patch' AND scale='major') AS major,
      (SELECT MAX(published_at) FROM news_items WHERE ${FEED}) AS feed,
      (SELECT MAX(updated_at) FROM news_items) AS last_write`)
  console.log(`  любая новость:      ${ago(h.any_news)}`)
  console.log(`  патчноут:           ${ago(h.patch)}`)
  console.log(`  крупный патч:       ${ago(h.major)}`)
  console.log(`  попал в ленту:      ${ago(h.feed)}   ← это и видит гость`)
  console.log(`  последняя запись:   ${ago(h.last_write)}`)
  if (now - n(h.any_news) < 3 * DAY && now - n(h.feed) > 7 * DAY) {
    console.log('\n  → свежее приезжает, но до ленты не доходит: классификация или rank')
  } else if (now - n(h.any_news) > 7 * DAY) {
    console.log('\n  → свежее вообще не приезжает: опрос не идёт. Смотри F и J')
  }

  // ── I. Очередь пересказов ──────────────────────────────────────────────
  head('I. Очередь пересказов Claude')
  const i1 = await one(
    `SELECT COUNT(*) AS pending FROM news_items
      WHERE kind='patch' AND tldr IS NULL AND tldr_tries < 3 AND scale IS NOT 'hotfix'`,
  )
  const i2 = await rows(
    "SELECT tldr_tries, COUNT(*) AS n FROM news_items WHERE kind='patch' GROUP BY tldr_tries ORDER BY tldr_tries",
  )
  console.log(`  ждут пересказа: ${ru(i1.pending)}   (~$${(n(i1.pending) * 0.0028).toFixed(2)} разово)`)
  console.log('  попыток: ' + i2.map((r) => `${r.tldr_tries}→${r.n}`).join('  '))

  // ── I2. Что модель написала ────────────────────────────────────────────
  // Пересказы уезжают на витрину без ревью, поэтому смотреть на них глазами
  // надо хотя бы выборочно: пустой tldr, обрубок на полуслове или английский
  // текст в русской ленте видны сразу, а из счётчиков — никогда.
  head('I2. Свежие пересказы — выборка')
  const samples = await rows(
    `SELECT n.title, n.tldr, length(n.tldr) AS len, g.name
       FROM news_items n LEFT JOIN games g ON g.appid = n.appid
      WHERE n.tldr IS NOT NULL AND n.tldr_at IS NOT NULL
      ORDER BY n.tldr_at DESC LIMIT 6`,
  )
  for (const r of samples) {
    console.log(`  ${String(r.name ?? '—').slice(0, 28).padEnd(30)}${String(r.title).slice(0, 44)}`)
    console.log(`    → ${String(r.tldr)}\n`)
  }
  const shape = await one(
    `SELECT COUNT(*) AS n, SUM(length(tldr) < 20) AS too_short,
            SUM(tldr LIKE '%…') AS cut, AVG(length(tldr)) AS avg_len
       FROM news_items WHERE tldr IS NOT NULL`,
  )
  console.log(
    `  всего пересказов: ${ru(shape.n)}   средняя длина: ${Math.round(n(shape.avg_len))}` +
      `   короче 20 символов: ${ru(shape.too_short)}   обрублено: ${ru(shape.cut)}`,
  )

  // ── J. Состояние крона ─────────────────────────────────────────────────
  head('J. Что рассказывает про себя крон')
  const j = await rows(
    `SELECT key, value FROM catalog_meta WHERE key IN
      ('news_last_slice','news_enrolled_at','news_paused',
       'pages_last_slice','pages_paused',
       'digest_last_slice','digest_paused')`,
  )
  if (!j.length) console.log('  catalog_meta пуст — крон ни разу не отработал')
  for (const r of j) {
    const key = String(r.key)
    let val = String(r.value)
    if (key.endsWith('_last_slice')) {
      try {
        const p = JSON.parse(val) as Record<string, unknown>
        val = `${ago(p.at)}  chain=${p.chain}  polled=${p.polled}  inserted=${p.inserted}` +
          `  digested=${p.digested}  hasMore=${p.hasMore}  stopped=${p.stopped}`
      } catch {
        /* оставляем как есть */
      }
    } else if (key === 'news_enrolled_at') val = ago(val)
    console.log(`  ${key.padEnd(18)}${val}`)
  }

  // Килл-свитч выключает работу молча и навсегда — ровно так его и забывают
  // снять. Строчки в общем списке для этого мало, нужен крик.
  const paused = j.filter((r) => String(r.value) === '1' && String(r.key).endsWith('_paused'))
  for (const r of paused) {
    console.log(`\n  !! ${r.key} = 1 — эта задача СТОИТ. Снять: значение в 0`)
  }

  // ── K. Потолок каталога ────────────────────────────────────────────────
  head('K. Сколько игр каталог вообще может дать очереди')
  const k = await one(
    'SELECT COUNT(*) AS n FROM games WHERE alive = 1 AND superseded_by IS NULL AND tag_count > 0 AND appid > 0',
  )
  console.log(`  живых игр с тегами: ${ru(k.n)}`)
  if (n(k.n) < 800) console.log('  !! меньше 800 — поднимать enrollment бессмысленно, сначала catalog:promote')

  // ── L. Глазами ─────────────────────────────────────────────────────────
  head('L. Что эвристика пометила hotfix (свежие 25)')
  const l1 = await rows(
    `SELECT appid, substr(title, 1, 64) AS title, length(blocks_json) AS blob,
        date(published_at, 'unixepoch') AS d
      FROM news_items WHERE kind='patch' AND scale='hotfix' AND tldr IS NULL
      ORDER BY published_at DESC LIMIT 25`,
  )
  for (const r of l1) {
    console.log(`  ${r.d}  тело:${String(r.blob).padStart(6)}  ${String(r.title)}`)
  }
  console.log('\n  тело ≈ 2 байта — это "[]": пустой пост, помечен hotfix навсегда')

  head("L2. Что не прошло порог isPatchNote (kind='news', свежие 30)")
  const l2 = await rows(
    `SELECT appid, substr(title, 1, 70) AS title, date(published_at, 'unixepoch') AS d
      FROM news_items WHERE kind = 'news' ORDER BY published_at DESC LIMIT 30`,
  )
  for (const r of l2) console.log(`  ${r.d}  ${String(r.title)}`)
  console.log('\n  здесь ищем контентные апдейты, которые newsScore не набрал 2 очков')

  // ── M. Цена порога популярности ────────────────────────────────────────
  // app/whatsnew/page.tsx: FEED_RANK_FLOOR. Докблок обещает «около сотни игр
  // за месяц, примерно десять дней ленты» — проверяем на живых данных.
  head('M. Что делает FEED_RANK_FLOOR с общей лентой')
  console.log('  порог      игр в окне   лента охватит   самая свежая   самая старая')
  for (const floor of [0, 1_000, 5_000, 10_000, 25_000, 50_000]) {
    const win = await rows(
      `SELECT appid, published_at FROM news_items
        WHERE ${FEED} AND rank >= ? AND published_at < 2000000000
        ORDER BY published_at DESC LIMIT ?`,
      [floor, FEED_LIMIT * OVERFETCH],
    )
    const seen = new Set<number>()
    const kept: number[] = []
    for (const r of win) {
      const id = n(r.appid)
      if (seen.has(id)) continue
      seen.add(id)
      kept.push(n(r.published_at))
      if (kept.length >= FEED_LIMIT) break
    }
    const span = kept.length
      ? `${Math.floor((now - kept[0]!) / DAY)} дн`.padStart(6) +
        ' … ' +
        `${Math.floor((now - kept[kept.length - 1]!) / DAY)} дн`
      : '—'
    console.log(
      `  ${String(floor).padStart(7)}${String(win.length).padStart(11)}` +
        `${String(kept.length).padStart(14)} карт   ${span}`,
    )
  }
  console.log('\n  «игр в окне» — сколько строк вообще прошло порог (потолок 120)')
  console.log('  «лента охватит» — сколько карточек останется после onePerGame')

  console.log(`\n${'─'.repeat(72)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
