import { NextResponse } from 'next/server'
import { ensureMeta, fetchMostPlayed } from '@/lib/catalog'
import { refreshDeals } from '@/lib/deals'
import { fetchCurrentPlayers } from '@/lib/ingest'
import {
  getGamesMeta,
  getLatestSnapshot,
  getStaleAppids,
  saveLibrarySnapshot,
  topCatalogAppids,
  upsertGamesMeta,
} from '@/lib/db'
import { seedOtherStores } from '@/lib/otherstores'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { isUntouched } from '@/lib/recommend'
import {
  currentSteamId,
  getDb,
  isDemoId,
  nowSec,
  steamApiKey,
} from '@/lib/server'
import { fetchOwnedGames } from '@/lib/steam'
import type { LibraryGame } from '@/lib/types'
import { buildWarmPlan, shouldRefreshSnapshot } from '@/lib/warm'

const META_MAX_AGE_SEC = 14 * 86_400
// GetItems берёт до 200 игр за один запрос, поэтому прогрев укладывается
// в один-два вызова вместо восьмидесяти, как было с поштучным SteamSpy
const BATCH = 200
const MIN_NEW_POOL = 20
/** Замеров цены за один вызов прогрева */
const PRICE_BATCH = 100
const POOL_LIMIT = 200

/**
 * Пошагово прогревает каталог метаданных под библиотеку пользователя.
 * Клиент вызывает в цикле, пока remaining > 0 (каждый вызов ~10 сек).
 */
/**
 * Потолок здесь не про злоупотребление, а про зацикливание.
 *
 * Прогрев ЗАКОННО зовёт эту ручку до восьмидесяти раз подряд (см.
 * WARMUP_MAX_CALLS в lib/warmup.ts), поэтому лимит обязан этот сценарий
 * пропускать целиком и с запасом. Ловит он другое: второй параллельный прогрев
 * из соседней вкладки и клиента, который из-за ошибки крутит цикл без конца.
 */
const PREPARE_LIMIT = 200
const PREPARE_WINDOW_SEC = 300

export async function POST() {
  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  const now = nowSec()

  const gate = await checkRate(db, {
    bucket: 'prepare',
    id: steamid,
    limit: PREPARE_LIMIT,
    windowSec: PREPARE_WINDOW_SEC,
    nowSec: now,
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  const snapshot = await getLatestSnapshot(db, steamid)
  if (!snapshot) return NextResponse.json({ error: 'nolibrary' }, { status: 409 })

  /*
   * Два факта о человеке для экрана ожидания.
   *
   * Считаются по снапшоту, который уже прочитан, — ни одного лишнего запроса и
   * ни байта метаданных: isUntouched смотрит только на минуты. Поэтому они
   * доступны в ПЕРВОМ же ответе, когда каталог ещё не тронут, — а именно в
   * первые секунды человек и смотрит на экран.
   *
   * Денег бэклога тут намеренно нет, хотя просились: сумма требует цен, то
   * есть чтения метаданных всей библиотеки на каждом вызове цикла. Прогрев
   * дёргается десятками вызовов подряд, и это ровно та статья, за которую
   * Turso берёт деньги. Сумма живёт на /library, где читается один раз.
   */
  const demo = isDemoId(steamid)
  const facts = {
    games: snapshot.games.length,
    untouched: snapshot.games.filter(isUntouched).length,
    // Едет вместе с фактами, а не отдельным полем ответа, потому что нужен там
    // же, где они: подпись «22 игры в библиотеке» и подпись «библиотека не
    // твоя» — это одна и та же фраза, и разъезжаться им нельзя.
    demo,
  }

  // Демо-библиотека статична и уже засеяна — греть в ней нечего.
  if (demo) {
    return NextResponse.json({ remaining: 0, total: 0, library: facts })
  }

  await seedOtherStores(db, now)

  const games = await refreshLibrary(db, steamid, snapshot, now)
  const names = new Map(games.map((g) => [g.appid, g.name]))
  const owned = new Set(games.map((g) => g.appid))

  // Пул «попробуй новое»: чужие Steam-игры, уже лежащие в каталоге.
  //
  // Раньше здесь стоял ORDER BY updated_at DESC с LIMIT. LIMIT спасал от
  // выдачи, но не от работы: индекса на updated_at в схеме нет, поэтому SQLite
  // читал все строки games и сортировал их во временном B-дереве — на каждый
  // вызов, а клиент дёргает этот маршрут в цикле. topCatalogAppids берёт то же
  // самое по готовым частичным индексам (idx_games_pool и idx_games_ccu) и
  // останавливается на нужном числе строк. Заодно пул стал осмысленнее:
  // популярное вместо «того, что наш же прогрев тронул последним».
  const inCatalog = new Set(await topCatalogAppids(db, POOL_LIMIT))
  const steamPool = [...inCatalog].filter((id) => !owned.has(id))

  // Сидируем стабы популярных игр только при бедном пуле и только для НОВЫХ appid,
  // иначе повторный сид затирал бы уже загруженные теги (см. ревью).
  // Источник — официальные чарты Steam: SteamSpy отдаёт 403 с серверных IP.
  if (steamPool.length < MIN_NEW_POOL) {
    const charts = (await fetchMostPlayed()).slice(0, 60)
    // Проверяем наличие в базе явно, а не по пулу выше: пул — это верхушка
    // каталога, и игра из чартов вполне может лежать в games за её пределами.
    // Стаб с пустыми тегами, записанный поверх такой строки, стёр бы ей теги.
    const known = await getGamesMeta(db, charts)
    const stubs = charts
      .filter((appid) => !owned.has(appid) && !inCatalog.has(appid) && !known.has(appid))
      .map((appid) => ({ appid, name: `App ${appid}`, tags: {}, genres: [], categories: [] }))

    // updated_at = 0 → записи сразу «протухшие», имена и теги подтянет ensureMeta
    await upsertGamesMeta(db, stubs, 0)
    for (const s of stubs) {
      steamPool.push(s.appid)
      inCatalog.add(s.appid)
    }
  }

  // Раньше брали только верхушку по времени: поштучный запрос стоил 1.7 с на игру.
  // GetItems берёт 200 за раз, поэтому греем всю библиотеку — иначе у части игр
  // не будет обложки на странице библиотеки. Порядок внутри набора считает
  // buildWarmPlan: сортировка по часам вниз оставляла незапущенные игры без
  // метаданных навсегда (см. докблок там).
  const wanted = buildWarmPlan(games, steamPool.slice(0, 60))

  await ensureMeta(db, wanted, { maxFetch: BATCH, names })
  const remaining = (await getStaleAppids(db, wanted, META_MAX_AGE_SEC, nowSec())).length

  // Онлайн для совместных игр библиотеки: без него фильтр живости судит вслепую
  // и в выдачу попадают игры с пустыми серверами. Спрашиваем только у сетевых
  // и только когда замер протух — у обычного человека это десятки запросов.
  if (!remaining) {
    await refreshPlayerCounts(db, wanted)
    // Цены и скидки: свой проход, потому что своя скорость протухания —
    // метаданные живут две недели, распродажа несколько дней. Только для тех,
    // у кого замер устарел, и сотней за вызов: маршрут и без того делает
    // тяжёлый прогрев метаданных, а клиент дёргает его в цикле — вся
    // библиотека доберётся за несколько шагов.
    await refreshDeals(db, wanted, nowSec(), { maxFetch: PRICE_BATCH })
  }

  return NextResponse.json({ remaining, total: wanted.length, library: facts })
}

/**
 * Перезапрашивает библиотеку у Steam, если снапшот протух.
 *
 * Живёт здесь, а не в кроне: /api/prepare и так дёргается на каждом заходе в
 * /play и /library, то есть ровно тогда, когда свежесть кому-то нужна. Решение
 * «пора ли» — в shouldRefreshSnapshot, оно чистое и покрыто тестами.
 */
async function refreshLibrary(
  db: Awaited<ReturnType<typeof getDb>>,
  steamid: string,
  snapshot: { takenAt: number; games: LibraryGame[] },
  now: number,
): Promise<LibraryGame[]> {
  const key = steamApiKey()
  const due = shouldRefreshSnapshot({
    isDemo: isDemoId(steamid),
    takenAt: snapshot.takenAt,
    nowSec: now,
    hasApiKey: Boolean(key),
  })
  if (!due || !key) return snapshot.games

  // Любая осечка — оставляем старый снапшот. Пустая или приватная выдача тоже
  // считается осечкой: обнулить человеку библиотеку из-за глюка Steam хуже,
  // чем показать вчерашние часы.
  const fresh = await fetchOwnedGames(steamid, { apiKey: key }).catch(() => null)
  if (!fresh || fresh === 'private' || !fresh.length) return snapshot.games

  await saveLibrarySnapshot(db, steamid, fresh, now)
  return fresh
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

  // Запросы к Steam остаются последовательными — их темп держит pace() внутри
  // fetchCurrentPlayers, и параллелить их значит просто выстроить ту же очередь
  // на секунду позже. А вот записи собираем в одну пачку: сорок отдельных
  // UPDATE'ов давали сорок обходов Turso поверх сорока сетевых, и всё это внутри
  // запроса, который ждёт человек.
  const updates: Array<{ sql: string; args: (number | string)[] }> = []
  for (const row of res.rows as unknown as Array<{ appid: number }>) {
    const ccu = await fetchCurrentPlayers(row.appid).catch(() => undefined)
    if (ccu === undefined) continue
    updates.push({
      sql: 'UPDATE games SET ccu = ?, ccu_at = ? WHERE appid = ?',
      args: [ccu, now, row.appid],
    })
  }
  if (updates.length) await db.batch(updates, 'write')
}
