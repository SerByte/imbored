import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { forgetDailyPick, logFeedback, recordOutcome } from '@/lib/db'
import { parseFeedbackCtx } from '@/lib/feedbackctx'
import { logSwallowed } from '@/lib/errlog'
import { isFeedbackAction, isSkipReason } from '@/lib/feedbackkinds'
import { parseMood } from '@/lib/mood'
import { portraitTag } from '@/lib/portraitmodel'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { getDb, isDemoId, nowSec, requireWriter } from '@/lib/server'

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
    ctx?: unknown
  }
  const appid = Number(body.appid)
  const action = body.action
  // Белые списки действий и причин — lib/feedbackkinds.ts: там же строится
  // CHECK таблицы, и новое действие не разъедется с тем, что пускает роут
  if (!Number.isInteger(appid) || !isFeedbackAction(action)) {
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

  // невалидные mood/reason/ctx не роняют фидбек — просто не сохраняются.
  // Снимок выдачи (lib/feedbackctx) — белым списком: слот, движок, части
  // скора и прочее, что нужно отчёту, и ничего сверх
  const mood = parseMood(body.mood)
  const reason = isSkipReason(body.reason) ? body.reason : null
  const ctx = parseFeedbackCtx(body.ctx)
  await logFeedback(
    db,
    {
      steamid,
      appid,
      action,
      ...(reason ? { reason } : {}),
      ...(mood ? { mood } : {}),
      ...(ctx ? { ctx } : {}),
    },
    now,
  )
  /*
   * Исход совета (lib/outcome.ts): запуск или переход в магазин за не
   * купленной — строка, которую следующие снапшоты дополнят реальными
   * минутами. Демо-личностям нет: их библиотека не меняется, и исход у них
   * всегда «ничего не сыграно». Отказ оценку не срывает: она уже записана, а
   * исход — измерение, и потерять одно лучше, чем ответить пятисоткой.
   */
  const launched = action === 'launched'
  if (!isDemoId(steamid) && (launched || (action === 'opened' && ctx?.intent === 'store'))) {
    await recordOutcome(
      db,
      { steamid, appid, source: ctx?.candidate ?? null, launched, ...(ctx ? { ctx } : {}) },
      now,
    ).catch((err: unknown) => {
      logSwallowed('feedback:outcome', err)
    })
  }
  // Игра дня записана на сутки, но бан и «надоела» отбор обязан учесть сразу:
  // иначе убранная игра стояла бы героем до полуночи (см. forgetDailyPick)
  if (action === 'banned' || reason === 'tired') await forgetDailyPick(db, steamid)
  // Модель портрета кэшируется по снапшоту, а бан снапшот не меняет: без
  // сброса «начни с этой» на портрете указывала бы на скрытую игру до
  // следующего снапшота. 'max' — следующий заход получит старую модель, пока
  // собирается новая: стартовая — не то, ради чего ждать сборку
  if (action === 'banned') revalidateTag(portraitTag(steamid), 'max')
  return NextResponse.json({ ok: true })
}
