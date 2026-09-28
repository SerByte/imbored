import { NextResponse } from 'next/server'
import { getRoom, setRoomPublic } from '@/lib/db'
import { getDb, requireWriter } from '@/lib/server'
import { readJsonObject } from '@/lib/reqbody'
import { peekGate } from '@/lib/roompeek'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  // Вывесить комнату на доску — значит показать ник хоста всем на /rooms
  const writer = await requireWriter()
  if (!writer.ok) return writer.response
  const { steamid } = writer

  const db = await getDb()
  const room = await getRoom(db, id)
  // Не хост платит потолком просмотра (lib/roompeek): иначе 404 против 403 —
  // открытая проверка, существует ли комната с таким кодом
  if (room?.createdBy !== steamid) {
    const refused = await peekGate(db, req)
    if (refused) return refused
  }
  if (!room) return NextResponse.json({ error: 'notfound' }, { status: 404 })
  if (room.createdBy !== steamid) return NextResponse.json({ error: 'nothost' }, { status: 403 })

  const body = (await readJsonObject(req)) as { public?: boolean }
  if (typeof body.public !== 'boolean') {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }
  await setRoomPublic(db, id, body.public)
  return NextResponse.json({ ok: true, isPublic: body.public })
}
