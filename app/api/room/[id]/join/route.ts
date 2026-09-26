import { NextResponse } from 'next/server'
import { getPersonaName, joinRoom, roomMembers } from '@/lib/db'
import { peekGate } from '@/lib/roompeek'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { recordTelemetryLater } from '@/lib/telemetry'
import { eventKey } from '@/lib/track'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

/*
 * Потолок — тот же ключ, что у просмотра комнаты не-участником (room-peek,
 * lib/roompeek), и по той же причине: перебор кодов. Вход отвечал 404 или ok
 * без всякого потолка, то есть был вторым, открытым входом в тот же перебор —
 * а попадание здесь сразу сажает в чужую комнату, не только показывает её.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  // До getRoom: промах перебора обязан стоить так же, как попадание
  const refused = await peekGate(db, req)
  if (refused) return refused

  // Был ли уже в комнате — для воронки: повторное «Войти» своего (хозяин,
  // вернувшийся на вкладку) новым входом по приглашению не считается
  const [name, before] = await Promise.all([getPersonaName(db, steamid), roomMembers(db, id)])

  const joined = await joinRoom(db, id, steamid, name ?? undefined, nowSec())
  if (joined === 'joined' && !before.some((m) => m.steamid === steamid)) {
    recordTelemetryLater('event', eventKey('invite_join', 'room'))
  }
  if (joined === 'notfound') return NextResponse.json({ error: 'notfound' }, { status: 404 })
  // Новому человеку в сматченную комнату нельзя — см. JoinResult в lib/db
  if (joined === 'closed') return NextResponse.json({ error: 'matched' }, { status: 409 })
  // Мест нет — см. ROOM_MAX_MEMBERS в lib/room
  if (joined === 'full') return NextResponse.json({ error: 'full' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
