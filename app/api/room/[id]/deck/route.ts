import { NextResponse } from 'next/server'
import { memberLabel } from '@/lib/room'
import { filterActual } from '@/lib/actual'
import { refreshDealsWithin } from '@/lib/deals'
import {
  bannedAppidsOf,
  getPoolSize,
  getGamesMetaLite,
  getLatestSnapshot,
  getRoom,
  issueRoomDeck,
  loadTagStats,
  myVotedAppids,
  roomMembers,
} from '@/lib/db'
import { discountView, trustedPrice } from '@/lib/discount'
import { sessionTrait } from '@/lib/gametraits'
import { buildGroupDeck } from '@/lib/group'
import { parseMood } from '@/lib/mood'
import { fetchDiscoveryPool, pickQueryTags, rotationSlot } from '@/lib/pool'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { buildTagProfile } from '@/lib/recommend'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { tagWeightFrom } from '@/lib/tagweight'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/
const DECK_SIZE = 20

/**
 * Потолок на сборку колоды — самой дорогой операции приложения.
 *
 * Один вызов это: loadTagStats по всей таблице тегов, fetchDiscoveryPool на
 * дюжину тегов, снапшот библиотеки каждого участника, getGamesMeta по
 * объединению этих библиотек и запись setRoomDeckSize. Для сравнения,
 * /api/daily с сопоставимой ценой ограничен десятью вызовами в час — а
 * здесь не было ничего.
 *
 * Тридцать на пять минут, и считаем по участнику, а не по комнате. Разница
 * существенная: при входе очередного человека колоду перезапрашивают ВСЕ
 * уже вошедшие (deckWant склеен из числа участников), то есть на комнате из
 * восьми это под четыре десятка вызовов в окне — но распределённых по
 * восьми разным steamid, по пять на каждого. Ось по комнате при таком же
 * потолке рубила бы нормальный сценарий.
 */
const DECK_LIMIT = 30
const DECK_WINDOW_SEC = 300
const POOL_BASE = 150
const POOL_STEP = 100

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  /*
   * Комната и состав — одним заходом, а не двумя.
   *
   * roomMembers не зависит от результата getRoom: обоим нужен только id.
   * Каждый поход в Turso из функции стоит десятки-сотни миллисекунд, и на
   * этом маршруте их около десяти подряд — при том что сами запросы быстрые
   * (замер по проду: 53–319 мс каждый, а маршрут отвечает за 1,6–2,8 с).
   * Складывается именно из round-trip, а не из тяжести SQL.
   *
   * Цена промаха — один лишний запрос состава у несуществующей комнаты. Id
   * приходит из адреса, по которому участник уже стоит, так что это редкость.
   */
  const [room, members] = await Promise.all([getRoom(db, id), roomMembers(db, id)])
  if (!room) return NextResponse.json({ error: 'notfound' }, { status: 404 })
  if (!members.some((m) => m.steamid === steamid)) {
    return NextResponse.json({ error: 'notmember' }, { status: 403 })
  }

  // После проверки членства: до неё маршрут и так закрыт сессией и
  // существованием комнаты, а тратить строки ограничителя на чужие попытки
  // незачем — их отсекает 403 выше.
  const gate = await checkRate(db, {
    bucket: 'room-deck',
    id: steamid,
    limit: DECK_LIMIT,
    windowSec: DECK_WINDOW_SEC,
    nowSec: nowSec(),
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  // Баны — тем же заходом, что и библиотеки: обоим нужен только состав.
  // Объединение по всем участникам, а не баны смотрящего: колода одна на
  // комнату (см. bannedAppidsOf), и своя у каждого развалила бы счёт голосов.
  const [libraries, banned] = await Promise.all([
    Promise.all(
      members.map(async (m) => ({
        steamid: m.steamid,
        name: memberLabel(id, m.steamid, m.personaName),
        library: (await getLatestSnapshot(db, m.steamid))?.games ?? [],
      })),
    ),
    bannedAppidsOf(db, members.map((m) => m.steamid)),
  ])

  // Метаданные библиотек участников, а не всего каталога
  const ownedIds = [...new Set(libraries.flatMap((l) => l.library.map((g) => g.appid)))]
  const metas = await getGamesMetaLite(db, ownedIds)
  const metaOf = (appid: number) => metas.get(appid)

  // Общий вкус пати — по нему добираем то, чего нет ни у кого.
  // requireMultiplayer снимает с JS-фильтра на порядок больший пул.
  const partyProfile: Record<string, number> = {}
  for (const l of libraries) {
    for (const [tag, weight] of Object.entries(buildTagProfile(l.library, metaOf))) {
      partyProfile[tag] = (partyProfile[tag] ?? 0) + weight
    }
  }
  const now = nowSec()
  const [tagStats, poolSize] = await Promise.all([loadTagStats(db), getPoolSize(db)])
  // Свои голоса не зависят от пула — тянем их тем же заходом, а не после.
  const [extraPool, voted] = await Promise.all([
    fetchDiscoveryPool(db, {
      tags: pickQueryTags(partyProfile, tagStats, poolSize),
      // Не только отсев: без этого забаненное занимало бы места в LIMIT пула
      bannedAppids: [...banned],
      requireMultiplayer: true,
      // Ротацию НЕ сдвигаем по раунду: она меняет пул, а значит и порядок, и
      // «следующие двадцать» начали бы дублировать уже показанное. По той же
      // причине слот считается от рождения комнаты, а не от часов: неделя
      // rotationSlot сменяется в четверг в 00:00 UTC, и пати, начатая в среду
      // вечером, после полуночи получала бы другой пул посреди свайпа
      rotation: rotationSlot(id, room.createdAt),
      limit: POOL_BASE + POOL_STEP * room.deckRound,
    }),
    myVotedAppids(db, id, steamid),
  ])
  for (const m of extraPool) if (!metas.has(m.appid)) metas.set(m.appid, m)

  // Раунд расширяет ту же колоду, а не выдаёт новую: buildGroupDeck при большем
  // limit продолжает прежний порядок (см. тест «колода на больший limit
  // продолжает меньшую»), поэтому уже отсмотренное не перетасовывается
  const deck = buildGroupDeck({
    members: libraries,
    metaOf,
    extraPool,
    limit: DECK_SIZE * (room.deckRound + 1),
    // Общие игры участников идут не из пула, а из библиотек — их баны
    // отсеиваются уже здесь
    banned,
    // Та же мера вкуса, что у /play: карта тегов уже прочитана ради пула
    tagWeight: tagWeightFrom(tagStats),
    // Настроение, которое хост выбрал при создании (ROOM_PRESETS). Лежало в
    // mood_json с первого дня и до колоды не доезжало. Через parseMood: строка
    // из базы разбирается тем же сторожем, что и тело запроса создания, — у
    // старой или битой строки настроения просто нет, и колода прежняя
    mood: parseMood(room.mood),
  })

  // Колода собирается из библиотек участников, а они офлайн-фильтры каталога
  // не проходят: без этого в пати всплывали мёртвые сетевые игры и старые
  // версии вроде Condition Zero при живой CS2
  const actual = filterActual(deck, metas, 'party')

  const shown = actual.filter((c) => !voted.has(c.appid))

  // Знаменатель прогресса — это то, что человек реально увидит, то есть колода
  // ПОСЛЕ filterActual. Раньше здесь стоял deck.length, и карты, выброшенные
  // фильтром актуальности, засчитывались в отсвайпанные: свежий участник с
  // нулём голосов открывал колоду на «5/20».
  //
  // Те же карты записываются в room_deck: голос принимается только за то,
  // что комнате раздали (castDeckVote в /vote).
  await issueRoomDeck(db, id, actual.map((c) => c.appid))

  // Цены тех карт, что реально уедут в колоду: половина из них не куплена
  // никем из пати, и «Нет у: Дима · $60» без скидки — устаревший ценник.
  const refreshed = await refreshDealsWithin(db, shown.map((c) => c.appid), now)
  if (refreshed) {
    for (const [appid, meta] of await getGamesMetaLite(db, shown.map((c) => c.appid))) {
      metas.set(appid, meta)
    }
  }

  const cards = shown.map((c) => {
    const meta = metas.get(c.appid)
    return {
      ...c,
      // У бесплатной цены нет: price_final у неё — чужая редакция (Prime у
      // CS2), и пересчёт отсюда вернул бы в карточку то, что убрал buildGroupDeck
      priceFinal: c.isFree ? undefined : meta ? trustedPrice(meta, now) : c.priceFinal,
      art: meta?.art ?? null,
      ccu: meta?.ccu ?? null,
      ccuAt: meta?.ccuAt ?? null,
      // «Матч ~15 мин»: для вечера вместе длина захода — второй вопрос после
      // «есть ли с кем», и ответ на него тот же, что на карточке игры
      session: meta ? sessionTrait(meta) : null,
      // Скидка нужна только там, где кому-то придётся покупать: у карточки
      // «есть у всех» цена вообще не участвует в разговоре, у бесплатной — тоже
      discount: meta && !c.ownedByAll && !c.isFree ? discountView(meta, now) : null,
    }
  })

  return NextResponse.json({
    // см. докблок в PlayersNow: подпись «сейчас» требует серверных часов
    nowSec: nowSec(),
    cards,
    total: actual.length,
    votedCount: actual.length - shown.length,
    deckRound: room.deckRound,
    // Полная страница намекает, что за ней что-то есть; вырожденный случай
    // «ровно кратно двадцати» стоит одного пустого запроса, и это дешевле,
    // чем отдельный подсчёт пула
    hasMore: deck.length >= DECK_SIZE * (room.deckRound + 1),
  })
}
