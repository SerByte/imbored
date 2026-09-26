import { createLogThrottle, parseCspReports, violationKey } from '@/lib/csp'
import { recordTelemetryLater } from '@/lib/telemetry'

/**
 * Приёмник отчётов о нарушениях политики содержимого (lib/csp.ts).
 *
 * Пока CSP работает только в режиме отчёта, это единственный способ узнать,
 * что она сломала бы: хост картинок, которого нет в списке, скрипт Vercel,
 * чужое расширение. Каждое нарушение — одна строка JSON с
 * "event":"csp-report" в Runtime Logs; по ней владелец решает, можно ли
 * включать запрет (см. DEPLOY.md).
 *
 * Без сессии: отчёт шлёт браузер сам, без кук и без участия страницы. Лог —
 * главное хранилище, и он прорежен (createLogThrottle), чтобы тысяча
 * посетителей с одним и тем же нарушением давала одну строку, а не тысячу.
 * Те же прореженные строки ложатся почасовым числом по директиве в
 * telemetry_hourly (lib/telemetry.ts) — счётчик идёт за прореживанием, а не
 * мимо него: отчёты шлёт каждый посетитель и каждое расширение, и запись в
 * базу на каждый была бы счётом без потолка.
 *
 * Проверку Origin из proxy.ts отчёт проходит без исключений: браузер шлёт его
 * со страницы сайта на адрес того же сайта. Sec-Fetch-Site у такого запроса
 * same-origin, а где этого заголовка нет, Origin свой.
 */

/** Отчёт — пара килобайт. Больше — не отчёт, читать не будем. */
const MAX_BODY = 64 * 1024

/** Одинаковое нарушение — раз в десять минут на инстанс, всего до 30 строк в минуту. */
const shouldLog = createLogThrottle({ windowMs: 10 * 60_000, perMinute: 30, maxKeys: 500 })

export async function POST(req: Request) {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) {
    return new Response(null, { status: 413 })
  }
  let body: unknown
  try {
    const text = await req.text()
    if (text.length > MAX_BODY) return new Response(null, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return new Response(null, { status: 400 })
  }

  const now = Date.now()
  const logged = new Map<string, number>()
  for (const v of parseCspReports(body)) {
    if (!shouldLog(violationKey(v), now)) continue
    console.warn(JSON.stringify({ event: 'csp-report', ...v }))
    logged.set(v.directive, (logged.get(v.directive) ?? 0) + 1)
  }
  for (const [directive, n] of logged) recordTelemetryLater('csp', directive, n)
  // 204 и на пустой разбор: браузеру ответ не нужен, а повторять он не станет
  return new Response(null, { status: 204 })
}
