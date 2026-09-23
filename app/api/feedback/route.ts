import { NextResponse } from 'next/server'
import { forgetDailyPick, logFeedback, type FeedbackAction, type SkipReason } from '@/lib/db'
import { parseMood } from '@/lib/mood'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { getDb, nowSec, requireWriter } from '@/lib/server'

const ACTIONS: readonly FeedbackAction[] = ['liked', 'skipped', 'opened', 'banned', 'launched']
const REASONS: readonly SkipReason[] = ['genre', 'hard', 'tired', 'notnow', 'spin', 'done']

/*
 * Потолок на запись фидбека.
 *
 * Каждый вызов — строка в Turso, а сессию бесплатно выдаёт демо-вход, так что
 * без лимита ручка превращается в чужой счёт за записи. Сто двадцать за десять
 * минут — это клик каждые пять секунд без остановки: живой человек на /play
 * столько не нажимает даже в рулетке, а скрипт упирается быстро.
 *
 * Клиент шлёт фидбек fire-and-forget и 429 не показывает: потерянная оценка
 * под флудом — не беда, в отличие от сорванной выдачи.
 */
const FEEDBACK_LIMIT = 120
const FEEDBACK_WINDOW_SEC = 600

export async function POST(req: Request) {
  // Любое действие, включая бан: история оценок и есть профиль вкуса, и
  // писать в неё по вставленной ссылке нельзя (см. isWriter в lib/server)
  const writer = await requireWriter()
  if (!writer.ok) return writer.response
  const { steamid } = writer

  const body = (await req.json().catch(() => ({}))) as {
    appid?: number
    action?: string
    reason?: string
    mood?: unknown
  }
  const appid = Number(body.appid)
  const action = body.action as FeedbackAction | undefined
  if (!Number.isInteger(appid) || !action || !ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }

  const db = await getDb()
  const now = nowSec()
  const gate = await checkRate(db, {
    bucket: 'feedback',
    id: steamid,
    limit: FEEDBACK_LIMIT,
    windowSec: FEEDBACK_WINDOW_SEC,
    nowSec: now,
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  // невалидные mood/reason не роняют фидбек — просто не сохраняются
  const mood = parseMood(body.mood)
  const reason = REASONS.includes(body.reason as SkipReason) ? (body.reason as SkipReason) : null
  await logFeedback(
    db,
    {
      steamid,
      appid,
      action,
      ...(reason ? { reason } : {}),
      ...(mood ? { mood } : {}),
    },
    now,
  )
  // Игра дня записана на сутки, но бан и «надоела» отбор обязан учесть сразу:
  // иначе убранная игра стояла бы героем до полуночи (см. forgetDailyPick)
  if (action === 'banned' || reason === 'tired') await forgetDailyPick(db, steamid)
  return NextResponse.json({ ok: true })
}
