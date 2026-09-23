import { maskPath, scrubText } from './errlog'

/**
 * Отчёт о падении в браузере.
 *
 * Серверные ошибки видит onRequestError (instrumentation.ts), а основной
 * продукт — клиентский: /play, /room, /quiz — страницы с 'use client', и там
 * же десятки fetch без catch. Исключение в таком компоненте ловила граница
 * app/error.tsx: человек видел «Что-то сломалось» без кода, сервер не видел
 * ничего. Регрессия после деплоя жила, пока кто-нибудь не догадается написать.
 *
 * Теперь браузер шлёт короткий отчёт на /api/clienterr, а тот пишет одну
 * строку JSON в Runtime Logs — тот же путь, что у серверных ошибок, без
 * внешних сборщиков с ключом и счётом.
 *
 * Здесь всё, что проверяется тестом: сборка отчёта, отсев шума, код для
 * экрана, отсечка повторов и разбор тела на сервере. В instrumentation-client.ts
 * и в границах ошибок остаётся только вызов.
 *
 * Маски — те же, что у серверного лога (lib/errlog.ts), и накладываются
 * ДВАЖДЫ: браузер не отправляет лишнего, сервер не верит, что браузер
 * постарался. Отчёт шлёт чей угодно браузер, и тело — чужие руки.
 */

export const CLIENT_ERROR_PATH = '/api/clienterr'

/**
 * error — window.onerror (исключение вне React: обработчик клика, таймер);
 * rejection — необработанный промис; boundary — исключение, пойманное
 * границей ошибок: до window оно уже не доходит, отчёт шлёт сама граница.
 */
export type ClientErrorKind = 'error' | 'rejection' | 'boundary'

export type ClientErrorReport = {
  kind: ClientErrorKind
  message: string
  name?: string
  /** Первые кадры стека, под масками */
  stack?: string
  /** Страница под масками: /room/:id, /compat/:steamid — без строки запроса */
  page: string
  /** Файл скрипта без строки запроса */
  source?: string
  line?: number
  col?: number
  /** Тот же код, что человек видит на экране ошибки */
  code?: string
}

const KINDS: readonly ClientErrorKind[] = ['error', 'rejection', 'boundary']
const MESSAGE_MAX = 300
const NAME_MAX = 60
const STACK_LINES = 6
const STACK_MAX = 1200
const SOURCE_MAX = 200
const PAGE_MAX = 200
const CODE_RE = /^[a-z0-9]{1,16}$/i

/** Больше тело не бывает: отчёт — пара сотен байт, с запасом на стек */
export const CLIENT_ERROR_MAX_BODY = 8 * 1024

function thrownParts(err: unknown): { name?: string; message?: string; stack?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack }
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>
    return {
      ...(typeof o.name === 'string' ? { name: o.name } : {}),
      ...(typeof o.message === 'string' ? { message: o.message } : {}),
    }
  }
  if (err === undefined) return {}
  return { message: String(err) }
}

function cleanStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined
  const s = scrubText(stack.split('\n').slice(0, STACK_LINES).join('\n')).slice(0, STACK_MAX)
  return s || undefined
}

/** Файл скрипта: origin и путь, только http(s). Расширение браузера — не наш код. */
function sourceOf(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    return `${u.origin}${maskPath(u.pathname)}`.slice(0, SOURCE_MAX)
  } catch {
    return undefined
  }
}

function pageOf(href: string): string {
  try {
    return maskPath(new URL(href).pathname).slice(0, PAGE_MAX)
  } catch {
    return 'unknown'
  }
}

const posInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e7 ? v : undefined

/**
 * Короткий код для экрана ошибки, когда digest нет.
 *
 * digest бывает только у серверных ошибок. Клиентская приходила без кода —
 * и жалобу «сломалось на /play» связать с логом было не по чему.
 *
 * Код — хэш самой ошибки (FNV-1a по имени, тексту и верхним кадрам стека), а
 * не случайное число. Так он одинаков на каждом рендере — случайное число в
 * рендере React не прощает, — одинаков у экрана и у отчёта, и одна и та же
 * поломка у разных людей даёт один код: в логе он найдётся, даже если часть
 * одинаковых отчётов прорежена. Тот же приём у самого Next: digest — хэш
 * ошибки. Буква c впереди отличает клиентский код от серверного digest.
 */
export function clientErrorCode(err: unknown): string {
  const { name = '', message = '', stack = '' } = thrownParts(err)
  const text = scrubText(`${name}\n${message}\n${stack.split('\n').slice(0, 4).join('\n')}`)
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `c${(h >>> 0).toString(36).padStart(7, '0')}`
}

export type ClientErrorInput = {
  kind: ClientErrorKind
  /** Брошенное значение: event.error, event.reason, error границы */
  error?: unknown
  /** Текст из события, если error нет (кросс-доменный скрипт, старый браузер) */
  message?: string
  filename?: string
  lineno?: number
  colno?: number
  /** location.href — страница маскируется здесь же */
  href: string
  code?: string
}

/**
 * Отчёт или null — если это шум, который чинить не нам.
 *
 * Шум трёх сортов. «Script error.» без файла — ошибка чужого скрипта, браузер
 * прячет от нас подробности, и читать там нечего. Файл со схемой расширения
 * (chrome-extension:, moz-extension:) — расширение посетителя. ResizeObserver
 * loop — предупреждение браузера, а не поломка. Плюс AbortError: так
 * отменяется fetch, когда человек ушёл со страницы, — это не сбой.
 */
export function buildClientReport(input: ClientErrorInput): ClientErrorReport | null {
  const parts = thrownParts(input.error)
  const rawMessage = parts.message || input.message || parts.name || ''
  if (!rawMessage) return null
  if (/^Script error\.?$/i.test(rawMessage) && !input.filename) return null
  if (/ResizeObserver loop/i.test(rawMessage)) return null
  if (parts.name === 'AbortError') return null
  if (input.filename && !/^https?:/i.test(input.filename)) return null

  const name = parts.name?.slice(0, NAME_MAX)
  const stack = cleanStack(parts.stack)
  const source = sourceOf(input.filename)
  const line = posInt(input.lineno)
  const col = posInt(input.colno)
  const code = input.code && CODE_RE.test(input.code) ? input.code : undefined
  return {
    kind: input.kind,
    message: scrubText(rawMessage).slice(0, MESSAGE_MAX),
    ...(name ? { name } : {}),
    ...(stack ? { stack } : {}),
    page: pageOf(input.href),
    ...(source ? { source } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(col !== undefined ? { col } : {}),
    ...(code ? { code } : {}),
  }
}

/** По этому ключу одинаковые отчёты схлопываются — и в браузере, и в логе */
export function reportKey(r: ClientErrorReport): string {
  return `${r.kind}|${r.name ?? ''}|${r.message}|${r.source ?? ''}|${r.line ?? ''}`
}

/**
 * Разбор тела на сервере. Белый список полей, типы, длины — и маски заново.
 *
 * Браузер маскирует сам, но тело может прислать кто угодно: старая вкладка
 * до этого кода, консоль, скрипт. В лог попадает только то, что прошло здесь.
 */
export function parseClientReport(body: unknown): ClientErrorReport | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const b = body as Record<string, unknown>
  const kind = KINDS.find((k) => k === b.kind)
  const message = typeof b.message === 'string' ? scrubText(b.message).slice(0, MESSAGE_MAX) : ''
  if (!kind || !message) return null
  const name = typeof b.name === 'string' ? b.name.slice(0, NAME_MAX) : undefined
  const stack = typeof b.stack === 'string' ? cleanStack(b.stack) : undefined
  const page =
    typeof b.page === 'string' && b.page.startsWith('/') ? maskPath(b.page).slice(0, PAGE_MAX) : 'unknown'
  const source = typeof b.source === 'string' ? sourceOf(b.source) : undefined
  const line = posInt(b.line)
  const col = posInt(b.col)
  const code = typeof b.code === 'string' && CODE_RE.test(b.code) ? b.code : undefined
  return {
    kind,
    message,
    ...(name ? { name } : {}),
    ...(stack ? { stack } : {}),
    page,
    ...(source ? { source } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(col !== undefined ? { col } : {}),
    ...(code ? { code } : {}),
  }
}

/** Больше отчётов за сессию вкладки не шлём: дальше это уже не новости */
export const CLIENT_REPORTS_PER_SESSION = 8
const SEEN_KEY = 'imbored:clienterr'

/**
 * Пропускать ли отчёт: один и тот же — раз за сессию вкладки, всего — не
 * больше потолка.
 *
 * sessionStorage, а не память модуля: страница, которая падает на каждой
 * загрузке, иначе слала бы отчёт на каждую перезагрузку. Память — запасной
 * путь для приватного режима, где хранилище бросает: там отсечка живёт до
 * перезагрузки, и это терпимо.
 */
export function createReportGate(
  storage: () => Storage | undefined,
  max: number = CLIENT_REPORTS_PER_SESSION,
): (key: string) => boolean {
  const memory: string[] = []
  const read = (): string[] => {
    try {
      const raw = storage()?.getItem(SEEN_KEY)
      const list: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return memory
    }
  }
  return (key: string) => {
    const seen = read()
    if (seen.includes(key) || memory.includes(key)) return false
    if (Math.max(seen.length, memory.length) >= max) return false
    memory.push(key)
    try {
      storage()?.setItem(SEEN_KEY, JSON.stringify([...seen, key]))
    } catch {
      // приватный режим: остаёмся на памяти
    }
    return true
  }
}

const gate = createReportGate(() => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage))

/**
 * Отправить, не мешая странице.
 *
 * sendBeacon — потому что падение часто последнее, что страница успевает:
 * человек закрывает вкладку, а маяк браузер дошлёт и после. Запрос на свой
 * же адрес, так что проверка Origin в proxy.ts его пропускает
 * (Sec-Fetch-Site: same-origin). Где маяка нет — fetch с keepalive.
 */
function send(report: ClientErrorReport): void {
  const body = JSON.stringify(report)
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    if (navigator.sendBeacon(CLIENT_ERROR_PATH, new Blob([body], { type: 'application/json' }))) return
  }
  if (typeof fetch === 'function') {
    void fetch(CLIENT_ERROR_PATH, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
      keepalive: true,
    }).catch(() => {})
  }
}

/**
 * Собрать, отсеять, отправить. Никогда не бросает: отчёт об ошибке, который
 * сам роняет страницу, хуже, чем никакого.
 */
export function reportClientError(input: ClientErrorInput): void {
  try {
    const report = buildClientReport(input)
    if (report && gate(reportKey(report))) send(report)
  } catch {
    // отчёт не ушёл — страница важнее
  }
}
