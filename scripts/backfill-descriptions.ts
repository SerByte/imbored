/**
 * Доливка описаний витрины на язык сайта.
 *
 *   npm run catalog:descriptions -- --limit=6000
 *   npm run catalog:descriptions -- --dry
 *
 * Зачем отдельный скрипт, а не флаг у promote-catalog: тот берёт игры,
 * «которых ещё нет в пуле», и по построению не возвращается к уже залитым.
 * Когда язык описаний переключили на русский, правка стала работать только для
 * НОВЫХ карточек — а английскими на тот момент были 4723 из 5000 в карте
 * сайта против 93 русских. Без этого прохода они остались бы английскими
 * навсегда.
 *
 * Отбор идёт по самому тексту: доливаем только те, где нет ни одной
 * кириллической буквы. Русские не трогаем, а английские, у которых русского
 * перевода в Steam нет, просто вернутся английскими — и во второй прогон
 * снова попадут, что честно: перевод у игры может появиться позже.
 *
 * Пишет ОДНУ колонку и не трогает updated_at — см. докблок
 * setGameDescriptions о том, почему поднимать lastmod на весь каталог нельзя.
 */

import { gameDescriptions, setGameDescriptions } from '../lib/db'
import { fetchStoreDescriptions } from '../lib/catalog'
import { openDb } from './opendb'

const STORE_BATCH = 200
const STORE_PACE_MS = 1500

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Хоть одна кириллическая буква — значит описание уже на языке сайта. */
const CYRILLIC = /[\u0400-\u04FF]/

async function main() {
  const limit = Number(arg('limit') ?? 6000)
  const dry = has('dry')
  const db = await openDb()

  const all = await gameDescriptions(db, limit)
  const target = all.filter((g) => !g.description || !CYRILLIC.test(g.description))
  console.log(
    `в пуле: ${all.length}, уже на русском: ${all.length - target.length}, доливаем: ${target.length}`,
  )
  if (dry) {
    console.log('--dry: ничего не пишем')
    return
  }
  if (!target.length) return

  let обновлено = 0
  let пусто = 0
  for (let i = 0; i < target.length; i += STORE_BATCH) {
    const chunk = target.slice(i, i + STORE_BATCH)
    let got: Map<number, string> | null = null
    try {
      got = await fetchStoreDescriptions(chunk.map((g) => g.appid))
    } catch (err) {
      // Осечка батча не фатальна: остаётся то, что было, и следующий прогон
      // попробует снова. Ронять проход на пяти тысячах игр незачем.
      console.warn(`  батч ${i}: ${String(err)}`)
    }
    if (got) {
      const rows = chunk
        .map((g) => ({ appid: g.appid, description: got.get(g.appid) ?? '' }))
        // Пустое описание не пишем: это стёрло бы то, что уже есть.
        .filter((r) => r.description && r.description !== '')
      пусто += chunk.length - rows.length
      обновлено += await setGameDescriptions(db, rows)
    }
    console.log(`  ${Math.min(i + STORE_BATCH, target.length)}/${target.length}`)
    if (i + STORE_BATCH < target.length) await sleep(STORE_PACE_MS)
  }
  console.log(`\nописаний переписано: ${обновлено}, Steam ничего не вернул: ${пусто}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
