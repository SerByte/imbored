import { NextResponse } from 'next/server'
import { buildCandidates } from '@/lib/candidates'
import { comebackPatches, dailyCardView, pickContext, storeCardView } from '@/lib/cards'
import {
  dailyHeroAppids,
  dailyReasonBase,
  dayKey,
  dayStartSec,
  parseDailySelection,
  pickDaily,
  pickDailyPool,
  pickOwnAlternate,
  publicPick,
  yesterdayLine,
  type DailyAlternate,
  type DailySelection,
} from '@/lib/daily'
import { getDailyPick, getGamesMeta, saveDailyPick } from '@/lib/db'
import { refreshDealsWithin } from '@/lib/deals'
import { dayLabel } from '@/lib/freshness'
import { heuristicPicks, reasonPrice } from '@/lib/llm'
import { NEUTRAL_MOOD } from '@/lib/mood'
import { checkRate, clientIp, personalRateId, rateLimitedResponse } from '@/lib/ratelimit'
import { sharedTasteTags } from '@/lib/recommend'
import { shareView } from '@/lib/pickshare'
import { shareText } from '@/lib/sharedpick'
import { currentSession, getDb, isWriter, nowSec, sessionSecret } from '@/lib/server'
import type { GameMeta, ScoredCandidate } from '@/lib/types'

/** Сколько находок из каталога показываем полкой под героем */
const DISCOVERY_CARDS = 3

/**
 * Игра дня одна на сутки, а её отбор стоит около восьмисот прочитанных строк
 * Turso: снапшот, метаданные библиотеки, фидбек, статистика тегов и пул на
 * четыре сотни кандидатов. Десяти обращений в час хватает и на перезагрузки, и
 * на несколько устройств, но не на цикл.
 *
 * Личный потолок — на того, кто спрашивает, а не на steamid (personalRateId
 * в lib/ratelimit). «Несколько устройств» — это writer: вошедший через Steam
 * делит десятку между телефоном и ноутбуком. Сессия по ссылке считается сама
 * по себе: её выдают на любой публичный профиль, и при общем счётчике чужой
 * десятью запросами запирал владельцу /daily на час, час за часом.
 *
 * А раз сессия по ссылке — свой счётчик, рядом стоит потолок адреса: без него
 * свежие сессии с одного адреса (/api/connect чеканит их до сорока восьми в
 * час) множили бы отборы. Но только отборы: запись дня одна на steamid и
 * общая для всех его сессий (daily_picks), а попадание в неё — два чтения по
 * первичному ключу и цены — свежей сессией не размножить. Поэтому адрес
 * платит лишь за отбор, а заход в уже выбранную игру дня и ?cached=1 его
 * потолок не трогают. Иначе общий NAT — мобильный оператор, общежитие,
 * офис — тридцатью обычными заходами в час запирал бы игру дня всем за ним,
 * вошедшим через Steam тоже. Тридцать отборов в час — втрое выше личного,
 * как у /api/recommend и /api/explore: соседям по NAT своя игра дня нужна
 * так же.
 */
const DAILY_LIMIT = 10
const DAILY_IP_LIMIT = 30
const DAILY_WINDOW_SEC = 3600

/*
 * Что запоминается на сутки и как запись разбирается — lib/daily.ts
 * (DailySelection, parseDailySelection): «Не сегодня» в /api/feedback читает
 * ту же запись, чтобы понять, про героя ли дня оно сказано.
 */

export async function GET(req: Request) {
  const session = await currentSession()
  if (!session) return NextResponse.json({ error: 'nosession' }, { status: 401 })
  const { steamid } = session
  // Крупный патч после последнего запуска — производная от даты запуска:
  // в запись он ложится всегда, а в ответ — только writer-сессии (dailyReasonBase)
  const writer = isWriter(session)

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
  const personalGate = () =>
    checkRate(db, {
      bucket: 'daily',
      id: personalRateId(session, writer),
      limit: DAILY_LIMIT,
      windowSec: DAILY_WINDOW_SEC,
      nowSec: now,
    })
  // Обычный запрос тратит личный лимит в любом случае — запись и гейт
  // читаются одним заходом. «Только если уже выбрано» — по очереди: его
  // промах лимит не тратит (см. ниже), значит гейт там нельзя звать заранее.
  // Потолок адреса — позже и не всегда: только перед отбором (см. ниже).
  //
  // Запись за вчера — тем же заходом: она нужна и отбору (исключение
  // вчерашнего героя, см. selectDaily), и ответу (строка «Вчера была: …»,
  // yesterdayLine). Минус сутки секундами — и есть вчера: перевода часов в
  // Москве нет. Она ещё в базе: крон подметает только то, что старше
  // вчерашнего (sweepDailyPicks), а сброс после бана, «надоела» и «Не
  // сегодня» стирает сегодняшнюю (forgetDailyPick). Вчерашнюю — только бан
  // и «надоела» про её же героя: ссылка на скрытую игру строкой не нужна.
  const [rawStored, rawYesterday, early] = await Promise.all([
    getDailyPick(db, steamid, dateStr),
    getDailyPick(db, steamid, dayKey(now - 86_400)),
    cachedOnly ? Promise.resolve(null) : personalGate(),
  ])
  const stored = parseDailySelection(rawStored)
  const yesterday = parseDailySelection(rawYesterday)

  /*
   * ?cached=1 — «только если уже выбрано».
   *
   * Страница спрашивает так ДО прогрева каталога. Прогрев нужен отбору, а не
   * записанному выбору, и раньше каждый заход на /daily ждал его целиком —
   * до трёх минут у большой библиотеки — ради игры, которая с утра уже лежит
   * в daily_picks. Промах — 204 без отбора: страница прогреет каталог и
   * спросит обычным запросом.
   *
   * Промах не тратит лимит частоты: он стоит двух чтений по первичному
   * ключу (сегодня и вчера), а следующий за ним обычный запрос своё
   * отметит. Иначе каждый первый заход дня списывал бы два обращения из десяти.
   */
  if (!stored && cachedOnly) {
    return new NextResponse(null, { status: 204 })
  }

  const gate = early ?? (await personalGate())
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  /*
   * Потолок адреса — только когда впереди отбор: размножить свежими сессиями
   * можно лишь его (см. DAILY_IP_LIMIT). После личного, как в
   * checkRatesInOrder: отказанный по личному потолку запрос место соседей по
   * адресу не съедает. Параллельные запросы по свежему steamid все видят
   * пустую запись и все проходят здесь — значит, гонка потолок не обходит.
   */
  if (!stored) {
    const byIp = await checkRate(db, {
      bucket: 'daily-ip',
      id: clientIp(req.headers),
      limit: DAILY_IP_LIMIT,
      windowSec: DAILY_WINDOW_SEC,
      nowSec: now,
    })
    if (!byIp.ok) return rateLimitedResponse(byIp.retryAfterSec)
  }

  const selection = stored ?? (await selectDaily(db, steamid, dateStr, now, yesterday))
  if (selection === NO_LIBRARY) return NextResponse.json({ error: 'nolibrary' }, { status: 409 })
  if (!selection) return NextResponse.json({ error: 'nocandidates' }, { status: 409 })
  if (!stored) await saveDailyPick(db, steamid, dateStr, selection, now)

  const { pick, shelf, hoursPlayed, sharedTags, via, hideUrgency, alt } = selection
  const reasonBase = dailyReasonBase(selection, writer)

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
    pick: {
      ...dailyCardView(pick, metaNow(pick.appid), now, {
        reason,
        sharedTags,
        hoursPlayed,
        hideUrgency,
        via,
      }),
      // «Отправить другу» (/pick) — основа причины, без свежего ценового хвоста
      // и без факта о патче даже у writer: «С твоего последнего захода…» на
      // публичной странице получатель прочтёт про себя, а дату запуска она
      // выдаст любому (lib/comeback.ts). Поэтому selection.reasonBase, а не
      // dailyReasonBase
      ...shareView(sessionSecret(), {
        steamid,
        appid: pick.appid,
        source: pick.source,
        text: shareText(selection.reasonBase, ''),
      }),
    },
    discoveries: shelf.map((c) => storeCardView(c, metaNow(c.appid), now, hideUrgency)),
    // «Сегодня хочу из своего» — только в магазинный день и только по нажатию
    ownAlternate: alt
      ? {
          ...alternateView(alt, metaNow(alt.pick.appid), now, hideUrgency, writer),
          ...shareView(sessionSecret(), {
            steamid,
            appid: alt.pick.appid,
            source: alt.pick.source,
            text: shareText(alt.reasonBase, ''),
          }),
        }
      : null,
    // Из того же dateStr, что и ключ записи — см. dayLabel.
    dateLabel: dayLabel(dateStr),
    // «Вчера была: …» — из вчерашней записи, без сети; null — строки нет
    // (см. yesterdayLine: нет записи, нет имени или вчерашняя снова на экране;
    // скрытую сегодня стирает /api/feedback вместе с записью)
    yesterday: yesterdayLine(yesterday, selection),
  })
}

/** Запасная своя — той же карточкой, что герой: цена и хвост причины свежие */
function alternateView(
  alt: DailyAlternate,
  meta: GameMeta | undefined,
  now: number,
  hideUrgency: boolean,
  writer: boolean,
) {
  return dailyCardView(alt.pick, meta, now, {
    reason: dailyReasonBase(alt, writer) + reasonPrice(alt.pick.source, meta, now, hideUrgency),
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
  yesterday: DailySelection | null,
): Promise<DailySelection | null | typeof NO_LIBRARY> {
  // Конвейер тот же, что у /play (lib/candidates.ts): настроения у страницы
  // нет, знакомого и оси тоже, а из пауз — только «надоела»: «не сейчас» на
  // /play посреди дня иначе сменило бы игру, выбранную на сутки. Сказанное
  // сегодня «Не сегодня» — другое дело: отбор, пересчитанный после него, не
  // имеет права вернуть ту же игру до полуночи
  //
  // yesterday — запись за вчера, её читает GET тем же заходом, что и
  // сегодняшнюю: вчерашний герой сегодня героем не станет (avoid у
  // pickDaily). Записи нет или она не разобралась — выбор без исключения,
  // как раньше.
  const set = await buildCandidates(db, steamid, NEUTRAL_MOOD, 'all', {
    nowSec: now,
    cooldownKinds: ['tired'],
    notnowSince: dayStartSec(now),
  })
  if (set === 'nolibrary') return NO_LIBRARY
  if (set === 'nocandidates') return null
  const { own, discovery, profile, tagWeight, metaOf } = set

  const seed = `${steamid}:${dateStr}`
  const avoid = dailyHeroAppids(yesterday)
  const pick = pickDaily(pickDailyPool(own, discovery, seed), seed, avoid)!

  // Полка находок — всегда из каталога, даже когда герой уже оттуда: одна и та
  // же игра дважды на экране выглядит сбоем, а не рекомендацией
  const shelf = discovery.filter((c) => c.appid !== pick.appid).slice(0, DISCOVERY_CARDS)

  // Магазинный день — и своя наготове, тем же сидом из своего пула: кто
  // сегодня покупать не собирался, получает свою по нажатию, а не уходит
  // в обычный подбор
  const alternate = pickOwnAlternate(own, discovery, seed, avoid)

  // Тот же контекст причины, что в основной выдаче: своя игра, на которую эта
  // похожа, вместо тегов, свои часы у заброшенной и срок распродажи только
  // тем, у кого нераспакованного немного. Цены здесь не обновляются — это
  // делает GET на каждом заходе.
  //
  // Крупный патч после последнего запуска — только у двух, чья причина
  // пишется (герой и запасная своя): один запрос, и то лишь если среди них
  // есть заброшенная с датой. Факт уезжает в запись на сутки, как и сам
  // выбор, но отдельным полем reasonPatched: запись общая для всех сессий
  // профиля, а видеть его вправе только writer (см. DailySelection). Сбой
  // базы на этом чтении отбор не роняет: comebackPatches отдаёт пустую карту,
  // и день выбирается с прежней причиной
  const patches = await comebackPatches(db, set, alternate ? [pick, alternate] : [pick])
  const ctx = pickContext(set, set.metaOf, patches)
  const hideUrgency = ctx.hideUrgency

  /** Герой — в запись: публичные поля, часы, причина без цены и отметки чипсов */
  const describe = (c: ScoredCandidate): DailyAlternate => {
    const reasonOf = (patchOf?: (appid: number) => string | null) => {
      const reason =
        heuristicPicks([c], metaOf, 1, now, profile, {
          tagWeight,
          anchorOf: ctx.anchorOf,
          hoursOf: ctx.hoursOf,
          hideUrgency,
          playtimeHidden: set.playtimeHidden,
          patchOf,
        })[0]?.reason ?? ''
      // В запись уходит причина БЕЗ ценового хвоста: heuristicPicks клеит его
      // последним (reasonPrice), и на каждом заходе он пересчитывается по
      // свежей цене. Хвост тут считается по тем же метаданным, что и сама
      // причина, — поэтому срез всегда попадает ровно по шву.
      const tail = reasonPrice(c.source, metaOf(c.appid), now, hideUrgency)
      return tail && reason.endsWith(tail) ? reason.slice(0, -tail.length) : reason
    }
    const reasonBase = reasonOf()
    // Вторая причина — только когда факт есть и фразу поменял: иначе поля нет
    const reasonPatched = ctx.patchOf(c.appid) ? reasonOf(ctx.patchOf) : reasonBase
    const meta = metaOf(c.appid)
    return {
      pick: publicPick(c),
      hoursPlayed: ctx.hoursOf(c.appid),
      reasonBase,
      ...(reasonPatched !== reasonBase ? { reasonPatched } : {}),
      sharedTags: meta ? sharedTasteTags(profile, meta, tagWeight) : [],
      via: ctx.anchorOf(c.appid),
    }
  }

  return {
    ...describe(pick),
    shelf: shelf.map(publicPick),
    hideUrgency,
    alt: alternate ? describe(alternate) : null,
  }
}
