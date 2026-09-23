/**
 * Доливка трейлеров и кадров в пул каталога.
 *
 *   npm run catalog:media -- --limit=6000
 *   npm run catalog:media -- --dry
 *
 * Зачем отдельный скрипт. Промоут просит кадры и трейлер только у новых игр
 * (он берёт тех, «кого ещё нет в пуле»), а крон карточек возвращается к уже
 * обогащённой раз в полгода (PAGE_MAX_AGE_SEC). Без этого прохода трейлеры у
 * верха каталога — ровно у тех игр, которые чаще всего становятся героями, —
 * появлялись бы по одной карточке в день до весны.
 *
 * Проход дешёвый: один GetItems на двести игр, только два include-флага, без
 * тегов, арта и цены. Весь пул — три десятка запросов.
 *
 * Пишет ДВЕ колонки узким UPDATE (setGamesMedia) и не трогает updated_at —
 * почему, там же. Пустое не затирает: игра без трейлера в Steam остаётся с
 * прежними кадрами и попадёт в выборку и в следующий раз — трейлер может
 * появиться позже.
 *
 * Куда пишет — как все скрипты наполнения (scripts/opendb.ts): в
 * data/catalog.db, а с TURSO_DATABASE_URL — в облако.
 */

import { gamesMissingMedia, setGamesMedia } from '../lib/db'
import { fetchStoreMedia, STORE_ITEMS_BATCH } from '../lib/catalog'
import { openDb } from './opendb'

const STORE_PACE_MS = 1500

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const limit = Number(arg('limit') ?? 6000)
  const dry = has('dry')
  const db = await openDb()

  const target = await gamesMissingMedia(db, limit)
  console.log(`в пуле без трейлера или кадров: ${target.length}`)
  if (dry) {
    console.log('--dry: ничего не пишем')
    return
  }

  let сТрейлером = 0
  let сКадрами = 0
  let записано = 0
  for (let i = 0; i < target.length; i += STORE_ITEMS_BATCH) {
    const chunk = target.slice(i, i + STORE_ITEMS_BATCH)
    try {
      const got = await fetchStoreMedia(chunk)
      const rows = [...got].map(([appid, media]) => ({ appid, ...media }))
      сТрейлером += rows.filter((r) => r.trailer).length
      сКадрами += rows.filter((r) => r.screenshots?.length).length
      записано += await setGamesMedia(db, rows)
    } catch (err) {
      // Осечка пачки не фатальна: её игры остались без медиа и попадут в
      // выборку следующего прогона. Ронять проход на шести тысячах незачем.
      console.warn(`  пачка ${i}: ${String(err)}`)
    }
    console.log(`  ${Math.min(i + STORE_ITEMS_BATCH, target.length)}/${target.length}`)
    if (i + STORE_ITEMS_BATCH < target.length) await sleep(STORE_PACE_MS)
  }
  console.log(
    `\nзаписано строк: ${записано}; нашёлся трейлер: ${сТрейлером}, кадры: ${сКадрами}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
