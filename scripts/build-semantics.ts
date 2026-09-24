/**
 * Семантика игр для всего каталога: приор по тегам и уточнение отзывами Steam.
 * Модель не зовётся нигде — ни здесь, ни в lib/semantics.
 *
 *   npm run semantics:build                                  приор по тегам, все живые игры, без сети
 *   npm run semantics:build -- --with-reviews --limit=500    плюс отзывы для 500 игр без них (≈15 мин)
 *   npm run semantics:build -- --publish                     что поедет в облако — без подключения
 *   npm run semantics:build -- --publish --yes               залить game_semantics в Turso
 *   npm run semantics:build -- --db=путь/к/копии.db          другая локальная база
 *
 * Пишет ВСЕГДА в локальный data/catalog.db (или --db), а не туда, куда
 * смотрит TURSO_DATABASE_URL, как делают seed и promote. Облако — только
 * отдельным шагом --publish, и только с --yes: заливку на прод запускает
 * владелец, а не опечатка в команде.
 *
 * Отзывы — те же, что берёт крон страниц (appreviews, сотня на игру, через
 * pace('steam-store')). Steam их отдаёт бесплатно, но медленно, поэтому
 * --with-reviews идёт порциями: очередь помнит, за кем уже ходили
 * (game_semantics.reviews_at), и следующий запуск продолжает с того же
 * места. Крон страниц делает то же самое сам, по мере обхода карточек, —
 * скрипт лишь ускоряет первый круг.
 *
 * Заливка не откатывает облако: посчитанное кроном по отзывам приор по тегам
 * не затрёт, старое не перепишет свежее (upsertSemantics в lib/db).
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { ALIVE_POOL_G, createDb, migrateDb, type Db } from '../lib/db'
import { plural } from '../lib/plural'
import { STORE_PACE_MS } from '../lib/catalog'
import { buildTagPrior, publishSemantics, reviewPass } from './semanticsbuild'

/** Порция по умолчанию для --with-reviews: около пяти минут */
const DEFAULT_REVIEW_LIMIT = 200

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

async function openLocal(): Promise<Db> {
  const file = path.resolve(arg('db') ?? path.join(process.cwd(), 'data', 'catalog.db'))
  if (!fs.existsSync(file)) {
    throw new Error(`нет локального каталога: ${file}. Сначала seed:catalog и catalog:promote`)
  }
  console.log(`база: ${file}`)
  return createDb(`file:${file}`)
}

async function count(db: Db, sql: string): Promise<number> {
  return Number((await db.execute(sql)).rows[0]?.n ?? 0)
}

async function main() {
  const withReviews = flag('with-reviews')
  const publish = flag('publish')
  const yes = flag('yes')
  const limit = Number(arg('limit') ?? DEFAULT_REVIEW_LIMIT)
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`--limit — целое больше нуля, а не ${arg('limit')}`)

  const local = await openLocal()

  // ---- приор по тегам ----
  const startedAt = Date.now()
  const prior = await buildTagPrior(local, Math.floor(Date.now() / 1000))
  console.log(
    `приор по тегам: ${prior.games.toLocaleString('ru-RU')} ` +
      `${plural(prior.games, 'игра', 'игры', 'игр')} за ${((Date.now() - startedAt) / 1000).toFixed(1)} с`,
  )

  // ---- отзывы ----
  if (withReviews) {
    const mins = Math.ceil((limit * STORE_PACE_MS) / 60_000)
    console.log(
      `\nотзывы Steam: до ${limit} ${plural(limit, 'игры', 'игр', 'игр')}, ` +
        `примерно ${mins} мин (модель не зовётся)`,
    )
    const pass = await reviewPass(local, { limit, onProgress: (line) => console.log(line) })
    console.log(
      `ответил Steam: ${pass.answered}, из них отзывов хватило сдвинуть оси: ${pass.withReviews}, ` +
        `отказов: ${pass.failed}`,
    )
    if (pass.stopped === 'blocked') {
      console.warn('Steam закрылся от этого IP — остановлено; продолжить можно позже той же командой')
    }
  }

  const byBasis = async (db: Db) =>
    (await db.execute('SELECT basis, COUNT(*) AS n FROM game_semantics GROUP BY basis ORDER BY basis'))
      .rows.map((r) => `${String(r.basis)}: ${Number(r.n).toLocaleString('ru-RU')}`)
      .join(', ')
  console.log(`\nв локальной базе: ${await byBasis(local)}`)
  const due = await count(
    local,
    `SELECT COUNT(*) AS n FROM games g LEFT JOIN game_semantics s ON s.appid = g.appid
     WHERE ${ALIVE_POOL_G} AND g.appid > 0
       AND s.reviews_at IS NULL`,
  )
  if (due) console.log(`без отзывов ещё ${due.toLocaleString('ru-RU')}: npm run semantics:build -- --with-reviews --limit=500`)

  // ---- облако ----
  if (!publish) {
    console.log('\nсверить с ручной разметкой: npm run semantics:report')
    return
  }
  const rows = await count(local, 'SELECT COUNT(*) AS n FROM game_semantics')
  if (!yes) {
    console.log(
      `\n--publish без --yes: в облако поехали бы ${rows.toLocaleString('ru-RU')} ` +
        `${plural(rows, 'строка', 'строки', 'строк')} game_semantics`,
    )
    console.log('к облаку не подключались. Залить: npm run semantics:build -- --publish --yes')
    return
  }
  const url = process.env.TURSO_DATABASE_URL
  if (!url) throw new Error('нужен TURSO_DATABASE_URL (например, в .env.turso) — это заливка в облако')
  console.log(`\nприёмник: Turso, строк к отправке ${rows.toLocaleString('ru-RU')}`)
  // migrateDb создаст game_semantics, если прод ещё не стартовал с новой схемой
  const remote = await migrateDb(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }))
  const res = await publishSemantics(local, remote, (line) => console.log(line))
  console.log(`отправлено: ${res.sent.toLocaleString('ru-RU')}, не читалось и не поехало: ${res.skipped}`)
  console.log(`в облаке теперь: ${await byBasis(remote)}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
