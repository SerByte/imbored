/**
 * Наполнение карточек игр: скриншоты, вердикт отзывов, pros/cons.
 *
 *   npm run pages:enrich -- --limit=50 --dry-run   посмотреть объём работы
 *   npm run pages:enrich -- --limit=500            прогнать 500 карточек
 *   npm run pages:enrich                           пока очередь не кончится
 *   npm run pages:enrich -- --no-llm               только эвристика, без Claude
 *
 * Крон на Vercel делает ровно то же самое (lib/pagejob.ts), но у него потолок
 * 60 секунд на вызов и 480 карточек в сутки — первичный обход шести тысяч игр
 * растянулся бы почти на две недели. Массовый первый проход дешевле прогнать
 * здесь: та же логика, без дедлайна и без цепочки вызовов.
 *
 * По умолчанию пишет в локальный data/imbored.db. Чтобы залить в облако,
 * задайте TURSO_DATABASE_URL — как у seed:catalog и catalog:promote.
 */

import fs from 'node:fs'
import path from 'node:path'
import { countPageEnrichDue, createDb } from '../lib/db'
import { PAGE_MAX_AGE_SEC, PAGE_MAX_TRIES, runPageSlice } from '../lib/pagejob'

/** Карточек за срез. Каждая — два запроса к store.steampowered.com,
 *  а лимитер держит 1.7 с между ними: срез это примерно минута. */
const SLICE = 20

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

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
  const noLlm = flag('no-llm')
  const maxGames = Number(arg('limit') ?? Number.POSITIVE_INFINITY)

  const db = await openDb()
  const now = Math.floor(Date.now() / 1000)

  const due = await countPageEnrichDue(db, now - PAGE_MAX_AGE_SEC, PAGE_MAX_TRIES)
  console.log(`к обогащению готово: ${due.toLocaleString('ru-RU')}`)

  if (dryRun) {
    const n = Math.min(due, maxGames)
    console.log('\n--dry-run: сеть не трогаем, ничего не пишем')
    console.log(`обогатили бы карточек: ${n.toLocaleString('ru-RU')}`)
    // два запроса на карточку (appdetails + appreviews) при темпе 1.7 с
    console.log(`это примерно ${Math.ceil((n * 2 * 1.7) / 60)} мин`)
    if (!noLlm) {
      console.log(`и примерно $${((n * 0.004)).toFixed(2)} у Anthropic (--no-llm, чтобы без модели)`)
    }
    return
  }

  let done = 0
  let shots = 0
  let prosCons = 0
  let viaClaude = 0
  const startedAt = Date.now()

  while (done < maxGames) {
    const limit = Math.min(SLICE, maxGames - done)
    const res = await runPageSlice(db, {
      // без дедлайна: локальный прогон никто не убивает по таймеру
      deadlineAt: Date.now() + 10 * 60_000,
      limit,
      ...(noLlm ? { useClaude: false } : {}),
      onProgress: (line) => console.log(line),
    })
    done += res.enriched
    shots += res.withShots
    prosCons += res.withProsCons
    viaClaude += res.viaClaude

    if (!res.enriched) break
    if (res.stopped === 'blocked') {
      console.warn('\nSteam закрылся от этого IP — прерываю, аренда истечёт сама')
      break
    }
    const mins = Math.round((Date.now() - startedAt) / 60_000)
    console.log(
      `${done.toLocaleString('ru-RU')} карточек\tскриншоты: ${shots}\tpros/cons: ${prosCons} (модель: ${viaClaude})\t${mins} мин`,
    )
    if (!res.hasMore) break
  }

  const left = await countPageEnrichDue(db, Math.floor(Date.now() / 1000) - PAGE_MAX_AGE_SEC, PAGE_MAX_TRIES)
  console.log(
    `\nготово. обогащено ${done.toLocaleString('ru-RU')}, ` +
      `со скриншотами ${shots.toLocaleString('ru-RU')}, с pros/cons ${prosCons.toLocaleString('ru-RU')}`,
  )
  if (left) {
    console.log(`продолжить: npm run pages:enrich (в очереди ещё ${left.toLocaleString('ru-RU')})`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
