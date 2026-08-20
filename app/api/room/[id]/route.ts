import { NextResponse } from 'next/server'
import { memberLabel } from '@/lib/room'
import { hashString } from '@/lib/daily'
import { getGameMeta, getRoom, roomMembers, roomVoteCounts } from '@/lib/db'
import { currentSteamId, getDb, nowSec } from '@/lib/server'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const db = await getDb()

  /*
   * Четыре независимых чтения — одним заходом.
   *
   * Это самый частый запрос продукта: он крутится у КАЖДОГО открытого таба
   * раз в 2.5 секунды, то есть на комнате из пятерых это две пары глаз в
   * секунду. Ровно поэтому голоса тут уже сведены в один агрегат вместо
   * запроса на участника — но сами четыре чтения всё равно шли по очереди.
   *
   * Ни одно из них не зависит от результата другого: комнате, составу и
   * агрегату нужен только id, сессии — только кука. Каждый поход в Turso из
   * функции стоит десятки-сотни миллисекунд (замер: маршрут отвечал за 0,6 с
   * при том, что ни один запрос не тяжёлый), и складывались именно они.
   *
   * Цена промаха — три лишних чтения у несуществующей комнаты. В опросе
   * такого не бывает по определению: клиент уже стоит на её странице.
   */
  const [room, steamid, members, counts] = await Promise.all([
    getRoom(db, id),
    currentSteamId(),
    roomMembers(db, id),
    roomVoteCounts(db, id),
  ])
  if (!room) return NextResponse.json({ error: 'notfound' }, { status: 404 })

  const isMember = steamid ? members.some((m) => m.steamid === steamid) : false

  // Зависит от room.matchedAppid, поэтому остаётся после — и случается редко.
  const matchedMeta =
    room.status === 'matched' && room.matchedAppid !== undefined
      ? await getGameMeta(db, room.matchedAppid)
      : null

  const memberViews = members.map((m) => {
    const votes = counts.get(m.steamid) ?? 0
    return {
      // Стабильный ключ для React: имена не уникальны — двое зашедших
      // «Демо-другом» получают одинаковое, и строки ростера с анимацией
      // перемешиваются вместе с чужим прогрессом. Хеш, а не сырой steamid:
      // в открытую комнату с доски подсаживаются незнакомые
      id: hashString(id + m.steamid).toString(36),
      name: memberLabel(id, m.steamid, m.personaName),
      me: m.steamid === steamid,
      votes,
      // deckSize === 0 — вырожденный случай (колода схлопнулась), и отмечать
      // им всех «готов» бессмысленно: никто ничего не свайпал
      done: room.deckSize !== null && room.deckSize > 0 && votes >= room.deckSize,
    }
  })

  return NextResponse.json({
    room: {
      id: room.id,
      status: room.status,
      matchedAppid: room.matchedAppid ?? null,
      isPublic: room.isPublic,
      deckRound: room.deckRound,
      deckSize: room.deckSize,
    },
    isHost: steamid === room.createdBy,
    members: memberViews,
    hasSession: Boolean(steamid),
    isMember,
    matchedGame: matchedMeta
      ? {
          appid: matchedMeta.appid,
          name: matchedMeta.name,
          headerImage: matchedMeta.headerImage ?? null,
          art: matchedMeta.art ?? null,
          store: matchedMeta.store ?? null,
          storeUrl: matchedMeta.storeUrl ?? null,
        }
      : null,
    now: nowSec(),
  })
}
