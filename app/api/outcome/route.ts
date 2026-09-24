import { NextResponse } from 'next/server'
import { logFeedback, pendingOutcomeAsk, setOutcomeVerdict } from '@/lib/db'
import { isOutcomeVerdict } from '@/lib/outcome'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { currentSession, getDb, isWriter, nowSec, requireWriter } from '@/lib/server'

/*
 * «Как тебе?» после совета (lib/outcome.ts, components/OutcomeAsk).
 *
 * GET — о чём спросить: самый свежий совет, по которому снапшот уже показал
 * заметную игру, а ответа ещё нет. POST — ответ.
 *
 * Отдельный роут, а не поле в ответе /api/recommend или /api/daily: вопрос
 * задаётся раз в сутки (порог держит устройство), а выдача собирается десятки
 * раз, и лишнее чтение в каждой было бы даром.
 */

/** Ответ личный и меняется от любого снапшота — не кэшировать нигде */
const NO_STORE = { 'Cache-Control': 'private, no-store' }

/*
 * Потолок на ответы. Отвечают раз в сутки, так что тридцать за десять минут —
 * заведомо больше живого человека; ловит он только скрипт, которому ответ
 * «Зацепило» дописывал бы «зашло» в историю.
 */
const OUTCOME_LIMIT = 30
const OUTCOME_WINDOW_SEC = 600

/**
 * Гостю и сессии только для чтения спрашивать не о чем: ответ некуда
 * записать. Лимита частоты нет, как у /api/session/owns: пара строк по
 * первичному ключу дешевле самой проверки лимита, которая пишет в базу, а
 * страница спрашивает не чаще раза в сутки.
 */
export async function GET() {
  const session = await currentSession()
  if (!session || !isWriter(session)) return NextResponse.json({ ask: null }, { headers: NO_STORE })
  const ask = await pendingOutcomeAsk(await getDb(), session.steamid, nowSec())
  return NextResponse.json({ ask }, { headers: NO_STORE })
}

export async function POST(req: Request) {
  // Ответ пишет в историю человека — по вставленной ссылке нельзя
  const writer = await requireWriter()
  if (!writer.ok) return writer.response
  const { steamid } = writer

  const body = (await req.json().catch(() => ({}))) as {
    appid?: unknown
    shownAt?: unknown
    verdict?: unknown
  }
  const appid = Number(body.appid)
  const shownAt = Number(body.shownAt)
  const verdict = body.verdict
  if (!Number.isInteger(appid) || appid === 0 || !Number.isInteger(shownAt) || !isOutcomeVerdict(verdict)) {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }

  const db = await getDb()
  const now = nowSec()
  const gate = await checkRate(db, {
    bucket: 'outcome',
    id: steamid,
    limit: OUTCOME_LIMIT,
    windowSec: OUTCOME_WINDOW_SEC,
    nowSec: now,
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  const answered = await setOutcomeVerdict(db, steamid, appid, shownAt, verdict)
  // «Зацепило» после часов настоящей игры — та же оценка, что «Зацепило» в
  // вопросе после запуска (StopAsk на /play): вкус её слышит. «Так себе» —
  // только ответ для отчёта: сыгранные часы уже сказали своё, а «не тот
  // жанр» человек не говорил
  if (answered && verdict === 'hooked') {
    await logFeedback(db, { steamid, appid, action: 'liked', ctx: { intent: 'ask' } }, now)
  }
  return NextResponse.json({ ok: true })
}
