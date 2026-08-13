import { NextResponse } from 'next/server'
import { ensureMeta, fetchMostPlayed } from '@/lib/catalog'
import { fetchCurrentPlayers } from '@/lib/ingest'
import { getLatestSnapshot, getStaleAppids, upsertGameMeta } from '@/lib/db'
import { seedOtherStores } from '@/lib/otherstores'
import { DEMO_STEAMID, currentSteamId, getDb, nowSec } from '@/lib/server'

const META_MAX_AGE_SEC = 14 * 86_400
// GetItems берёт до 200 игр за один запрос, поэтому прогрев укладывается
// в один-два вызова вместо восьмидесяти, как было с поштучным SteamSpy
const BATCH = 200
const MIN_NEW_POOL = 20
const POOL_LIMIT = 200
/** Потолок на очень больших библиотеках, чтобы прогрев оставался конечным */
const LIBRARY_CAP = 1200

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

  // Пул «попробуй новое»: чужие Steam-игры, уже лежащие в каталоге.
  // LIMIT обязателен — без него это полный скан каталога на каждый вызов,
  // а клиент дёргает этот маршрут в цикле.
  const poolRes = await db.execute({
    sql: 'SELECT appid FROM games WHERE appid > 0 ORDER BY updated_at DESC LIMIT ?',
    args: [POOL_LIMIT],
  })
  const inCatalog = new Set(
    (poolRes.rows as unknown as Array<{ appid: number }>).map((r) => r.appid),
  )
  const steamPool = [...inCatalog].filter((id) => !owned.has(id))

  // Сидируем стабы популярных игр только при бедном пуле и только для НОВЫХ appid,
  // иначе повторный сид затирал бы уже загруженные теги (см. ревью).
  // Источник — официальные чарты Steam: SteamSpy отдаёт 403 с серверных IP.
  if (steamPool.length < MIN_NEW_POOL) {
    for (const appid of (await fetchMostPlayed()).slice(0, 60)) {
      if (owned.has(appid) || inCatalog.has(appid)) continue
      // updated_at = 0 → запись сразу «протухшая», имя и теги подтянет ensureMeta
      await upsertGameMeta(
        db,
        { appid, name: `App ${appid}`, tags: {}, genres: [], categories: [] },
        0,
      )
      steamPool.push(appid)
      inCatalog.add(appid)
    }
  }

  // Раньше брали только верхушку по времени: поштучный запрос стоил 1.7 с на игру.
  // GetItems берёт 200 за раз, поэтому греем всю библиотеку — иначе у части игр
  // не будет обложки на странице библиотеки.
  const byPlaytime = [...games].sort((a, b) => b.playtimeForever - a.playtimeForever)
  const wanted = [
    ...new Set([...byPlaytime.map((g) => g.appid), ...steamPool.slice(0, 60)]),
  ].slice(0, LIBRARY_CAP)

  await ensureMeta(db, wanted, { maxFetch: BATCH, names })
  const remaining = (await getStaleAppids(db, wanted, META_MAX_AGE_SEC, nowSec())).length

  // Онлайн для совместных игр библиотеки: без него фильтр живости судит вслепую
  // и в выдачу попадают игры с пустыми серверами. Спрашиваем только у сетевых
  // и только когда замер протух — у обычного человека это десятки запросов.
  if (!remaining) await refreshPlayerCounts(db, wanted)

  return NextResponse.json({ remaining, total: wanted.length })
}

/** Один appid за запрос, поэтому ограничиваем и по количеству, и по свежести */
const CCU_MAX_AGE_SEC = 6 * 3600
const CCU_PER_CALL = 40

async function refreshPlayerCounts(db: Awaited<ReturnType<typeof getDb>>, appids: number[]) {
  if (!appids.length) return
  const now = nowSec()
  const res = await db.execute({
    sql: `SELECT appid FROM games
          WHERE appid IN (${appids.map(() => '?').join(',')})
            AND is_multiplayer = 1
            AND (ccu_at IS NULL OR ccu_at < ?)
          ORDER BY ccu_at IS NOT NULL, reviews_total DESC
          LIMIT ?`,
    args: [...appids, now - CCU_MAX_AGE_SEC, CCU_PER_CALL],
  })

  for (const row of res.rows as unknown as Array<{ appid: number }>) {
    const ccu = await fetchCurrentPlayers(row.appid).catch(() => undefined)
    if (ccu === undefined) continue
    await db.execute({
      sql: 'UPDATE games SET ccu = ?, ccu_at = ? WHERE appid = ?',
      args: [ccu, now, row.appid],
    })
  }
}
