import { NextResponse } from 'next/server'
import { buildCandidates } from '@/lib/candidates'
import { dailyCardView, pickContext, storeCardView } from '@/lib/cards'
import {
  dayKey,
  dayStartSec,
  parseDailySelection,
  pickDaily,
  pickDailyPool,
  pickOwnAlternate,
  publicPick,
  type DailyAlternate,
  type DailySelection,
} from '@/lib/daily'
import { getDailyPick, getGamesMeta, saveDailyPick } from '@/lib/db'
import { refreshDealsWithin } from '@/lib/deals'
import { dayLabel } from '@/lib/freshness'
import { heuristicPicks, reasonPrice } from '@/lib/llm'
import { NEUTRAL_MOOD } from '@/lib/mood'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { sharedTasteTags } from '@/lib/recommend'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import type { GameMeta, ScoredCandidate } from '@/lib/types'

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

/*
 * Что запоминается на сутки и как запись разбирается — lib/daily.ts
 * (DailySelection, parseDailySelection): «Не сегодня» в /api/feedback читает
 * ту же запись, чтобы понять, про героя ли дня оно сказано.
 */

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
   * тот же день; «Не сегодня» — только когда сказано про героя дня или
   * запасную свою.
   */
  const dateStr = dayKey(now)
  const cachedOnly = new URL(req.url).searchParams.get('cached') === '1'
  const dailyGate = () =>
    checkRate(db, {
      bucket: 'daily',
      id: steamid,
      limit: DAILY_LIMIT,
      windowSec: DAILY_WINDOW_SEC,
      nowSec: now,
    })
  // Обычный запрос тратит лимит в любом случае — запись и гейт читаются
  // одним заходом. «Только если уже выбрано» — по очереди: его промах лимит
  // не тратит (см. ниже), значит гейт там нельзя звать заранее.
  const [rawStored, early] = await Promise.all([
    getDailyPick(db, steamid, dateStr),
    cachedOnly ? Promise.resolve(null) : dailyGate(),
  ])
  const stored = parseDailySelection(rawStored)

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
  if (!stored && cachedOnly) {
    return new NextResponse(null, { status: 204 })
  }

  const gate = early ?? (await dailyGate())
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  const selection = stored ?? (await selectDaily(db, steamid, dateStr, now))
  if (selection === NO_LIBRARY) return NextResponse.json({ error: 'nolibrary' }, { status: 409 })
  if (!selection) return NextResponse.json({ error: 'nocandidates' }, { status: 409 })
  if (!stored) await saveDailyPick(db, steamid, dateStr, selection, now)

  const { pick, shelf, hoursPlayed, reasonBase, sharedTags, via, hideUrgency, alt } = selection

  // Цены обновляем ДО того, как пишется текст: и хвост причины, и подпись
  // под ценой называют одну и ту же сумму, а расходиться им нельзя.
  //
  // Читаются они на КАЖДОМ заходе, включая попадание в запись: цена и скидка —
  // это ровно то, что за сутки успевает измениться, и замораживать их вместе
  // с выбором было бы худшим из двух миров. Четыре appid, один запрос —
  // строкой целиком: у героя дня показываются кадры.
  const pricedIds = [...new Set([pick, ...shelf, ...(alt ? [alt.pick] : [])].map((c) => c.appid))]
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
      via,
    }),
    discoveries: shelf.map((c) => storeCardView(c, metaNow(c.appid), now, hideUrgency)),
    // «Сегодня хочу из своего» — только в магазинный день и только по нажатию
    ownAlternate: alt ? alternateView(alt, metaNow(alt.pick.appid), now, hideUrgency) : null,
    // Из того же dateStr, что и ключ записи — см. dayLabel.
    dateLabel: dayLabel(dateStr),
  })
}

/** Запасная своя — той же карточкой, что герой: цена и хвост причины свежие */
function alternateView(alt: DailyAlternate, meta: GameMeta | undefined, now: number, hideUrgency: boolean) {
  return dailyCardView(alt.pick, meta, now, {
    reason: alt.reasonBase + reasonPrice(alt.pick.source, meta, now, hideUrgency),
    sharedTags: alt.sharedTags,
    hoursPlayed: alt.hoursPlayed,
    hideUrgency,
    via: alt.via,
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
  // /play посреди дня иначе сменило бы игру, выбранную на сутки. Сказанное
  // сегодня «Не сегодня» — другое дело: отбор, пересчитанный после него, не
  // имеет права вернуть ту же игру до полуночи
  const set = await buildCandidates(db, steamid, NEUTRAL_MOOD, 'all', {
    nowSec: now,
    cooldownKinds: ['tired'],
    notnowSince: dayStartSec(now),
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
  const hideUrgency = ctx.hideUrgency

  /** Герой — в запись: публичные поля, часы, причина без цены и отметки чипсов */
  const describe = (c: ScoredCandidate): DailyAlternate => {
    const reason =
      heuristicPicks([c], metaOf, 1, now, profile, {
        tagWeight,
        anchorOf: ctx.anchorOf,
        hoursOf: ctx.hoursOf,
        hideUrgency,
      })[0]?.reason ?? ''
    // В запись уходит причина БЕЗ ценового хвоста: heuristicPicks клеит его
    // последним (reasonPrice), и на каждом заходе он пересчитывается по свежей
    // цене. Хвост тут считается по тем же метаданным, что и сама причина, —
    // поэтому срез всегда попадает ровно по шву.
    const tail = reasonPrice(c.source, metaOf(c.appid), now, hideUrgency)
    const meta = metaOf(c.appid)
    return {
      pick: publicPick(c),
      hoursPlayed: ctx.hoursOf(c.appid),
      reasonBase: tail && reason.endsWith(tail) ? reason.slice(0, -tail.length) : reason,
      sharedTags: meta ? sharedTasteTags(profile, meta, tagWeight) : [],
      via: ctx.anchorOf(c.appid),
    }
  }

  // Магазинный день — и своя наготове, тем же сидом из своего пула: кто
  // сегодня покупать не собирался, получает свою по нажатию, а не уходит
  // в обычный подбор
  const alternate = pickOwnAlternate(own, discovery, seed)

  return {
    ...describe(pick),
    shelf: shelf.map(publicPick),
    hideUrgency,
    alt: alternate ? describe(alternate) : null,
  }
}
