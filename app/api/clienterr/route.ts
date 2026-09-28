import { CLIENT_ERROR_MAX_BODY, parseClientReport, reportKey } from '@/lib/clienterr'
import { createLogThrottle } from '@/lib/csp'
import { checkRate, clientIp } from '@/lib/ratelimit'
import { getDb, nowSec } from '@/lib/server'
import { recordTelemetryLater } from '@/lib/telemetry'

/**
 * Приёмник отчётов о падениях в браузере (lib/clienterr.ts).
 *
 * Каждое падение — одна строка JSON с "event":"client-error" в Runtime Logs,
 * рядом с серверными "server-error". Внешнего сборщика нет: лог — главное
 * хранилище, как у /api/csp-report. Сверх строки — число за час по виду
 * падения (error, rejection, boundary) в telemetry_hourly (lib/telemetry.ts):
 * без текста, страницы и браузера, только «сколько».
 *
 * Сессия не читается и не пишется в лог: чтобы найти поломку, нужен код с
 * экрана, страница и браузер, а не человек.
 *
 * Два потолка. Лимит по адресу в базе — чтобы один скрипт не залил лог и не
 * жёг записи Turso. Прореживание одинаковых строк в памяти — чтобы поломка
 * у тысячи посетителей давала несколько строк, а не тысячу.
 *
 * Проверку Origin из proxy.ts отчёт проходит: браузер шлёт его со страницы
 * сайта на адрес того же сайта (Sec-Fetch-Site: same-origin).
 */

/** Двадцать отчётов в десять минут с адреса — с запасом на общий NAT */
const CLIENTERR_LIMIT = 20
const CLIENTERR_WINDOW_SEC = 600

/** Одинаковая поломка — раз в пять минут на инстанс, всего до 30 строк в минуту */
const shouldLog = createLogThrottle({ windowMs: 5 * 60_000, perMinute: 30, maxKeys: 500 })

/** user-agent нужен как опознавательный знак браузера, не строка целиком */
const UA_MAX = 160

export async function POST(req: Request) {
  if (Number(req.headers.get('content-length') ?? 0) > CLIENT_ERROR_MAX_BODY) {
    return new Response(null, { status: 413 })
  }
  let body: unknown
  try {
    const text = await req.text()
    if (text.length > CLIENT_ERROR_MAX_BODY) return new Response(null, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return new Response(null, { status: 400 })
  }
  const report = parseClientReport(body)
  // Мусор — 204 без базы и без лога: маяку ответ не нужен, а повторять он не станет
  if (!report) return new Response(null, { status: 204 })

  const gate = await checkRate(await getDb(), {
    bucket: 'clienterr',
    id: clientIp(req.headers),
    limit: CLIENTERR_LIMIT,
    windowSec: CLIENTERR_WINDOW_SEC,
    nowSec: nowSec(),
  })
  if (!gate.ok) return new Response(null, { status: 429 })

  // Счёт — каждому принятому отчёту, а не только попавшему в лог: его
  // потолок — лимит по адресу выше, а прореживание лога отвечает за строки
  recordTelemetryLater('client-error', report.kind)

  if (shouldLog(reportKey(report), Date.now())) {
    const ua = req.headers.get('user-agent')?.slice(0, UA_MAX)
    console.error(JSON.stringify({ event: 'client-error', ...report, ...(ua ? { ua } : {}) }))
  }
  return new Response(null, { status: 204 })
}
