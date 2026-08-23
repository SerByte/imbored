/**
 * Что именно уходит в лог, когда на сервере что-то падает.
 *
 * Логика здесь, а не в instrumentation.ts, по той же причине, что и всё
 * остальное в lib: vitest собирает только эту папку, а редактирование
 * заголовков — ровно та вещь, которую нельзя проверять глазами один раз и
 * забыть.
 *
 * ЗАЧЕМ ВООБЩЕ. Обе границы ошибок показывают человеку digest («код: a1b2c3»),
 * и это половина моста: человек может назвать код, но на стороне сервиса его
 * никто не увидит, потому что серверные ошибки не логировались вообще.
 * Стоковый вывод Next в проде показывает стек без маршрута и без кода, и
 * связать жалобу с падением по нему нельзя.
 *
 * КУДА. Одна строка JSON в stderr. Ни Sentry, ни OTel: и то и другое —
 * внешняя услуга с ключом, аккаунтом и счётом, а такое решение не наше.
 * Vercel собирает stdout и stderr в Runtime Logs, где по этой строке уже можно
 * искать; когда появится сборщик получше, менять придётся одну функцию.
 */

/**
 * Заголовки, которые попадают в лог. Список БЕЛЫЙ, и это принципиально.
 *
 * Чёрный список (всё кроме cookie) выглядит удобнее ровно до первого нового
 * заголовка авторизации, который никто не догадался в него внести. Здесь же
 * незнакомое не попадает в лог по умолчанию, а не по недосмотру.
 *
 * Адреса тут НЕТ намеренно. Он не нужен, чтобы воспроизвести падение, зато это
 * персональные данные — а у продукта есть страница приватности, обещающая
 * обратное.
 */
const HEADER_ALLOW = ['user-agent', 'referer'] as const

/** Длинный user-agent режем: в логе нужен опознавательный знак, не строка целиком. */
const HEADER_MAX = 160

/** Стек нужен целиком редко, а места занимает всегда. */
const STACK_LINES = 8

export type ServerErrorLog = {
  event: 'server-error'
  message: string
  /** Тот самый код, который видит человек на экране ошибки. */
  digest?: string
  name?: string
  stack?: string
  path?: string
  method?: string
  /** Файл маршрута, а не адрес: /app/game/[appid] вместо /game/730 */
  route?: string
  routeType?: string
  headers?: Record<string, string>
}

function safeHeaders(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const key of HEADER_ALLOW) {
    const v = src[key]
    // Заголовок может прийти массивом: берём первое значение, а не «a,b».
    const s = Array.isArray(v) ? v[0] : v
    if (typeof s === 'string' && s) out[key] = s.slice(0, HEADER_MAX)
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Разбор пойманного значения.
 *
 * unknown, а не Error, потому что бросить можно что угодно — и бросают:
 * строки, объекты ответа, undefined. Докблок onRequestError отдельно
 * предупреждает, что до нас доезжает не обязательно исходный объект.
 */
function describe(err: unknown): Pick<ServerErrorLog, 'message' | 'digest' | 'name' | 'stack'> {
  if (err instanceof Error) {
    // digest подмешивает сам Next и в типе Error его нет: читаем через
    // расширенный тип один раз, а не приводим на месте использования.
    const digest = (err as Error & { digest?: unknown }).digest
    return {
      message: err.message || err.name,
      name: err.name,
      ...(typeof digest === 'string' ? { digest } : {}),
      ...(err.stack ? { stack: err.stack.split('\n').slice(0, STACK_LINES).join('\n') } : {}),
    }
  }
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>
    return {
      message: typeof o.message === 'string' ? o.message : JSON.stringify(err).slice(0, 300),
      ...(typeof o.digest === 'string' ? { digest: o.digest } : {}),
    }
  }
  return { message: String(err) }
}

export function formatServerError(
  err: unknown,
  request?: { path?: string; method?: string; headers?: unknown },
  context?: { routePath?: string; routeType?: string },
): ServerErrorLog {
  const headers = safeHeaders(request?.headers)
  return {
    event: 'server-error',
    ...describe(err),
    // Путь без строки запроса. В ней ездят чужие steamid (?compat=765611…)
    // и коды пати — ровно те персональные данные, которых по обещанию выше
    // здесь быть не должно; для воспроизведения падения хватает маршрута.
    ...(request?.path ? { path: request.path.split('?')[0] } : {}),
    ...(request?.method ? { method: request.method } : {}),
    ...(context?.routePath ? { route: context.routePath } : {}),
    ...(context?.routeType ? { routeType: context.routeType } : {}),
    ...(headers ? { headers } : {}),
  }
}

/**
 * Строка для stderr.
 *
 * Одна строка на ошибку, потому что многострочный JSON в сборщике логов
 * разъезжается на отдельные записи и перестаёт искаться.
 *
 * Сериализация в try/catch: в объекте может оказаться цикл (например, если в
 * message кто-то положил ответ с ссылкой на запрос), и падение ЛОГГЕРА поверх
 * падения приложения — худший из возможных исходов.
 */
export function serverErrorLine(log: ServerErrorLog): string {
  try {
    return JSON.stringify(log)
  } catch {
    return JSON.stringify({ event: 'server-error', message: String(log.message ?? 'unserializable') })
  }
}
