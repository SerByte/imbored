import { NextResponse } from 'next/server'
import { getRoom, setRoomPublic } from '@/lib/db'
import { currentSteamId, getDb } from '@/lib/server'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  const room = await getRoom(db, id)
  if (!room) return NextResponse.json({ error: 'notfound' }, { status: 404 })
  if (room.createdBy !== steamid) return NextResponse.json({ error: 'nothost' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { public?: boolean }
  if (typeof body.public !== 'boolean') {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }
  await setRoomPublic(db, id, body.public)
  return NextResponse.json({ ok: true, isPublic: body.public })
}
