import { NextResponse } from 'next/server'
import { pickDaily, pickDailyPool, publicPick } from '@/lib/daily'
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
import { heuristicPicks, reasonPrice } from '@/lib/llm'
import { fetchDiscoveryPool, pickQueryTags, rotationSlot } from '@/lib/pool'
import { refundEligible } from '@/lib/refund'
import {
  applyFeedbackToProfile,
  buildAnchorFinder,
  buildTagProfile,
  cooldownOf,
  hideUrgencyFor,
  sharedTasteTags,
  scoreCandidates,
  splitBySource,
} from '@/lib/recommend'
import { NEUTRAL_MOOD } from '@/lib/mood'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { tagWeightFrom } from '@/lib/tagweight'
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
 * Игра дня одна на сутки, а её отбор стоит около восьмисот прочитанных строк
 * Turso: снапшот, метаданные библиотеки, фидбек, статистика тегов и пул на
 * четыре сотни кандидатов. Десяти обращений в час хватает и на перезагрузки, и
 * на несколько устройств, но не на цикл.
 */
const DAILY_LIMIT = 10
const DAILY_WINDOW_SEC = 3600

/** Кандидат в том виде, в каком он уходит клиенту и в запись дня */
type DailyCard = ReturnType<typeof publicPick>

/**
 * Что именно запоминается на сутки.
 *
 * Герой, полка и часы — результат ОТБОРА: он опирается на пул каталога,
 * профиль вкуса и фидбек и до полуночи меняться не должен по определению
 * страницы. Вместе с ним — всё, для чего иначе пришлось бы снова читать
 * библиотеку: основа причины (якорь и совпавшие теги уже вписаны в неё),
 * отметки на чипсах и флаг hideUrgency.
 *
 * Цены здесь НЕТ, и это не упущение. Ценовой хвост причины («Сейчас −40%:
 * …») и ценник под ней живут своей осью свежести и пересчитываются на каждом
 * заходе: запомнить их значило бы заморозить вчерашнюю сумму рядом с
 * сегодняшним ценником — ровно то расхождение, против которого написан
 * комментарий у refreshDealsWithin ниже.
 *
 * Скора и его частей тоже нет: запись хранит publicPick, а не кандидата.
 */
type DailySelection = {
  pick: DailyCard
  shelf: DailyCard[]
  hoursPlayed: number | null
  /** Причина без ценового хвоста; хвост — reasonPrice на каждом заходе */
  reasonBase: string
  sharedTags: string[]
  hideUrgency: boolean
}

function parseCard(raw: unknown): DailyCard | null {
  if (!raw || typeof raw !== 'object') return null
  const { appid, name, source } = raw as Record<string, unknown>
  if (typeof appid !== 'number' || !Number.isInteger(appid)) return null
  if (typeof name !== 'string') return null
  if (!CANDIDATE_SOURCES.includes(source as never)) return null
  return { appid, name, source: source as ScoredCandidate['source'] }
}

/**
 * Разбор с проверкой формы, а не приведение типом.
 *
 * Строку писала, возможно, предыдущая версия приложения, и состав записи с
 * тех пор мог измениться. Непрошедшая запись — не ошибка: маршрут просто
 * пересчитает выбор и перезапишет её. Сид тот же (steamid:дата), так что для
 * человека, у которого пул и вкус с утра не изменились, ответ останется
 * прежним.
 */
function parseSelection(raw: unknown): DailySelection | null {
  if (!raw || typeof raw !== 'object') return null
  const { pick, shelf, hoursPlayed, reasonBase, sharedTags, hideUrgency } = raw as Record<
    string,
    unknown
  >
  const parsedPick = parseCard(pick)
  if (!parsedPick) return null
  if (!Array.isArray(shelf)) return null
  const parsedShelf: DailyCard[] = []
  for (const item of shelf) {
    const c = parseCard(item)
    if (!c) return null
    parsedShelf.push(c)
  }
  if (hoursPlayed !== null && typeof hoursPlayed !== 'number') return null
  if (typeof reasonBase !== 'string') return null
  if (!Array.isArray(sharedTags) || !sharedTags.every((t) => typeof t === 'string')) return null
  if (typeof hideUrgency !== 'boolean') return null
  return {
    pick: parsedPick,
    shelf: parsedShelf,
    hoursPlayed,
    reasonBase,
    sharedTags,
    hideUrgency,
  }
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
   * Отбор ниже стоит около восьмисот прочитанных строк Turso ради ответа,
   * который по определению страницы не меняется до полуночи. Дата берётся в
   * UTC — тем же способом, что и сид в selectDaily: сид и ключ записи обязаны
   * сходиться, иначе на границе суток они разъедутся и «одна игра на день»
   * перестанет быть правдой. Бан и «надоела» запись сбрасывают сразу (см.
   * forgetDailyPick в /api/feedback) — их отбор обязан учесть в тот же день.
   */
  const dateStr = new Date().toISOString().slice(0, 10)
  const stored = parseSelection(await getDailyPick(db, steamid, dateStr))

  const selection = stored ?? (await selectDaily(db, steamid, dateStr, now))
  if (selection === NO_LIBRARY) return NextResponse.json({ error: 'nolibrary' }, { status: 409 })
  if (!selection) return NextResponse.json({ error: 'nocandidates' }, { status: 409 })
  if (!stored) await saveDailyPick(db, steamid, dateStr, selection, now)

  const { pick, shelf, hoursPlayed, reasonBase, sharedTags, hideUrgency } = selection

  // Цены обновляем ДО того, как пишется текст: и хвост причины, и подпись
  // под ценой называют одну и ту же сумму, а расходиться им нельзя.
  //
  // Читаются они на КАЖДОМ заходе, включая попадание в запись: цена и скидка —
  // это ровно то, что за сутки успевает измениться, и замораживать их вместе
  // с выбором было бы худшим из двух миров. Четыре appid, один запрос.
  const pricedIds = [...new Set([pick, ...shelf].map((c) => c.appid))]
  await refreshDealsWithin(db, pricedIds, now)
  const priced = await getGamesMeta(db, pricedIds)
  const metaNow = (appid: number): GameMeta | undefined => priced.get(appid)

  const meta = metaNow(pick.appid)
  const reason = reasonBase + reasonPrice(pick.source, meta, now, hideUrgency)
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
      // Чипсы совпавших тегов помечаются на экране, и метка обязана считаться
      // там же, где лежит профиль вкуса, — то есть в отборе; здесь она из
      // записи. Настроения у «Игры дня» нет — поэтому sharedTasteTags, а не
      // explainMatch: процент и вайб тут не о чем.
      sharedTags,
      hoursPlayed,
      store: meta?.store ?? null,
      storeUrl: meta?.storeUrl ?? null,
      priceFinal: meta?.priceFinal ?? null,
      isFree: meta?.isFree ?? null,
      // Скидка — разговор про покупку: у своей игры «−40%» сообщает только то,
      // что ты купил её дороже. Считается на сервере вместе с подписью срока —
      // у клиента свой часовой пояс, и «до 17 августа» разъехалось бы.
      discount:
        pick.source === 'new' && meta ? discountView(meta, now, { urgency: !hideUrgency }) : null,
      // Страховка покупки — там же, где цена: только у не купленного
      refund: pick.source === 'new' && meta ? refundEligible(meta, now) : false,
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
        discount: m ? discountView(m, now, { urgency: !hideUrgency }) : null,
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
  // Вес редкости — тот же, что в основной выдаче: и причина, и отметки на
  // чипсах называют характерные теги, а не Indie с Action
  const tagWeight = tagWeightFrom(tagStats)
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
    // баны до отсечки, а не после — см. тот же параметр в /api/recommend
    exclude: banned,
    tagWeight,
    // Только «надоела»: «не сейчас» на /play посреди дня иначе сменило бы
    // игру, выбранную на сутки
    cooldown: cooldownOf(feedback, now, ['tired']),
  })

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

  const lib = games.find((g) => g.appid === pick.appid)
  const hoursPlayed = lib ? Math.round(lib.playtimeForever / 60) : null
  // Срок распродажи — тем, у кого нераспакованного немного: см. тот же флаг
  // в /api/recommend
  const hideUrgency = hideUrgencyFor(games, (id) => libMetas.get(id))

  // Тот же контекст причины, что в основной выдаче: своя игра, на которую эта
  // похожа, вместо тегов, и свои часы у заброшенной. Баны якорем не бывают.
  const findAnchor = buildAnchorFinder(games, (id) => libMetas.get(id), tagWeight, banned)
  const reason =
    heuristicPicks([pick], metaOf, 1, now, profile, {
      tagWeight,
      anchorOf: (appid) => {
        const m = metaOf(appid)
        return m ? findAnchor(m) : null
      },
      hoursOf: (appid) => (appid === pick.appid ? hoursPlayed : null),
      hideUrgency,
    })[0]?.reason ?? ''
  // В запись уходит причина БЕЗ ценового хвоста: heuristicPicks клеит его
  // последним (reasonPrice), и на каждом заходе он пересчитывается по свежей
  // цене. Хвост тут считается по тем же метаданным, что и сама причина, —
  // поэтому срез всегда попадает ровно по шву.
  const tail = reasonPrice(pick.source, metaOf(pick.appid), now, hideUrgency)
  const reasonBase = tail && reason.endsWith(tail) ? reason.slice(0, -tail.length) : reason

  const meta = metaOf(pick.appid)
  return {
    pick: publicPick(pick),
    shelf: shelf.map(publicPick),
    hoursPlayed,
    reasonBase,
    sharedTags: meta ? sharedTasteTags(profile, meta, tagWeight) : [],
    hideUrgency,
  }
}
