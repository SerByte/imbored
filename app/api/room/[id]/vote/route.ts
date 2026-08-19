import { NextResponse } from 'next/server'
import { castRoomVote, findRoomMatch, getRoom, roomMembers, setRoomMatched } from '@/lib/db'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { currentSteamId, getDb, nowSec } from '@/lib/server'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  const room = await getRoom(db, id)
  if (!room) return NextResponse.json({ error: 'notfound' }, { status: 404 })
  if (!(await roomMembers(db, id)).some((m) => m.steamid === steamid)) {
    return NextResponse.json({ error: 'notmember' }, { status: 403 })
  }

  // Свайп — самая частая запись в приложении, и голоса накапливаются на
  // комнату навсегда (room_votes без подметания). Сто двадцать в минуту это
  // вдвое быстрее самого быстрого живого свайпа.
  const gate = await checkRate(db, {
    bucket: 'room-vote',
    id: steamid,
    limit: 120,
    windowSec: 60,
    nowSec: nowSec(),
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  const body = (await req.json().catch(() => ({}))) as { appid?: number; vote?: boolean }
  const appid = Number(body.appid)
  if (!Number.isInteger(appid) || typeof body.vote !== 'boolean') {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }

  await castRoomVote(db, id, steamid, appid, body.vote ? 1 : 0, nowSec())

  let matched = room.status === 'matched' ? (room.matchedAppid ?? null) : null
  if (room.status === 'open') {
    matched = await findRoomMatch(db, id)
    if (matched !== null) await setRoomMatched(db, id, matched)
  }

  return NextResponse.json({ matched })
}
