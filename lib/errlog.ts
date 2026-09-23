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
 * обратное. referer проходит не как есть, а через safeReferer.
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
  /** Адрес без строки запроса и с масками: /compat/:steamid, /room/:id */
  path?: string
  method?: string
  /** Файл маршрута, а не адрес: /app/game/[appid] вместо /game/730 */
  route?: string
  routeType?: string
  headers?: Record<string, string>
}

/**
 * steamid64 — ровно 17 цифр. Границы — «не цифра», а не \b: в адресе
 * steamid стоит и после «/», и после «=», и после буквы (id7656…).
 *
 * Левая граница — захватом, а не lookbehind: модуль едет и в браузер
 * (instrumentation-client.ts), а регулярка, которую движок не понял, роняет
 * весь модуль ещё на разборе — вместе с отчётом об ошибках.
 */
const STEAMID_RE = /(^|\D)\d{17}(?!\d)/g

/**
 * Сегмент после /room/ — код пати, а код пати — это доступ: по нему входят в
 * комнату. Маскируется любой сегмент, а не только [A-Z0-9]{6}: адрес,
 * набранный руками строчными, ведёт в ту же комнату. Исключения — два
 * настоящих адреса, которые кодом не являются.
 */
const ROOM_RE = /\/room\/(?!(?:new|create)(?:[/?#]|$))[^/?#]+/g

/**
 * Путь, который можно положить в лог: без строки запроса и фрагмента, с
 * чужими steamid и кодами пати под масками.
 *
 * Одна функция на сервер и на браузер (instrumentation-client.ts): страница
 * приватности обещает одно и то же про оба лога.
 */
export function maskPath(raw: string): string {
  return raw.split(/[?#]/)[0].replace(STEAMID_RE, '$1:steamid').replace(ROOM_RE, '/room/:id')
}

/**
 * Адрес целиком внутри текста: схема, хост, путь — до строки запроса.
 * Строка запроса нужна отдельно, потому что срезается она, а не адрес.
 */
const URL_QUERY_RE = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]*)[?#][^\s"'<>]*/gi

/**
 * У относительного адреса («/compat/…?join=…») схемы нет, и правило выше его
 * не видит. Здесь — значения тех параметров, что несут доступ или личность:
 * код пати, чужой steamid, ключи и токены.
 */
const SECRET_PARAM_RE = /\b(join|compat|key|token|authToken|access_token)=[^&\s"'<>#]+/gi

/**
 * Текст ошибки, который можно положить в лог.
 *
 * Сообщения пишет не только наш код, но и fetch, libsql, Next. В них бывает
 * полный адрес запроса — а у Steam Web API в строке запроса лежит наш ключ,
 * у страниц сайта — ?compat= и ?join=. Поэтому у любого адреса в тексте
 * срезается строка запроса, а steamid и коды пати уходят под те же маски,
 * что в пути.
 */
export function scrubText(raw: string): string {
  return raw
    .replace(URL_QUERY_RE, '$1')
    .replace(SECRET_PARAM_RE, '$1=…')
    .replace(STEAMID_RE, '$1:steamid')
    .replace(ROOM_RE, '/room/:id')
}

/** JSON.stringify, который не бросает: цикл в объекте не должен уронить логгер. */
function stringifySafe(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return Object.prototype.toString.call(v)
  }
}

/**
 * Откуда пришли, без того, кто пришёл.
 *
 * В полном referer ездит всё то же, что в path, плюс строка запроса
 * (?compat=…&join=ABC123). Со своего сайта оставляем origin и путь под
 * масками — по нему видно, с какой страницы шли. С чужого — только origin:
 * путь чужого сайта маскам не обучен, а в нём бывает что угодно, вплоть до
 * имени профиля в Steam (/id/<ник>). host неизвестен — считаем сайт чужим.
 */
function safeReferer(raw: string, host: string | undefined): string | undefined {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    return host && u.host === host ? `${u.origin}${maskPath(u.pathname)}` : u.origin
  } catch {
    return undefined
  }
}

/** Заголовок может прийти массивом: берём первое значение, а не «a,b». */
function first(v: unknown): string | undefined {
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' && s ? s : undefined
}

function safeHeaders(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const host = first(src['x-forwarded-host']) ?? first(src.host)
  const out: Record<string, string> = {}
  for (const key of HEADER_ALLOW) {
    let s = first(src[key])
    if (s && key === 'referer') s = safeReferer(s, host)
    if (s) out[key] = s.slice(0, HEADER_MAX)
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
      message: scrubText(err.message || err.name),
      name: err.name,
      ...(typeof digest === 'string' ? { digest } : {}),
      ...(err.stack
        ? { stack: scrubText(err.stack.split('\n').slice(0, STACK_LINES).join('\n')) }
        : {}),
    }
  }
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>
    return {
      message: scrubText(typeof o.message === 'string' ? o.message : stringifySafe(err).slice(0, 300)),
      ...(typeof o.digest === 'string' ? { digest: o.digest } : {}),
    }
  }
  return { message: scrubText(String(err)) }
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
    // Путь без строки запроса и под масками. Чужие steamid и коды пати ездят
    // не только в ?compat= и ?join=, но и в самом пути: /compat/<steamid>,
    // /portrait/<steamid>, /room/<код>. Для воспроизведения падения хватает
    // маршрута и маски; кто именно это был, логу знать незачем.
    ...(request?.path ? { path: maskPath(request.path) } : {}),
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

/*
 * ---- Проглоченные сбои ----
 *
 * onRequestError видит только то, что долетело до Next. А самые важные сбои
 * до него не долетают: их ловят намеренно, чтобы отдать фолбэк. Вход через
 * Steam отдаёт ?error=steam, лимитер при сбое базы открывает ворота, отзыв
 * сессий молча не работает, прогрев отдаёт stalled. Для человека это
 * правильно, для владельца — тишина: отозванный ключ Steam API и кончившаяся
 * квота Turso выглядели в Runtime Logs одинаково — никак.
 *
 * Поэтому каждый такой catch оставляет одну строку. Без стека (место —
 * причине, а не кадрам), без steamid и строки запроса (scrubText), и не чаще
 * раза в минуту на каждое место: при лежащем Steam один и тот же сбой идёт
 * от каждого посетителя, а лог на Hobby не резиновый. Сколько раз за минуту
 * промолчали — пишет поле repeats следующей строки.
 */

export type SwallowedLog = {
  event: 'swallowed'
  /** Место в коде: 'auth/return:steam', 'ratelimit:check'. Набор конечный — это ключ прореживания. */
  where: string
  name?: string
  message: string
  /** HTTP-статус, если сбой — чужой ответ: 403 у Steam значит одно, 429 — другое */
  status?: number
  /** Код ошибки библиотеки: ECONNRESET, SQLITE_BUSY, BLOCKED — по нему отличают сеть от базы */
  code?: string
  /** Причина под обёрткой: у fetch сообщение всегда «fetch failed», а суть — здесь */
  cause?: string
  /** Сколько таких же сбоев здесь промолчали с прошлой строки */
  repeats?: number
} & Record<string, string | number | boolean | undefined>

/** Сообщение — до двухсот символов: причина, а не дамп ответа */
const SWALLOW_MESSAGE_MAX = 200
const SWALLOW_EXTRA_MAX = 80

/** Не чаще раза в минуту на место */
export const SWALLOW_WINDOW_MS = 60_000

const CODE_RE = /^[A-Z][A-Z0-9_]{1,40}$/

function codeOf(v: unknown): string | undefined {
  const code = (v as { code?: unknown } | null)?.code
  return typeof code === 'string' && CODE_RE.test(code) ? code : undefined
}

function statusOf(err: unknown, message: string): number | undefined {
  const s = (err as { status?: unknown } | null)?.status
  if (typeof s === 'number' && Number.isInteger(s) && s >= 100 && s < 600) return s
  // Наши обёртки сети пишут статус в текст: «Steam API …: HTTP 403»
  const m = /\bHTTP (\d{3})\b/.exec(message)
  return m ? Number(m[1]) : undefined
}

export function formatSwallowed(
  where: string,
  err: unknown,
  extra: Record<string, string | number | boolean | undefined> = {},
): SwallowedLog {
  const { message, name } = describe(err)
  const cause = (err as { cause?: unknown } | null)?.cause
  const causeText =
    cause instanceof Error
      ? scrubText(`${cause.name}: ${cause.message}`).slice(0, SWALLOW_EXTRA_MAX * 2)
      : undefined
  const status = statusOf(err, message)
  const code = codeOf(err) ?? codeOf(cause)

  // Доп. поля пишет наш код, но строки всё равно через маски: туда легко
  // положить адрес «для контекста» и забыть, что в нём ?compat=.
  const safeExtra: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) continue
    safeExtra[k] = typeof v === 'string' ? scrubText(v).slice(0, SWALLOW_EXTRA_MAX) : v
  }

  return {
    ...safeExtra,
    event: 'swallowed',
    where,
    ...(name ? { name } : {}),
    message: message.slice(0, SWALLOW_MESSAGE_MAX),
    ...(status !== undefined ? { status } : {}),
    ...(code ? { code } : {}),
    ...(causeText ? { cause: causeText } : {}),
  }
}

/** Когда место писало в последний раз и сколько с тех пор промолчало */
const swallowed = new Map<string, { at: number; quiet: number }>()

/** Только для тестов: прореживание живёт на модуле и иначе течёт между случаями */
export function resetSwallowed(): void {
  swallowed.clear()
}

/**
 * Записать проглоченный сбой. Возвращает, ушла ли строка в лог.
 *
 * console.warn, а не error: запрос при этом обслужен, фолбэком. Одна строка
 * JSON — по "event":"swallowed" и полю where она ищется в Runtime Logs.
 *
 * Сам логгер не бросает никогда: он стоит внутри catch, и исключение отсюда
 * превратило бы аккуратный фолбэк в 500.
 */
export function logSwallowed(
  where: string,
  err: unknown,
  extra?: Record<string, string | number | boolean | undefined>,
  nowMs: number = Date.now(),
): boolean {
  try {
    const seen = swallowed.get(where)
    if (seen && nowMs - seen.at < SWALLOW_WINDOW_MS) {
      seen.quiet++
      return false
    }
    const log = formatSwallowed(where, err, extra)
    if (seen?.quiet) log.repeats = seen.quiet
    swallowed.set(where, { at: nowMs, quiet: 0 })
    console.warn(stringifySafe(log))
    return true
  } catch {
    return false
  }
}
