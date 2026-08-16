import { NextResponse } from 'next/server'
import { advanceRoomDeckRound, getRoom, roomMembers } from '@/lib/db'
import { currentSteamId, getDb } from '@/lib/server'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

/** Дальше добирать бессмысленно: пул кандидатов не бесконечный */
const MAX_ROUND = 4

/**
 * «Ещё игр» — на всю комнату.
 *
 * Личная докачка была бы фичей, которая тихо не работает: единогласие в
 * findRoomMatch считается по всем участникам, и карта, попавшая в колоду только
 * ко мне, не даст матча, сколько её ни лайкай. Поэтому раунд поднимается на
 * комнате, а остальные подхватывают его из обычного опроса.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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

  if (room.deckRound >= MAX_ROUND) {
    return NextResponse.json({ deckRound: room.deckRound, maxed: true })
  }

  const deckRound = await advanceRoomDeckRound(db, id, room.deckRound + 1)
  return NextResponse.json({ deckRound, maxed: deckRound >= MAX_ROUND })
}
