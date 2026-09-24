import { NextResponse } from 'next/server'
import { buildCandidates } from '@/lib/candidates'
import { dailyCardView, pickContext, storeCardView } from '@/lib/cards'
import { dayKey, pickDaily, pickDailyPool, publicPick } from '@/lib/daily'
import { getDailyPick, getGamesMeta, saveDailyPick } from '@/lib/db'
import { refreshDealsWithin } from '@/lib/deals'
import { dayLabel } from '@/lib/freshness'
import { heuristicPicks, reasonPrice } from '@/lib/llm'
import { NEUTRAL_MOOD } from '@/lib/mood'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { sharedTasteTags } from '@/lib/recommend'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { CANDIDATE_SOURCES, type GameMeta, type ScoredCandidate } from '@/lib/types'

/** Сколько находок из каталога показываем полкой под героем */
const DISCOVERY_CARDS = 3

/**
 * Игра дня одна на сутки, а её отбор стоит около восьмисот прочитанных строк
 * Turso: снапшот, метаданные библиотеки, фидбек, статистика тегов и пул на
 * четыре сотни кандидатов. Десяти обращений в час хватает и на перезагрузки, и
 * на несколько устройств, но не на цикл.
 */
const DAILY_LIMIT = 10
const DAILY_WINDOW_SEC = 3600

/** Кандидат в том виде, в каком он уходит в запись дня */
type Chosen = ReturnType<typeof publicPick>

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
  pick: Chosen
  shelf: Chosen[]
  hoursPlayed: number | null
  /** Причина без ценового хвоста; хвост — reasonPrice на каждом заходе */
  reasonBase: string
  sharedTags: string[]
  hideUrgency: boolean
}

function parseCard(raw: unknown): Chosen | null {
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
  const parsedShelf: Chosen[] = []
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

export async function GET(req: Request) {
  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  const now = nowSec()

  /*
   * Выбор дня — из записи, если она уже есть.
   *
   * Отбор ниже стоит около восьмисот прочитанных строк Turso ради ответа,
   * который по определению страницы не меняется до полуночи — московской
   * (dayKey в lib/daily). Одна дата и для ключа записи, и для сида в
   * selectDaily, и для подписи: разойдись они — на границе суток «одна игра
   * на день» перестала бы быть правдой. Бан и «надоела» запись сбрасывают
   * сразу (см. forgetDailyPick в /api/feedback) — их отбор обязан учесть в
   * тот же день.
   */
  const dateStr = dayKey(now)
  const stored = parseSelection(await getDailyPick(db, steamid, dateStr))

  /*
   * ?cached=1 — «только если уже выбрано».
   *
   * Страница спрашивает так ДО прогрева каталога. Прогрев нужен отбору, а не
   * записанному выбору, и раньше каждый заход на /daily ждал его целиком —
   * до трёх минут у большой библиотеки — ради игры, которая с утра уже лежит
   * в daily_picks. Промах — 204 без отбора: страница прогреет каталог и
   * спросит обычным запросом.
   *
   * Промах не тратит лимит частоты: он стоит одного чтения по первичному
   * ключу, как сама проверка лимита, а следующий за ним обычный запрос своё
   * отметит. Иначе каждый первый заход дня списывал бы два обращения из десяти.
   */
  if (!stored && new URL(req.url).searchParams.get('cached') === '1') {
    return new NextResponse(null, { status: 204 })
  }

  const gate = await checkRate(db, {
    bucket: 'daily',
    id: steamid,
    limit: DAILY_LIMIT,
    windowSec: DAILY_WINDOW_SEC,
    nowSec: now,
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

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
  // с выбором было бы худшим из двух миров. Четыре appid, один запрос —
  // строкой целиком: у героя дня показываются кадры.
  const pricedIds = [...new Set([pick, ...shelf].map((c) => c.appid))]
  await refreshDealsWithin(db, pricedIds, now)
  const priced = await getGamesMeta(db, pricedIds)
  const metaNow = (appid: number): GameMeta | undefined => priced.get(appid)

  const reason = reasonBase + reasonPrice(pick.source, metaNow(pick.appid), now, hideUrgency)

  return NextResponse.json({
    // см. докблок в PlayersNow: подпись «сейчас» требует серверных часов
    nowSec: now,
    // Карточка — lib/cards: тот же контракт, по которому /daily берёт тип
    pick: dailyCardView(pick, metaNow(pick.appid), now, {
      reason,
      sharedTags,
      hoursPlayed,
      hideUrgency,
    }),
    discoveries: shelf.map((c) => storeCardView(c, metaNow(c.appid), now, hideUrgency)),
    // Из того же dateStr, что и ключ записи — см. dayLabel.
    dateLabel: dayLabel(dateStr),
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
  // Конвейер тот же, что у /play (lib/candidates.ts): настроения у страницы
  // нет, знакомого и оси тоже, а из пауз — только «надоела»: «не сейчас» на
  // /play посреди дня иначе сменило бы игру, выбранную на сутки
  const set = await buildCandidates(db, steamid, NEUTRAL_MOOD, 'all', {
    nowSec: now,
    cooldownKinds: ['tired'],
  })
  if (set === 'nolibrary') return NO_LIBRARY
  if (set === 'nocandidates') return null
  const { own, discovery, profile, tagWeight, metaOf } = set

  const seed = `${steamid}:${dateStr}`
  const pick = pickDaily(pickDailyPool(own, discovery, seed), seed)!

  // Полка находок — всегда из каталога, даже когда герой уже оттуда: одна и та
  // же игра дважды на экране выглядит сбоем, а не рекомендацией
  const shelf = discovery.filter((c) => c.appid !== pick.appid).slice(0, DISCOVERY_CARDS)

  // Тот же контекст причины, что в основной выдаче: своя игра, на которую эта
  // похожа, вместо тегов, свои часы у заброшенной и срок распродажи только
  // тем, у кого нераспакованного немного. Цены здесь не обновляются — это
  // делает GET на каждом заходе.
  const ctx = pickContext(set)
  const hoursPlayed = ctx.hoursOf(pick.appid)
  const hideUrgency = ctx.hideUrgency
  const reason =
    heuristicPicks([pick], metaOf, 1, now, profile, {
      tagWeight,
      anchorOf: ctx.anchorOf,
      hoursOf: ctx.hoursOf,
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
