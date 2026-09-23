import { randomInt } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createRoom, getPersonaName, getRoom, joinRoom } from '@/lib/db'
import { parseMood } from '@/lib/mood'
import { checkRate, clientIp, rateLimitedResponse } from '@/lib/ratelimit'
import { getDb, nowSec, requireWriter } from '@/lib/server'

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function genRoomId(): string {
  return Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
}

const ROOM_CREATE_LIMIT = 10
const ROOM_CREATE_WINDOW_SEC = 3600

export async function POST(req: Request) {
  // Комната — от имени профиля: хост видит её на доске под своим ником и
  // управляет ею. Войти в чужую и голосовать можно и по ссылке — это другие
  // роуты, и они сюда не ходят (см. requireWriter в lib/server).
  const writer = await requireWriter()
  if (!writer.ok) return writer.response
  const { steamid } = writer

  const body = (await req.json().catch(() => ({}))) as { mood?: unknown }
  const mood = parseMood(body.mood) ?? undefined

  const db = await getDb()
  const now = nowSec()

  // Строки комнат не подметаются, а доска публичных пати их сканирует —
  // значит каждая созданная впустую комната остаётся стоимостью навсегда.
  // Ключ по IP, а не по steamid: демо-сессии одноразовые.
  const gate = await checkRate(db, {
    bucket: 'room-create',
    id: clientIp(req.headers),
    limit: ROOM_CREATE_LIMIT,
    windowSec: ROOM_CREATE_WINDOW_SEC,
    nowSec: now,
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  let id = genRoomId()
  for (let i = 0; i < 5 && (await getRoom(db, id)); i++) id = genRoomId()

  await createRoom(db, { id, steamid, ...(mood ? { mood } : {}) }, now)

  const name = await getPersonaName(db, steamid)
  await joinRoom(db, id, steamid, name ?? undefined, now)

  return NextResponse.json({ roomId: id })
}
