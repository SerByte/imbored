/**
 * Наполнение патчноутов. Запускается вручную, не в рантайме запроса.
 *
 *   npm run news:sync -- --limit=50 --dry-run   посмотреть, кого будем опрашивать
 *   npm run news:sync -- --limit=200            прогнать 200 игр
 *   npm run news:sync                           пока очередь не кончится
 *   npm run news:sync -- --enroll-only          только пополнить очередь
 *
 * Крон на Vercel делает ровно то же самое (lib/newsjob.ts), но у него потолок
 * в 60 секунд на вызов. Массовый первый обход дешевле прогнать здесь: та же
 * логика, но без дедлайна и без цепочки вызовов.
 *
 * По умолчанию пишет в локальный data/imbored.db. Чтобы залить в облако,
 * задайте TURSO_DATABASE_URL — как у seed:catalog и catalog:promote.
 */

import fs from 'node:fs'
import path from 'node:path'
import { countNewsPollDue, createDb, enrollNewsPoll, topCatalogAppids } from '../lib/db'
import { runNewsSlice } from '../lib/newsjob'

/** Игр за один срез. Хост store.steampowered.com держим на 1.7 с между
 *  запросами — тот же лимитер, что у appreviews и appdetails. */
const SLICE = 20
const ENROLL_PER = 200

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

/**
 * Локально пишем в data/imbored.db, а не в data/catalog.db, как seed/promote:
 * патчноуты — это данные РАНТАЙМА, их читает работающее приложение, а не
 * промежуточная кладовка для сборки каталога. В проде обе базы всё равно одна
 * и та же Turso.
 */
async function openDb() {
  const remote = process.env.TURSO_DATABASE_URL
  if (remote) {
    console.log('база: Turso (облако)')
    return createDb(remote, process.env.TURSO_AUTH_TOKEN)
  }
  const dir = path.join(process.cwd(), 'data')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'imbored.db')
  console.log(`база: ${file}`)
  return createDb(`file:${file}`)
}

async function main() {
  const dryRun = flag('dry-run')
  const enrollOnly = flag('enroll-only')
  const maxGames = Number(arg('limit') ?? Number.POSITIVE_INFINITY)

  const db = await openDb()
  const now = Math.floor(Date.now() / 1000)
  // Ручной прогон смотрит на очередь на час вперёд: разброс next_at нужен
  // крону, чтобы вся очередь не становилась доступной одной секундой, а
  // здесь он только заставил бы ждать. Повторная постановка курсор не
  // двигает намеренно — иначе ей можно было бы вечно морить хвост очереди.
  const claimAt = now + 3600

  // пополняем очередь топом каталога: онлайн + обсуждаемость
  // jitter = 0: ручной прогон должен начать работу сразу, а не ждать час,
  // пока разъедется детерминированный разброс, нужный крону
  const top = await topCatalogAppids(db, ENROLL_PER)
  await enrollNewsPoll(db, top, 1, now, 0)
  console.log(`каталог: поставлено в очередь ${top.length.toLocaleString('ru-RU')} игр`)

  const due = await countNewsPollDue(db, claimAt)
  console.log(`к опросу готово: ${due.toLocaleString('ru-RU')}`)
  if (enrollOnly) return

  if (dryRun) {
    console.log('\n--dry-run: сеть не трогаем, ничего не пишем')
    console.log(`опросили бы игр: ${Math.min(due, maxGames).toLocaleString('ru-RU')}`)
    console.log(`это примерно ${Math.ceil(Math.min(due, maxGames) * 1.7 / 60)} мин при темпе 1.7 с`)
    return
  }

  let polled = 0
  let inserted = 0
  let digested = 0
  const startedAt = Date.now()

  while (polled < maxGames) {
    const limit = Math.min(SLICE, maxGames - polled)
    const res = await runNewsSlice(db, {
      // без дедлайна: локальный прогон никто не убивает по таймеру
      deadlineAt: Date.now() + 10 * 60_000,
      nowSec: claimAt,
      limit,
      digestLimit: 12,
      onProgress: (line) => console.log(line),
    })
    polled += res.polled
    inserted += res.inserted
    digested += res.digested

    if (!res.polled) break
    if (res.stopped === 'blocked') {
      console.warn('\nSteam закрылся от этого IP — прерываю, аренда истечёт сама')
      break
    }
    const mins = Math.round((Date.now() - startedAt) / 60_000)
    console.log(
      `${polled.toLocaleString('ru-RU')} игр\tзаписей: ${inserted}\tпересказов: ${digested}\t${mins} мин`,
    )
    if (!res.hasMore) break
  }

  const left = await countNewsPollDue(db, Math.floor(Date.now() / 1000))
  console.log(
    `\nготово. опрошено ${polled.toLocaleString('ru-RU')}, ` +
      `новых записей ${inserted.toLocaleString('ru-RU')}, пересказов ${digested}`,
  )
  if (left) console.log(`продолжить: npm run news:sync (в очереди ещё ${left.toLocaleString('ru-RU')})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
