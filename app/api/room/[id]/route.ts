import { NextResponse } from 'next/server'
import { getGameMeta, getRoom, myVotedAppids, roomMembers } from '@/lib/db'
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

  const memberViews = await Promise.all(
    members.map(async (m) => ({
      name: m.personaName ?? `Игрок ${m.steamid.slice(-4)}`,
      me: m.steamid === steamid,
      votes: (await myVotedAppids(db, id, m.steamid)).size,
    })),
  )

  return NextResponse.json({
    room: {
      id: room.id,
      status: room.status,
      matchedAppid: room.matchedAppid ?? null,
      isPublic: room.isPublic,
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
