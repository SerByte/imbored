import { NextResponse } from 'next/server'
import { logFeedback, type FeedbackAction, type SkipReason } from '@/lib/db'
import { parseMood } from '@/lib/mood'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { currentSteamId, getDb, nowSec } from '@/lib/server'

/**
 * Таблица фидбека — append-only и растёт навсегда, а listFeedback читает её на
 * каждой подборке. Потолок с большим запасом над самым быстрым живым темпом
 * (свайпы в пати): он существует, чтобы одна зациклившаяся вкладка не набила
 * туда десятки тысяч строк.
 */
const FEEDBACK_LIMIT = 120
const FEEDBACK_WINDOW_SEC = 60

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

  const db = await getDb()
  const gate = await checkRate(db, {
    bucket: 'feedback',
    id: steamid,
    limit: FEEDBACK_LIMIT,
    windowSec: FEEDBACK_WINDOW_SEC,
    nowSec: nowSec(),
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  // невалидные mood/reason не роняют фидбек — просто не сохраняются
  const mood = parseMood(body.mood)
  const reason = ['genre', 'hard', 'tired', 'notnow'].includes(body.reason ?? '')
    ? (body.reason as SkipReason)
    : null
  await logFeedback(
    db,
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
