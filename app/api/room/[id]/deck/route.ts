import { NextResponse } from 'next/server'
import { filterActual } from '@/lib/actual'
import { refreshDealsWithin } from '@/lib/deals'
import {
  getPoolSize,
  getGamesMeta,
  getLatestSnapshot,
  getRoom,
  loadTagStats,
  myVotedAppids,
  roomMembers,
  setRoomDeckSize,
} from '@/lib/db'
import { discountView } from '@/lib/discount'
import { buildGroupDeck } from '@/lib/group'
import { fetchDiscoveryPool, pickQueryTags, rotationSlot } from '@/lib/pool'
import { buildTagProfile } from '@/lib/recommend'
import { currentSteamId, getDb, nowSec } from '@/lib/server'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/
const DECK_SIZE = 20
const POOL_BASE = 150
const POOL_STEP = 100

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  const room = await getRoom(db, id)
  if (!room) return NextResponse.json({ error: 'notfound' }, { status: 404 })

  const members = await roomMembers(db, id)
  if (!members.some((m) => m.steamid === steamid)) {
    return NextResponse.json({ error: 'notmember' }, { status: 403 })
  }

  const libraries = await Promise.all(
    members.map(async (m) => ({
      steamid: m.steamid,
      name: m.personaName ?? `Игрок ${m.steamid.slice(-4)}`,
      library: (await getLatestSnapshot(db, m.steamid))?.games ?? [],
    })),
  )

  // Метаданные библиотек участников, а не всего каталога
  const ownedIds = [...new Set(libraries.flatMap((l) => l.library.map((g) => g.appid)))]
  const metas = await getGamesMeta(db, ownedIds)
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
  const extraPool = await fetchDiscoveryPool(db, {
    tags: pickQueryTags(partyProfile, tagStats, poolSize),
    requireMultiplayer: true,
    // Ротацию НЕ сдвигаем по раунду: она меняет пул, а значит и порядок, и
    // «следующие двадцать» начали бы дублировать уже показанное
    rotation: rotationSlot(id, now),
    limit: POOL_BASE + POOL_STEP * room.deckRound,
  })
  for (const m of extraPool) if (!metas.has(m.appid)) metas.set(m.appid, m)

  // Раунд расширяет ту же колоду, а не выдаёт новую: buildGroupDeck при большем
  // limit продолжает прежний порядок (см. тест «колода на больший limit
  // продолжает меньшую»), поэтому уже отсмотренное не перетасовывается
  const deck = buildGroupDeck({
    members: libraries,
    metaOf,
    extraPool,
    limit: DECK_SIZE * (room.deckRound + 1),
  })

  // Колода собирается из библиотек участников, а они офлайн-фильтры каталога
  // не проходят: без этого в пати всплывали мёртвые сетевые игры и старые
  // версии вроде Condition Zero при живой CS2
  const actual = filterActual(deck, metas, 'party')

  const voted = await myVotedAppids(db, id, steamid)
  const shown = actual.filter((c) => !voted.has(c.appid))

  // Знаменатель прогресса — это то, что человек реально увидит, то есть колода
  // ПОСЛЕ filterActual. Раньше здесь стоял deck.length, и карты, выброшенные
  // фильтром актуальности, засчитывались в отсвайпанные: свежий участник с
  // нулём голосов открывал колоду на «5/20».
  await setRoomDeckSize(db, id, actual.length)

  // Цены тех карт, что реально уедут в колоду: половина из них не куплена
  // никем из пати, и «Нет у: Дима · $60» без скидки — устаревший ценник.
  const refreshed = await refreshDealsWithin(db, shown.map((c) => c.appid), now)
  if (refreshed) {
    for (const [appid, meta] of await getGamesMeta(db, shown.map((c) => c.appid))) {
      metas.set(appid, meta)
    }
  }

  const cards = shown.map((c) => {
    const meta = metas.get(c.appid)
    return {
      ...c,
      priceFinal: meta?.priceFinal ?? c.priceFinal,
      art: meta?.art ?? null,
      ccu: meta?.ccu ?? null,
      // Скидка нужна только там, где кому-то придётся покупать: у карточки
      // «есть у всех» цена вообще не участвует в разговоре
      discount: meta && !c.ownedByAll ? discountView(meta, now) : null,
    }
  })

  return NextResponse.json({
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
