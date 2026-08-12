import { NextResponse } from 'next/server'
import { logFeedback, type FeedbackAction, type SkipReason } from '@/lib/db'
import { parseMood } from '@/lib/mood'
import { currentSteamId, getDb, nowSec } from '@/lib/server'

export async function POST(req: Request) {
  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    appid?: number
    action?: string
    reason?: string
    mood?: unknown
  }
  const appid = Number(body.appid)
  const action = body.action
  if (
    !Number.isInteger(appid) ||
    !['liked', 'skipped', 'opened', 'banned'].includes(action ?? '')
  ) {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }

  // невалидные mood/reason не роняют фидбек — просто не сохраняются
  const mood = parseMood(body.mood)
  const reason = ['genre', 'hard', 'tired', 'notnow'].includes(body.reason ?? '')
    ? (body.reason as SkipReason)
    : null
  await logFeedback(
    await getDb(),
    {
      steamid,
      appid,
      action: action as FeedbackAction,
      ...(reason ? { reason } : {}),
      ...(mood ? { mood } : {}),
    },
    nowSec(),
  )
  return NextResponse.json({ ok: true })
}
