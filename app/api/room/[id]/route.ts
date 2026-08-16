import { NextResponse } from 'next/server'
import { hashString } from '@/lib/daily'
import { getGameMeta, getRoom, roomMembers, roomVoteCounts } from '@/lib/db'
import { currentSteamId, getDb, nowSec } from '@/lib/server'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const db = await getDb()
  const room = await getRoom(db, id)
  if (!room) return NextResponse.json({ error: 'notfound' }, { status: 404 })

  const steamid = await currentSteamId()
  const members = await roomMembers(db, id)
  const isMember = steamid ? members.some((m) => m.steamid === steamid) : false

  const matchedMeta =
    room.status === 'matched' && room.matchedAppid !== undefined
      ? await getGameMeta(db, room.matchedAppid)
      : null

  // Один агрегат на комнату вместо запроса на участника: это самый частый
  // запрос продукта, и он крутится у каждого раз в 2.5 секунды
  const counts = await roomVoteCounts(db, id)

  const memberViews = members.map((m) => {
    const votes = counts.get(m.steamid) ?? 0
    return {
      // Стабильный ключ для React: имена не уникальны — двое зашедших
      // «Демо-другом» получают одинаковое, и строки ростера с анимацией
      // перемешиваются вместе с чужим прогрессом. Хеш, а не сырой steamid:
      // в открытую комнату с доски подсаживаются незнакомые
      id: hashString(id + m.steamid).toString(36),
      name: m.personaName ?? `Игрок ${m.steamid.slice(-4)}`,
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
