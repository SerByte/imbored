/**
 * Заливка готового каталога из локальной базы в облако.
 *
 *   npm run catalog:publish -- --dry-run     показать, что поедет
 *   npm run catalog:publish                  залить
 *
 * Зачем отдельный скрипт, если есть catalog:promote. Промоут считает вердикты
 * ИЗ catalog_ingest — карты территории на 170 тысяч игр. Держать её в облаке
 * незачем: она нужна ровно один раз, на этапе отбора, и стоила бы квоты на
 * ровном месте. Поэтому в облаке её нет, и промоут там работать не может —
 * ему нечего читать.
 *
 * Здесь копируется РЕЗУЛЬТАТ отбора: games с вердиктами, game_tags и словарь
 * тегов. Обход Steam повторять не надо — ответ уже посчитан локально.
 *
 * Что НЕ трогаем: reviews_summary_json и pros_cons_json. Это кэш отзывов и
 * pros/cons от Claude, накопленный в проде по живым запросам пользователей;
 * локально его нет, и перезапись обнулила бы уже оплаченную работу модели.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { migrateDb, rebuildTagStats } from '../lib/db'

/** Строк в одном батче. Больше — риск упереться в лимит запроса libsql. */
const CHUNK = 200

const flag = (name: string) => process.argv.includes(`--${name}`)

/** Колонки games, которые копируем. Кэш отзывов и pros/cons сознательно вне списка. */
const COLS = [
  'appid', 'name', 'tags_json', 'genres_json', 'categories_json', 'short_description',
  'header_image', 'screenshots_json', 'is_free', 'price_final', 'release_date',
  'median_forever', 'store', 'store_url', 'updated_at', 'art_json', 'release_year',
  'developer', 'publisher', 'reviews_total', 'reviews_percent', 'reviews_30d',
  'ccu', 'ccu_at', 'signals_at', 'tag_count', 'is_multiplayer', 'alive',
  'dead_reason', 'superseded_by',
] as const

function openLocal(): Client {
  const file = path.join(process.cwd(), 'data', 'catalog.db')
  if (!fs.existsSync(file)) {
    throw new Error(`нет локального каталога: ${file}. Сначала seed:catalog и catalog:promote`)
  }
  console.log(`источник: ${file}`)
  return createClient({ url: `file:${file}` })
}

async function openRemote(): Promise<Client> {
  const url = process.env.TURSO_DATABASE_URL
  if (!url) throw new Error('нужен TURSO_DATABASE_URL — это скрипт заливки в облако')
  console.log(`приёмник: Turso`)
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
  return migrateDb(db)
}

async function main() {
  const dryRun = flag('dry-run')
  const local = openLocal()
  const remote = await openRemote()

  const count = async (db: Client, t: string) =>
    Number((await db.execute(`SELECT COUNT(*) n FROM ${t}`)).rows[0].n)

  const before = {
    games: await count(remote, 'games'),
    tags: await count(remote, 'game_tags'),
    dead: Number(
      (await remote.execute('SELECT COUNT(*) n FROM games WHERE alive = 0')).rows[0].n,
    ),
  }
  const src = { games: await count(local, 'games'), tags: await count(local, 'game_tags') }

  console.log(`\nв облаке сейчас: игр ${before.games.toLocaleString('ru-RU')}, ` +
    `тегов ${before.tags.toLocaleString('ru-RU')}, мёртвыми помечено ${before.dead}`)
  console.log(`поедет из локальной: игр ${src.games.toLocaleString('ru-RU')}, ` +
    `тегов ${src.tags.toLocaleString('ru-RU')}`)

  if (dryRun) {
    console.log('\n--dry-run: ничего не записано')
    return
  }

  // ---- games ----
  const setList = COLS.filter((c) => c !== 'appid').map((c) => `${c} = excluded.${c}`).join(', ')
  const games = await local.execute(`SELECT ${COLS.join(', ')} FROM games`)
  let done = 0
  for (let i = 0; i < games.rows.length; i += CHUNK) {
    const slice = games.rows.slice(i, i + CHUNK)
    await remote.batch(
      slice.map((r) => ({
        sql: `INSERT INTO games (${COLS.join(', ')})
              VALUES (${COLS.map(() => '?').join(', ')})
              ON CONFLICT(appid) DO UPDATE SET ${setList}`,
        args: COLS.map((c) => (r as Record<string, unknown>)[c] as never),
      })),
      'write',
    )
    done += slice.length
    if (done % 1000 === 0 || done === games.rows.length) {
      console.log(`  игры: ${done.toLocaleString('ru-RU')} / ${games.rows.length.toLocaleString('ru-RU')}`)
    }
  }

  // ---- словарь тегов ----
  const tags = await local.execute('SELECT tagid, name, game_count FROM tags')
  for (let i = 0; i < tags.rows.length; i += CHUNK) {
    await remote.batch(
      tags.rows.slice(i, i + CHUNK).map((r) => ({
        sql: `INSERT INTO tags (tagid, name, game_count) VALUES (?, ?, ?)
              ON CONFLICT(tagid) DO UPDATE SET name = excluded.name, game_count = excluded.game_count`,
        args: [r.tagid as number, r.name as string, r.game_count as number],
      })),
      'write',
    )
  }
  console.log(`  словарь тегов: ${tags.rows.length.toLocaleString('ru-RU')}`)

  // ---- game_tags ----
  const gt = await local.execute('SELECT appid, tag, weight FROM game_tags')
  done = 0
  for (let i = 0; i < gt.rows.length; i += CHUNK) {
    const slice = gt.rows.slice(i, i + CHUNK)
    await remote.batch(
      slice.map((r) => ({
        sql: `INSERT INTO game_tags (appid, tag, weight) VALUES (?, ?, ?)
              ON CONFLICT(appid, tag) DO UPDATE SET weight = excluded.weight`,
        args: [r.appid as number, r.tag as string, r.weight as number],
      })),
      'write',
    )
    done += slice.length
    if (done % 10_000 === 0 || done === gt.rows.length) {
      console.log(`  теги игр: ${done.toLocaleString('ru-RU')} / ${gt.rows.length.toLocaleString('ru-RU')}`)
    }
  }

  await rebuildTagStats(remote)

  const after = {
    games: await count(remote, 'games'),
    tags: await count(remote, 'game_tags'),
    dead: Number(
      (await remote.execute('SELECT COUNT(*) n FROM games WHERE alive = 0')).rows[0].n,
    ),
  }
  console.log(`\nготово. в облаке: игр ${after.games.toLocaleString('ru-RU')}, ` +
    `тегов ${after.tags.toLocaleString('ru-RU')}, мёртвыми помечено ${after.dead}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
