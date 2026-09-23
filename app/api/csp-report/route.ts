import { createLogThrottle, parseCspReports, violationKey } from '@/lib/csp'

/**
 * Приёмник отчётов о нарушениях политики содержимого (lib/csp.ts).
 *
 * Пока CSP работает только в режиме отчёта, это единственный способ узнать,
 * что она сломала бы: хост картинок, которого нет в списке, скрипт Vercel,
 * чужое расширение. Каждое нарушение — одна строка JSON с
 * "event":"csp-report" в Runtime Logs; по ней владелец решает, можно ли
 * включать запрет (см. DEPLOY.md).
 *
 * Ни базы, ни сессии: отчёт шлёт браузер сам, без кук и без участия
 * страницы. Писать его в таблицу незачем, лог и есть хранилище, и он
 * прорежен (createLogThrottle), чтобы тысяча посетителей с одним и тем же
 * нарушением давала одну строку, а не тысячу.
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
  for (const v of parseCspReports(body)) {
    if (shouldLog(violationKey(v), now)) console.warn(JSON.stringify({ event: 'csp-report', ...v }))
  }
  // 204 и на пустой разбор: браузеру ответ не нужен, а повторять он не станет
  return new Response(null, { status: 204 })
}
