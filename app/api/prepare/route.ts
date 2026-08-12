import { NextResponse } from 'next/server'
import { ensureMeta, fetchSteamSpyTop } from '@/lib/catalog'
import { getLatestSnapshot, getStaleAppids, upsertGameMeta } from '@/lib/db'
import { seedOtherStores } from '@/lib/otherstores'
import { classifyLibraryGame } from '@/lib/recommend'
import { DEMO_STEAMID, currentSteamId, getDb, nowSec } from '@/lib/server'

const META_MAX_AGE_SEC = 14 * 86_400
const BATCH = 8
const MIN_NEW_POOL = 20

/**
 * Пошагово прогревает каталог метаданных под библиотеку пользователя.
 * Клиент вызывает в цикле, пока remaining > 0 (каждый вызов ~10 сек).
 */
export async function POST() {
  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  const now = nowSec()
  const snapshot = await getLatestSnapshot(db, steamid)
  if (!snapshot) return NextResponse.json({ error: 'nolibrary' }, { status: 409 })

  if (steamid === DEMO_STEAMID) return NextResponse.json({ remaining: 0, total: 0 })

  await seedOtherStores(db, now)

  const games = snapshot.games
  const names = new Map(games.map((g) => [g.appid, g.name]))
  const owned = new Set(games.map((g) => g.appid))

  const catalogRes = await db.execute('SELECT appid FROM games')
  const inCatalog = new Set(
    (catalogRes.rows as unknown as Array<{ appid: number }>).map((r) => r.appid),
  )
  // Steam-часть пула «попробуй новое» (отрицательные appid — кураторский пул других магазинов)
  const steamPool = [...inCatalog].filter((id) => id > 0 && !owned.has(id))

  // Сидируем стабы top-100 только при бедном пуле и только для НОВЫХ appid,
  // иначе повторный сид затирал бы уже загруженные теги (см. ревью)
  if (steamPool.length < MIN_NEW_POOL) {
    const top = await fetchSteamSpyTop()
    for (const g of top.slice(0, 60)) {
      if (owned.has(g.appid) || inCatalog.has(g.appid)) continue
      names.set(g.appid, g.name)
      // updated_at = 0 → запись сразу «протухшая» и попадёт в догрузку тегов
      await upsertGameMeta(
        db,
        { appid: g.appid, name: g.name, tags: {}, genres: [], categories: [] },
        0,
      )
      steamPool.push(g.appid)
      inCatalog.add(g.appid)
    }
  }

  const byPlaytime = [...games].sort((a, b) => b.playtimeForever - a.playtimeForever)
  const unplayed = games.filter((g) => classifyLibraryGame(g, now) === 'unplayed')

  const wanted = [
    ...new Set([
      ...byPlaytime.slice(0, 40).map((g) => g.appid),
      ...unplayed.slice(0, 30).map((g) => g.appid),
      ...steamPool.slice(0, 40),
    ]),
  ]

  await ensureMeta(db, wanted, { maxFetch: BATCH, names })
  const remaining = (await getStaleAppids(db, wanted, META_MAX_AGE_SEC, nowSec())).length
  return NextResponse.json({ remaining, total: wanted.length })
}
