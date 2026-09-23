import { STEAM_IMG_DOMAINS } from './steamhtml'

/**
 * Заголовки безопасности и политика содержимого (CSP).
 *
 * ЗАЧЕМ. Сайт показывает чужой текст: патчноуты издателей, ники Steam, ответы
 * модели. Его экранирует React, и это первый рубеж. Второго не было вовсе:
 * ни CSP, ни запрета на фрейм, ни nosniff, зато отдавался x-powered-by.
 * Любая будущая ошибка с выводом чужого HTML сразу становилась бы исполнимым
 * XSS, а сайт можно было встроить во фрейм и подменить интерфейс поверх
 * кнопки входа.
 *
 * Модуль без Next и без базы: его читает next.config.ts ещё до сборки, а
 * тесты проверяют ровно ту строку, которая уйдёт в заголовок.
 *
 * ПОЧЕМУ БЕЗ NONCE И БЕЗ ХЭША. Nonce требует рендерить каждую страницу на
 * запрос, а /game и главная живут на ISR. Хэш скрипта темы из app/layout.tsx
 * тоже не годится, хотя выглядит естественно. App Router сам вставляет в HTML
 * инлайн-скрипты: поток данных RSC (self.__next_f.push(…)) и служебные
 * скрипты стриминга React ($RC, $RT). Их текст свой у каждой страницы, и
 * заранее посчитать его нельзя. На HTML главной замерено девять инлайн-
 * скриптов, наш из них один. А хэш или nonce в script-src по CSP2 выключает
 * 'unsafe-inline'. С хэшем темы отчёт сыпался бы на каждой странице, а в
 * режиме запрета сайт перестал бы гидратироваться.
 *
 * Поэтому script-src — 'self' 'unsafe-inline'. От инлайн-инъекции это не
 * спасает, это честно. Зато закрыты чужие хосты скриптов, <object>, подмена
 * <base> и отправка форм наружу, а фрейм запрещён отдельно, двумя заголовками.
 * Если понадобится строже, путь один: nonce из proxy.ts и отказ от ISR (см.
 * node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 */

/** Куда браузер шлёт отчёты о нарушениях: app/api/csp-report/route.ts. */
export const CSP_REPORT_PATH = '/api/csp-report'

/** Имя группы для report-to; адрес группы задаёт Reporting-Endpoints. */
export const CSP_REPORT_GROUP = 'csp'

/**
 * Режим запрета. Пока false: политика только сообщает о нарушениях и ничего
 * не блокирует.
 *
 * Включать отдельным коммитом, когда неделю отчётов на /, /play, /game/730 и
 * /whatsnew нет ничего, кроме расширений браузера (см. DEPLOY.md, раздел о
 * заголовках безопасности). Перевод в запрет сразу, без недели отчётов, ставит
 * на кон весь сайт: пропущенный хост картинок или скрипт Vercel молча
 * пропадает у всех посетителей, а заметить это нечем.
 */
export const CSP_ENFORCE = false

export type CspMode = {
  /** next dev: React в разработке зовёт eval, аналитика грузит отладочный скрипт */
  dev: boolean
  /** Превью Vercel: тулбар с комментариями ходит на vercel.live */
  preview: boolean
}

export function cspMode(env: Record<string, string | undefined>): CspMode {
  return { dev: env.NODE_ENV === 'development', preview: env.VERCEL_ENV === 'preview' }
}

/**
 * Директивы по порядку.
 *
 * Хосты картинок — это CDN Steam из lib/steamhtml.ts, и каждый дважды: сам
 * домен и его поддомены. Шаблон *.steamstatic.com голый steamstatic.com не
 * покрывает, а разбор патчноутов пропускает оба.
 *
 * Тулбар превью — по списку из документации Vercel («Using a Content Security
 * Policy» в vercel.com/docs/vercel-toolbar/managing-toolbar). На проде его
 * нет, и хосты туда не попадают.
 *
 * upgrade-insecure-requests нет намеренно: в режиме отчёта браузер его
 * игнорирует и пишет об этом в консоль, а HTTPS держит HSTS от Vercel.
 */
export function cspDirectives({ dev, preview }: CspMode): Array<[string, string[]]> {
  const steamImg = STEAM_IMG_DOMAINS.flatMap((d) => [`https://${d}`, `https://*.${d}`])
  const live = preview ? ['https://vercel.live'] : []
  return [
    ['default-src', ["'self'"]],
    [
      'script-src',
      [
        "'self'",
        "'unsafe-inline'",
        // В разработке @vercel/analytics и speed-insights грузят отладочные
        // скрипты с va.vercel-scripts.com, на Vercel — со своего /_vercel/
        ...(dev ? ["'unsafe-eval'", 'https://va.vercel-scripts.com'] : []),
        ...live,
      ],
    ],
    // 'unsafe-inline' обязателен: style={…} у React — это атрибут style
    ['style-src', ["'self'", "'unsafe-inline'", ...live]],
    [
      'img-src',
      ["'self'", 'data:', 'blob:', ...steamImg, ...(preview ? [...live, 'https://vercel.com'] : [])],
    ],
    // next/font раздаёт шрифты со своего адреса, Google Fonts браузер не видит
    ['font-src', ["'self'", ...(preview ? [...live, 'https://assets.vercel.com'] : [])]],
    ['connect-src', ["'self'", ...(preview ? [...live, 'wss://ws-us3.pusher.com'] : [])]],
    ...(preview ? ([['frame-src', ["'self'", ...live]]] as Array<[string, string[]]>) : []),
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    // Вход через Steam — ссылка, а не форма, так что наружу формам ходить незачем
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    // report-uri понимают все браузеры, report-to — новые; кто знает оба,
    // берёт report-to, так что отчёт не задваивается
    ['report-uri', [CSP_REPORT_PATH]],
    ['report-to', [CSP_REPORT_GROUP]],
  ]
}

export function contentSecurityPolicy(mode: CspMode): string {
  return cspDirectives(mode)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}

/**
 * Все заголовки безопасности для next.config.ts.
 *
 * X-Frame-Options дублирует frame-ancestors: CSP пока только в отчёте, а
 * фрейм нужно запрещать уже сейчас. Встраивать сайт некому: превью ссылок в
 * Telegram и Discord собираются из og-тегов, а не фреймом.
 *
 * Permissions-Policy закрывает то, чем сайт не пользуется: звуки квиза — это
 * AudioContext, микрофон ему не нужен.
 */
export function securityHeaders(mode: CspMode): Array<{ key: string; value: string }> {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    {
      key: CSP_ENFORCE ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
      value: contentSecurityPolicy(mode),
    },
    { key: 'Reporting-Endpoints', value: `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"` },
  ]
}

/* ---------- отчёты о нарушениях ---------- */

/** Одно нарушение в том виде, в каком оно уходит в лог. */
export type CspViolation = {
  directive: string
  /** Источник: origin для адреса, слово для inline/eval/data, схема для прочего */
  blocked: string
  /** Раздел сайта, а не адрес: /game/…, а не /game/730 */
  page: string
  /** Файл, из которого шла попытка, без строки запроса */
  source?: string
  line?: number
  disposition?: string
}

/** Больше нарушений из одного тела не разбираем: это уже не отчёт, а мусор. */
const MAX_PER_BODY = 20

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/**
 * Источник без подробностей.
 *
 * Для решения «разрешить ли хост» нужен только origin. Путь и строка запроса
 * чужого адреса ничего не добавляют, а в них может ехать что угодно, вплоть
 * до токенов. Для самого сайта origin свой и так известен.
 */
function blockedOf(raw: string | undefined): string {
  if (!raw) return 'unknown'
  if (/^[a-z-]+$/i.test(raw)) return raw.toLowerCase() // inline, eval, data, blob, wasm-eval
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'wss:' || u.protocol === 'ws:'
      ? u.origin
      : u.protocol.replace(/:$/, '')
  } catch {
    return 'other'
  }
}

/**
 * Страница только до первого сегмента: /game/… вместо /game/730.
 *
 * В полном пути ездят steamid чужих портретов и коды комнат, а для CSP
 * хватает типа страницы. Строка запроса не нужна тем более: в ней ?compat=.
 */
function pageOf(raw: string | undefined): string {
  if (!raw) return 'unknown'
  try {
    const parts = new URL(raw).pathname.split('/').filter(Boolean)
    if (parts.length === 0) return '/'
    return `/${parts[0]}${parts.length > 1 ? '/…' : ''}`
  } catch {
    return 'unknown'
  }
}

function sourceOf(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:'
      ? `${u.origin}${u.pathname}`.slice(0, 200)
      : u.protocol.replace(/:$/, '')
  } catch {
    return undefined
  }
}

function violationOf(fields: {
  directive?: string
  blocked?: string
  document?: string
  source?: string
  line?: unknown
  disposition?: string
}): CspViolation | null {
  // violated-directive в старом формате — вся директива со значениями
  const directive = fields.directive?.split(' ')[0]
  if (!directive || !/^[a-z-]+$/.test(directive)) return null
  const line = typeof fields.line === 'number' && Number.isFinite(fields.line) ? fields.line : undefined
  const source = sourceOf(fields.source)
  return {
    directive,
    blocked: blockedOf(fields.blocked),
    page: pageOf(fields.document),
    ...(source ? { source } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(fields.disposition ? { disposition: fields.disposition } : {}),
  }
}

/**
 * Тело отчёта в оба формата.
 *
 * report-uri шлёт {"csp-report": {…}} с полями через дефис
 * (application/csp-report). Reporting API шлёт массив
 * [{type: "csp-violation", body: {…}}] с полями в camelCase
 * (application/reports+json), и в том же массиве могут приехать отчёты
 * других типов — их пропускаем.
 */
export function parseCspReports(body: unknown): CspViolation[] {
  const out: CspViolation[] = []
  if (Array.isArray(body)) {
    for (const item of body.slice(0, MAX_PER_BODY)) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      if (r.type !== 'csp-violation' || !r.body || typeof r.body !== 'object') continue
      const b = r.body as Record<string, unknown>
      const v = violationOf({
        directive: str(b.effectiveDirective),
        blocked: str(b.blockedURL),
        document: str(b.documentURL) ?? str(r.url),
        source: str(b.sourceFile),
        line: b.lineNumber,
        disposition: str(b.disposition),
      })
      if (v) out.push(v)
    }
    return out
  }
  if (body && typeof body === 'object') {
    const inner = (body as Record<string, unknown>)['csp-report']
    if (inner && typeof inner === 'object') {
      const b = inner as Record<string, unknown>
      const v = violationOf({
        directive: str(b['effective-directive']) ?? str(b['violated-directive']),
        blocked: str(b['blocked-uri']),
        document: str(b['document-uri']),
        source: str(b['source-file']),
        line: b['line-number'],
        disposition: str(b.disposition),
      })
      if (v) out.push(v)
    }
  }
  return out
}

/** Ключ, по которому одинаковые нарушения схлопываются в логе. */
export function violationKey(v: CspViolation): string {
  return `${v.directive} ${v.blocked} ${v.source ?? ''}`
}

/**
 * Сколько раз писать в лог.
 *
 * Одно нарушение на популярной странице — это отчёт от КАЖДОГО посетителя, а
 * расширения браузера добавляют свои сотни. Лог, где тысяча одинаковых строк,
 * не читается и стоит денег, поэтому одинаковое нарушение пишется раз в
 * окно, а всего строк в минуту не больше потолка. Память на инстанс: после
 * холодного старта окно начинается заново, и это приемлемо — одна строка на
 * инстанс в десять минут погоды не делает.
 */
export function createLogThrottle(opts: { windowMs: number; perMinute: number; maxKeys: number }) {
  const seen = new Map<string, number>()
  let minuteStart = 0
  let inMinute = 0
  return (key: string, nowMs: number): boolean => {
    if (nowMs - minuteStart >= 60_000) {
      minuteStart = nowMs
      inMinute = 0
    }
    const last = seen.get(key)
    if (last !== undefined && nowMs - last < opts.windowMs) return false
    if (inMinute >= opts.perMinute) return false
    // Ключи от расширений бесконечны; память инстанса — нет
    if (seen.size >= opts.maxKeys) seen.clear()
    seen.set(key, nowMs)
    inMinute++
    return true
  }
}
