import { NextResponse } from 'next/server'
import { advanceRoomDeckRound, getRoom, roomMembers } from '@/lib/db'
import { currentSession, getDb, isWriter } from '@/lib/server'
import { peekGate } from '@/lib/roompeek'
import { seatOf, seatRefusal } from '@/lib/roomseat'

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
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const session = await currentSession()
  if (!session) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  const [room, members] = await Promise.all([getRoom(db, id), roomMembers(db, id)])
  // Раунд поднимает участник — от своего имени (lib/roomseat)
  const seat = seatOf(members, session.steamid, isWriter(session))
  // Не-участник платит потолком просмотра (lib/roompeek): иначе этот роут —
  // открытая проверка, существует ли комната с таким кодом
  if (seat !== 'member') {
    const refused = await peekGate(db, req)
    if (refused) return refused
  }
  if (!room) return NextResponse.json({ error: 'notfound' }, { status: 404 })

  const refusal = seatRefusal(seat)
  if (refusal) return refusal

  if (room.deckRound >= MAX_ROUND) {
    return NextResponse.json({ deckRound: room.deckRound, maxed: true })
  }

  const deckRound = await advanceRoomDeckRound(db, id, room.deckRound + 1)
  return NextResponse.json({ deckRound, maxed: deckRound >= MAX_ROUND })
}
