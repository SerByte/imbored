import { NextResponse } from 'next/server'
import { getPersonaName, joinRoom } from '@/lib/db'
import { checkRate, clientIp, rateLimitedResponse } from '@/lib/ratelimit'
import { currentSteamId, getDb, nowSec } from '@/lib/server'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

/*
 * Потолок — тот же ключ, что у просмотра комнаты не-участником (room-peek в
 * app/api/room/[id]/route.ts), и по той же причине: перебор кодов. Вход
 * отвечал 404 или ok без всякого потолка, то есть был вторым, открытым входом
 * в тот же перебор — а попадание здесь сразу сажает в чужую комнату, не
 * только показывает её. Счётчик общий: вход и опрос приглашения делят одни
 * триста запросов за десять минут, и честный гость в них с запасом укладывается.
 */
const PEEK_LIMIT = 300
const PEEK_WINDOW_SEC = 600

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  // До getRoom: промах перебора обязан стоить так же, как попадание
  const gate = await checkRate(db, {
    bucket: 'room-peek',
    id: clientIp(req.headers),
    limit: PEEK_LIMIT,
    windowSec: PEEK_WINDOW_SEC,
    nowSec: nowSec(),
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  const name = await getPersonaName(db, steamid)

  const joined = await joinRoom(db, id, steamid, name ?? undefined, nowSec())
  if (joined === 'notfound') return NextResponse.json({ error: 'notfound' }, { status: 404 })
  // Новому человеку в сматченную комнату нельзя — см. JoinResult в lib/db
  if (joined === 'closed') return NextResponse.json({ error: 'matched' }, { status: 409 })
  // Мест нет — см. ROOM_MAX_MEMBERS в lib/room
  if (joined === 'full') return NextResponse.json({ error: 'full' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
