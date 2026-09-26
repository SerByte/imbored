import { checkRate, clientIp } from '@/lib/ratelimit'
import { getDb, nowSec } from '@/lib/server'
import { recordTelemetryLater } from '@/lib/telemetry'
import { eventKey, parseTrackEvent, TRACK_MAX_BODY } from '@/lib/track'

/**
 * Приёмник шагов воронки (lib/track.ts).
 *
 * Каждый маяк — плюс один к числу за час «событие:источник» в
 * telemetry_hourly. Ни сессии, ни адреса страницы, ни браузера: воронка
 * видна как отношение чисел, без пути конкретного человека.
 *
 * Потолок по адресу — чтобы один скрипт не накрутил счётчики и не жёг
 * записи Turso: живой человек за десять минут делает единицы шагов.
 */

const EVENT_LIMIT = 60
const EVENT_WINDOW_SEC = 600

export async function POST(req: Request) {
  if (Number(req.headers.get('content-length') ?? 0) > TRACK_MAX_BODY) {
    return new Response(null, { status: 413 })
  }
  let body: unknown
  try {
    const text = await req.text()
    if (text.length > TRACK_MAX_BODY) return new Response(null, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return new Response(null, { status: 400 })
  }
  const step = parseTrackEvent(body)
  // Чужое — 204 без базы: маяку ответ не нужен, а повторять он не станет
  if (!step) return new Response(null, { status: 204 })

  const gate = await checkRate(await getDb(), {
    bucket: 'event',
    id: clientIp(req.headers),
    limit: EVENT_LIMIT,
    windowSec: EVENT_WINDOW_SEC,
    nowSec: nowSec(),
  })
  if (!gate.ok) return new Response(null, { status: 429 })

  recordTelemetryLater('event', eventKey(step.event, step.source))
  return new Response(null, { status: 204 })
}
