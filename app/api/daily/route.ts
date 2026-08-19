import { NextResponse } from 'next/server'
import { pickDaily, pickDailyPool } from '@/lib/daily'
import { filterActual } from '@/lib/actual'
import { refreshDealsWithin } from '@/lib/deals'
import {
  bannedAppids,
  getDailyPick,
  getPoolSize,
  getGamesMeta,
  getLatestSnapshot,
  listFeedback,
  loadTagStats,
  saveDailyPick,
} from '@/lib/db'
import { discountView } from '@/lib/discount'
import { editionKey } from '@/lib/editions'
import { heuristicPicks } from '@/lib/llm'
import { fetchDiscoveryPool, pickQueryTags, rotationSlot } from '@/lib/pool'
import {
  applyFeedbackToProfile,
  buildTagProfile,
  scoreCandidates,
  splitBySource,
} from '@/lib/recommend'
import { NEUTRAL_MOOD } from '@/lib/mood'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { CANDIDATE_SOURCES, type GameMeta, type ScoredCandidate } from '@/lib/types'

/** Сколько находок из каталога показываем полкой под героем */
const DISCOVERY_CARDS = 3

/** Пул каталога, добираемый вне тегов профиля — тот же приём, что в выдаче */
const WILDCARD_POOL = 30

/**
 * Кандидатов на ранжирование. Тридцать, а не прежние двадцать пять, по той же
 * причине, что и в основной выдаче: DISCOVERY_SHARE резервирует под каталог
 * заметную долю бюджета, и на старом лимите своих кандидатов стало бы меньше,
 * чем было до появления каталога на этой странице.
 */
const CANDIDATE_LIMIT = 30

/**
 * Игра дня одна на сутки, а стоит один вызов около восьмисот прочитанных строк
 * Turso: снапшот, метаданные библиотеки, фидбек, статистика тегов и пул на
 * четыре сотни кандидатов. Десяти обращений в час хватает и на перезагрузки, и
 * на несколько устройств, но не на цикл.
 */
const DAILY_LIMIT = 10
const DAILY_WINDOW_SEC = 3600

/**
 * Что именно запоминается на сутки.
 *
 * Герой, полка и часы — результат ОТБОРА: он опирается на пул каталога и
 * фидбек, стоит около восьмисот прочитанных строк и до полуночи меняться не
 * должен по определению страницы.
 *
 * Текста причины здесь НЕТ, и это не упущение. heuristicPicks вписывает в неё
 * цену («Её нет в библиотеке — $59.99 в Steam»), а цена живёт своей осью
 * свежести и обновляется на каждом заходе. Запомнить причину значило бы
 * заморозить в ней вчерашнюю сумму рядом с сегодняшним ценником — ровно то
 * расхождение, против которого написан комментарий у refreshDealsWithin ниже.
 */
type DailySelection = {
  pick: ScoredCandidate
  shelf: ScoredCandidate[]
  hoursPlayed: number | null
}

function parseCandidate(raw: unknown): ScoredCandidate | null {
  if (!raw || typeof raw !== 'object') return null
  const { appid, name, source, score } = raw as Record<string, unknown>
  if (typeof appid !== 'number' || !Number.isInteger(appid)) return null
  if (typeof name !== 'string') return null
  if (typeof score !== 'number' || !Number.isFinite(score)) return null
  if (!CANDIDATE_SOURCES.includes(source as never)) return null
  return { appid, name, source: source as ScoredCandidate['source'], score }
}

/**
 * Разбор с проверкой формы, а не приведение типом.
 *
 * Строку писала предыдущая версия приложения, и состав кандидата с тех пор мог
 * измениться. Непрошедшая запись — не ошибка: маршрут просто пересчитает выбор
 * и перезапишет её. Сид тот же (steamid:дата), так что для человека, у которого
 * пул с утра не вырос, ответ останется прежним.
 */
function parseSelection(raw: unknown): DailySelection | null {
  if (!raw || typeof raw !== 'object') return null
  const { pick, shelf, hoursPlayed } = raw as Record<string, unknown>
  const parsedPick = parseCandidate(pick)
  if (!parsedPick) return null
  if (!Array.isArray(shelf)) return null
  const parsedShelf: ScoredCandidate[] = []
  for (const item of shelf) {
    const c = parseCandidate(item)
    if (!c) return null
    parsedShelf.push(c)
  }
  if (hoursPlayed !== null && typeof hoursPlayed !== 'number') return null
  return { pick: parsedPick, shelf: parsedShelf, hoursPlayed }
}

export async function GET() {
  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  const now = nowSec()

  const gate = await checkRate(db, {
    bucket: 'daily',
    id: steamid,
    limit: DAILY_LIMIT,
    windowSec: DAILY_WINDOW_SEC,
    nowSec: now,
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  /*
   * Выбор дня — из записи, если она уже есть.
   *
   * Отбор ниже стоит около восьмисот прочитанных строк Turso и полутора секунд
   * ради ответа, который по определению страницы не меняется до полуночи.
   * Дата берётся в UTC — тем же способом, что и сид ниже: сид и ключ записи
   * обязаны сходиться, иначе на границе суток они разъедутся и «одна игра на
   * день» перестанет быть правдой.
   */
  const dateStr = new Date().toISOString().slice(0, 10)
  const stored = parseSelection(await getDailyPick(db, steamid, dateStr))

  const selection = stored ?? (await selectDaily(db, steamid, dateStr, now))
  if (!selection) return NextResponse.json({ error: 'nocandidates' }, { status: 409 })
  if (selection === NO_LIBRARY) return NextResponse.json({ error: 'nolibrary' }, { status: 409 })
  if (!stored) await saveDailyPick(db, steamid, dateStr, selection, now)

  const { pick, shelf, hoursPlayed } = selection

  // Цены обновляем ДО того, как пишется текст: и шаблон карточки, и подпись
  // под ценой называют одну и ту же сумму, а расходиться им нельзя.
  //
  // Читаются они на КАЖДОМ заходе, включая попадание в запись: цена и скидка —
  // это ровно то, что за сутки успевает измениться, и замораживать их вместе
  // с выбором было бы худшим из двух миров. Четыре appid, один запрос.
  const pricedIds = [...new Set([pick, ...shelf].map((c) => c.appid))]
  await refreshDealsWithin(db, pricedIds, now)
  const priced = await getGamesMeta(db, pricedIds)
  const metaNow = (appid: number): GameMeta | undefined => priced.get(appid)

  const reason = heuristicPicks([pick], metaNow, NEUTRAL_MOOD, 1, now)[0]?.reason ?? ''

  const meta = metaNow(pick.appid)
  const topTags = Object.entries(meta?.tags ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([t]) => t)

  return NextResponse.json({
    pick: {
      ...pick,
      reason,
      // Ссылку не угадываем шаблоном — путь Steam контент-адресуемый.
      // Клиент соберёт нужный размер сам через GameArt.
      headerImage: meta?.headerImage ?? null,
      art: meta?.art ?? null,
      // Кадры отдаём целиком: сколько из них показать, решает сам герой —
      // это упирается в бюджет видеопамяти слайдера, а не в состав ответа.
      screenshots: meta?.screenshots ?? [],
      ccu: meta?.ccu ?? null,
      tags: topTags,
      hoursPlayed,
      store: meta?.store ?? null,
      storeUrl: meta?.storeUrl ?? null,
      priceFinal: meta?.priceFinal ?? null,
      isFree: meta?.isFree ?? null,
      // Скидка — разговор про покупку: у своей игры «−40%» сообщает только то,
      // что ты купил её дороже. Считается на сервере вместе с подписью срока —
      // у клиента свой часовой пояс, и «до 17 августа» разъехалось бы.
      discount: pick.source === 'new' && meta ? discountView(meta, now) : null,
    },
    discoveries: shelf.map((c) => {
      const m = metaNow(c.appid)
      return {
        appid: c.appid,
        name: c.name,
        headerImage: m?.headerImage ?? null,
        art: m?.art ?? null,
        store: m?.store ?? null,
        storeUrl: m?.storeUrl ?? null,
        priceFinal: m?.priceFinal ?? null,
        isFree: m?.isFree ?? null,
        discount: m ? discountView(m, now) : null,
      }
    }),
    dateLabel: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
  })
}

/** Отличаем «библиотеки нет» от «кандидатов нет»: у них разные коды ответа */
const NO_LIBRARY = Symbol('nolibrary')

/**
 * Собственно отбор — всё, что стоит дорого и на сутки не меняется.
 *
 * Вынесен из GET целиком, а не разбит по месту: у него один вход (steamid и
 * дата) и один выход, и попадание в запись должно уметь пропустить его весь,
 * а не половину.
 */
async function selectDaily(
  db: Awaited<ReturnType<typeof getDb>>,
  steamid: string,
  dateStr: string,
  now: number,
): Promise<DailySelection | null | typeof NO_LIBRARY> {
  const snapshot = await getLatestSnapshot(db, steamid)
  if (!snapshot) return NO_LIBRARY

  const games = snapshot.games
  const owned = new Set(games.map((g) => g.appid))
  // Второй ключ владения — по названию: у Skyrim и Skyrim Special Edition
  // разные appid, и по одному только owned находки предлагали бы купить то,
  // что уже стоит в библиотеке
  const ownedKeys = new Set(games.map((g) => editionKey(g.name)).filter(Boolean))

  const libMetas = await getGamesMeta(
    db,
    games.map((g) => g.appid),
  )
  const poolByAppid = new Map<number, GameMeta>()
  const metaOf = (appid: number): GameMeta | undefined =>
    libMetas.get(appid) ?? poolByAppid.get(appid)
  const banned = await bannedAppids(db, steamid)

  const feedback = await listFeedback(db, steamid, 300)
  const profile = applyFeedbackToProfile(
    buildTagProfile(games, (id) => libMetas.get(id)),
    feedback,
    metaOf,
  )

  // Каталог тут больше не лишний: «игра дня» перестала быть только разбором
  // купленного. Пул тот же, что в основной выдаче, одним запросом с LIMIT.
  const [tagStats, poolSize] = await Promise.all([loadTagStats(db), getPoolSize(db)])
  const newPool = (
    await fetchDiscoveryPool(db, {
      tags: pickQueryTags(profile, tagStats, poolSize),
      bannedAppids: [...banned],
      // на этой странице настроение всегда одиночное
      requireMultiplayer: false,
      rotation: rotationSlot(steamid, now),
      limit: 400,
      wildcard: WILDCARD_POOL,
    })
  ).filter((m) => !owned.has(m.appid) && !ownedKeys.has(editionKey(m.name)))
  for (const m of newPool) poolByAppid.set(m.appid, m)

  const candidates = scoreCandidates({
    profile,
    library: games,
    metaOf,
    newPool,
    mood: NEUTRAL_MOOD,
    nowSec: now,
    limit: CANDIDATE_LIMIT,
  }).filter((c) => !banned.has(c.appid))

  if (!candidates.length) return null

  // Своя библиотека не проходит офлайн-фильтры каталога, поэтому актуальность
  // считаем здесь: иначе игрой дня становился мёртвый мультиплеер.
  //
  // Метаданные каталога идут в тот же расчёт — серия определяется по группе
  // целиком. Но только по КАНДИДАТАМ, а не по всем четырём сотням пула:
  // лишние члены группы ничего не судят, зато могут её возглавить, и случайная
  // «Часть 3» из хвоста каталога отменила бы работавшее вытеснение.
  const judged = new Set(candidates.map((c) => c.appid))
  const allMetas = new Map(libMetas)
  for (const [appid, meta] of poolByAppid) {
    if (judged.has(appid) && !allMetas.has(appid)) allMetas.set(appid, meta)
  }
  const actual = filterActual(candidates, allMetas, 'solo')

  const seed = `${steamid}:${dateStr}`
  const { own, discovery } = splitBySource(actual)
  const pick = pickDaily(pickDailyPool(own, discovery, seed), seed)!

  // Полка находок — всегда из каталога, даже когда герой уже оттуда: одна и та
  // же игра дважды на экране выглядит сбоем, а не рекомендацией
  const shelf = discovery.filter((c) => c.appid !== pick.appid).slice(0, DISCOVERY_CARDS)

  // Часы запоминаем здесь, а не считаем на выдаче: снапшот читается только на
  // этом пути, и попадание в запись обязано уметь обойтись без него.
  const lib = games.find((g) => g.appid === pick.appid)

  return { pick, shelf, hoursPlayed: lib ? Math.round(lib.playtimeForever / 60) : null }
}
