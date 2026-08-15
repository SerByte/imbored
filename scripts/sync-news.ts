/**
 * Наполнение патчноутов. Запускается вручную, не в рантайме запроса.
 *
 *   npm run news:sync -- --limit=50 --dry-run   посмотреть, кого будем опрашивать
 *   npm run news:sync -- --limit=200            прогнать 200 игр
 *   npm run news:sync                           пока очередь не кончится
 *   npm run news:sync -- --enroll-only          только пополнить очередь
 *   npm run news:sync -- --digest-only          только пересказы, без Steam
 *
 * Крон на Vercel делает ровно то же самое (lib/newsjob.ts), но у него потолок
 * в 60 секунд на вызов. Массовый первый обход дешевле прогнать здесь: та же
 * логика, но без дедлайна и без цепочки вызовов.
 *
 * По умолчанию пишет в локальный data/imbored.db. Чтобы залить в облако,
 * задайте TURSO_DATABASE_URL — как у seed:catalog и catalog:promote.
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  acquireLease,
  countNewsPollDue,
  createDb,
  DIGEST_LEASE,
  enrollNewsPoll,
  releaseLease,
  topCatalogAppids,
} from '../lib/db'
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
  const digestOnly = flag('digest-only')
  const maxGames = Number(arg('limit') ?? Number.POSITIVE_INFINITY)

  const db = await openDb()
  const now = Math.floor(Date.now() / 1000)

  // Разбор накопившейся очереди пересказов, не трогая Steam.
  //
  // runNewsSlice с limit = 0 не занимает ни одной игры, поэтому фаза опроса
  // проходит вхолостую, а фаза пересказа работает как обычно. Иначе на каждые
  // двенадцать пересказов пришлось бы двадцать запросов к store.steampowered
  // по 1.7 с — час ожидания ради работы, которой сеть Steam не нужна вовсе.
  //
  // Выходим по «ничего не пересказали», а не по hasMore: при limit = 0 условие
  // targets.length === limit истинно всегда, и цикл по нему был бы вечным.
  if (digestOnly) {
    // Аренда та же, что у /api/cron/digest: getUnsummarized не резервирует
    // строки, поэтому ручной прогон и крон, взявшись за дело одновременно,
    // разобрали бы одни и те же записи и заплатили за них дважды. Держим
    // подолгу и продлеваем каждым кругом — аренда реентерабельна по holder.
    const holder = `local:${randomUUID()}`
    const LEASE_TTL = 300
    if (!(await acquireLease(db, DIGEST_LEASE, holder, LEASE_TTL, now))) {
      console.log(
        `очередь пересказов занята: её разбирает крон либо прерванный прогон,\n` +
          `не успевший отдать аренду. Она истекает сама, ждать не больше ${LEASE_TTL} с.`,
      )
      return
    }

    // Ctrl+C не выполняет finally: процесс просто умирает, и аренда висит до
    // истечения TTL — то есть собственный перезапуск упирается в свой же
    // замок на пять минут. Для ручного инструмента это недопустимо.
    const onSignal = () => {
      void releaseLease(db, DIGEST_LEASE, holder).finally(() => {
        console.log('\nаренда отдана, выходим')
        process.exit(130)
      })
    }
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)

    let digested = 0
    const startedAt = Date.now()
    try {
      for (;;) {
        const res = await runNewsSlice(db, {
          deadlineAt: Date.now() + 10 * 60_000,
          nowSec: now,
          limit: 0,
          digestLimit: 25,
          onProgress: (line) => console.log(line),
        })
        if (!res.digested) break
        digested += res.digested
        const mins = Math.round((Date.now() - startedAt) / 60_000)
        console.log(`пересказов: ${digested.toLocaleString('ru-RU')}\t${mins} мин`)
        await acquireLease(db, DIGEST_LEASE, holder, LEASE_TTL, Math.floor(Date.now() / 1000))
      }
    } finally {
      await releaseLease(db, DIGEST_LEASE, holder)
    }

    console.log(`\nготово. пересказано ${digested.toLocaleString('ru-RU')}`)
    if (!digested) {
      console.log('ноль — либо очередь пуста, либо нет ANTHROPIC_API_KEY в окружении')
    }
    return
  }
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
