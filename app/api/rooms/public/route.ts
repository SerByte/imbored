import { NextResponse } from 'next/server'
import { listPublicRooms } from '@/lib/db'
import { getDb, nowSec } from '@/lib/server'

export async function GET() {
  const now = nowSec()
  const rooms = (await listPublicRooms(await getDb(), now)).map((r) => ({
    id: r.id,
    memberNames: r.memberNames,
    minutesAgo: Math.max(0, Math.round((now - r.createdAt) / 60)),
  }))
  return NextResponse.json({ rooms })
}
