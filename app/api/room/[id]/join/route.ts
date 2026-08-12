import { NextResponse } from 'next/server'
import { getPersonaName, joinRoom } from '@/lib/db'
import { currentSteamId, getDb, nowSec } from '@/lib/server'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  const name = await getPersonaName(db, steamid)

  const ok = await joinRoom(db, id, steamid, name ?? undefined, nowSec())
  if (!ok) return NextResponse.json({ error: 'notfound' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
