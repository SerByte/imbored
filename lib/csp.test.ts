import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import nextConfig from '../next.config'
import {
  CSP_ENFORCE,
  CSP_REPORT_PATH,
  contentSecurityPolicy,
  createLogThrottle,
  cspDirectives,
  cspMode,
  parseCspReports,
  securityHeaders,
  violationKey,
} from './csp'
import { STEAM_IMG_DOMAINS } from './steamhtml'

const ROOT = path.join(__dirname, '..')
const PROD = { dev: false, preview: false }
const directive = (name: string, mode = PROD) =>
  cspDirectives(mode).find(([n]) => n === name)?.[1] ?? []

/** Покрывает ли источник CSP хост: точное совпадение или шаблон *.домен. */
function allows(sources: string[], url: string): boolean {
  const { protocol, hostname } = new URL(url)
  return sources.some((s) => {
    const m = /^(https?:)\/\/(\*\.)?(.+)$/.exec(s)
    if (!m || m[1] !== protocol) return false
    return m[2] ? hostname.endsWith(`.${m[3]}`) : hostname === m[3]
  })
}

describe('заголовки безопасности', () => {
  test('next.config: x-powered-by выключен, заголовки стоят на всех путях', async () => {
    expect(nextConfig.poweredByHeader).toBe(false)
    const rules = await nextConfig.headers!()
    expect(rules).toHaveLength(1)
    expect(rules[0].source).toBe('/:path*')
    const keys = rules[0].headers.map((h) => h.key)
    for (const k of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) {
      expect(keys, k).toContain(k)
    }
  })

  test('фрейм запрещён уже сейчас, а CSP пока только сообщает', () => {
    const headers = new Map(securityHeaders(PROD).map((h) => [h.key, h.value]))
    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(directive('frame-ancestors')).toEqual(["'none'"])
    // Перевод в запрет — осознанный коммит после недели отчётов (DEPLOY.md),
    // а не побочный эффект правки рядом. Включаешь — поправь этот тест.
    expect(CSP_ENFORCE).toBe(false)
    expect(headers.has('Content-Security-Policy-Report-Only')).toBe(true)
    expect(headers.has('Content-Security-Policy')).toBe(false)
  })

  test('значения не содержат :path — Next подставил бы туда параметр из source', () => {
    for (const mode of [PROD, { dev: true, preview: false }, { dev: false, preview: true }]) {
      for (const h of securityHeaders(mode)) expect(h.value, h.key).not.toMatch(/:path/)
    }
  })
})

describe('CSP', () => {
  test('script-src без хэша и nonce: они выключили бы unsafe-inline, а на нём живёт Next', () => {
    // App Router вставляет инлайн-скрипты потока RSC (self.__next_f.push) и
    // стриминга React, их не посчитать заранее. Хэш скрипта темы разрешил бы
    // только его — и сайт перестал бы гидратироваться при включении запрета.
    const script = directive('script-src')
    expect(script).toContain("'unsafe-inline'")
    expect(script.filter((s) => /^'(sha\d+|nonce)-/.test(s))).toEqual([])
    expect(script).not.toContain("'strict-dynamic'")
  })

  test('на проде нет ни eval, ни хостов тулбара и отладочной аналитики', () => {
    const policy = contentSecurityPolicy(PROD)
    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).not.toContain('vercel.live')
    expect(policy).not.toContain('va.vercel-scripts.com')
    expect(directive('object-src')).toEqual(["'none'"])
    expect(directive('base-uri')).toEqual(["'self'"])
    expect(directive('form-action')).toEqual(["'self'"])
  })

  test('в разработке React нужен eval, на превью тулбару — vercel.live', () => {
    const dev = { dev: true, preview: false }
    expect(directive('script-src', dev)).toContain("'unsafe-eval'")
    expect(directive('script-src', dev)).toContain('https://va.vercel-scripts.com')

    const preview = { dev: false, preview: true }
    for (const d of ['script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'frame-src']) {
      expect(directive(d, preview), d).toContain('https://vercel.live')
    }
    expect(directive('connect-src', preview)).toContain('wss://ws-us3.pusher.com')
  })

  test('режим берётся из окружения', () => {
    expect(cspMode({ NODE_ENV: 'production', VERCEL_ENV: 'production' })).toEqual(PROD)
    expect(cspMode({ NODE_ENV: 'production', VERCEL_ENV: 'preview' })).toEqual({ dev: false, preview: true })
    expect(cspMode({ NODE_ENV: 'development' })).toEqual({ dev: true, preview: false })
  })

  test('картинки Steam проходят: и все домены разбора патчноутов, и прогретые в layout хосты', () => {
    const img = directive('img-src')
    for (const d of STEAM_IMG_DOMAINS) {
      expect(allows(img, `https://${d}/x.jpg`), d).toBe(true)
      expect(allows(img, `https://cdn.akamai.${d}/x.jpg`), `*.${d}`).toBe(true)
    }
    // preconnect в layout — это те хосты, откуда арт идёт на каждой странице
    const layout = fs.readFileSync(path.join(ROOT, 'app', 'layout.tsx'), 'utf8')
    const warmed = [...layout.matchAll(/rel="(?:preconnect|dns-prefetch)" href="([^"]+)"/g)].map((m) => m[1])
    expect(warmed.length, 'preconnect в app/layout.tsx не найдены — сторож ослеп').toBeGreaterThan(0)
    for (const url of warmed) expect(allows(img, url), url).toBe(true)
    // и ничего лишнего: чужой хост и подделка под Steam не проходят
    expect(allows(img, 'https://evil.example/x.png')).toBe(false)
    expect(allows(img, 'https://steamstatic.com.evil.example/x.png')).toBe(false)
  })

  test('отчёты уходят в роут, который их принимает', () => {
    expect(directive('report-uri')).toEqual([CSP_REPORT_PATH])
    const route = path.join(ROOT, 'app', ...CSP_REPORT_PATH.split('/').filter(Boolean), 'route.ts')
    expect(fs.readFileSync(route, 'utf8')).toMatch(/export async function POST/)
    const endpoints = securityHeaders(PROD).find((h) => h.key === 'Reporting-Endpoints')?.value
    expect(endpoints).toBe(`csp="${CSP_REPORT_PATH}"`)
    expect(directive('report-to')).toEqual(['csp'])
  })
})

describe('parseCspReports', () => {
  test('старый формат report-uri', () => {
    const v = parseCspReports({
      'csp-report': {
        'document-uri': 'https://imbored.cc/portrait/76561198000000000?compat=76561198000000001',
        'violated-directive': 'img-src https://*.steamstatic.com',
        'effective-directive': 'img-src',
        'blocked-uri': 'https://tracker.example/pixel.gif?uid=42',
        'source-file': 'https://imbored.cc/_next/static/chunks/a.js?v=1',
        'line-number': 12,
        disposition: 'report',
      },
    })
    expect(v).toEqual([
      {
        directive: 'img-src',
        // только origin: путь и запрос чужого адреса в лог не едут
        blocked: 'https://tracker.example',
        // steamid из пути и ?compat= в лог не едут
        page: '/portrait/…',
        source: 'https://imbored.cc/_next/static/chunks/a.js',
        line: 12,
        disposition: 'report',
      },
    ])
  })

  test('без effective-directive берётся первое слово violated-directive', () => {
    const [v] = parseCspReports({
      'csp-report': { 'document-uri': 'https://imbored.cc/', 'violated-directive': 'script-src-elem', 'blocked-uri': 'inline' },
    })
    expect(v).toEqual({ directive: 'script-src-elem', blocked: 'inline', page: '/' })
  })

  test('Reporting API: массив, чужие типы отчётов пропускаются', () => {
    const v = parseCspReports([
      { type: 'deprecation', body: { id: 'x' } },
      {
        type: 'csp-violation',
        url: 'https://imbored.cc/game/730',
        body: {
          documentURL: 'https://imbored.cc/game/730',
          effectiveDirective: 'script-src-elem',
          blockedURL: 'chrome-extension://abcdef/inject.js',
          sourceFile: 'chrome-extension://abcdef/content.js',
          lineNumber: 3,
          disposition: 'report',
        },
      },
    ])
    expect(v).toEqual([
      {
        directive: 'script-src-elem',
        blocked: 'chrome-extension',
        page: '/game/…',
        source: 'chrome-extension',
        line: 3,
        disposition: 'report',
      },
    ])
  })

  test('мусор не роняет разбор', () => {
    expect(parseCspReports(null)).toEqual([])
    expect(parseCspReports('csp')).toEqual([])
    expect(parseCspReports({ 'csp-report': 'x' })).toEqual([])
    expect(parseCspReports({ 'csp-report': { 'effective-directive': 'img-src; drop' } })).toEqual([])
    expect(parseCspReports([1, null, { type: 'csp-violation' }])).toEqual([])
    // из огромного массива берём не больше двадцати
    const many = Array.from({ length: 100 }, () => ({
      type: 'csp-violation',
      body: { effectiveDirective: 'img-src', blockedURL: 'data', documentURL: 'https://imbored.cc/' },
    }))
    expect(parseCspReports(many)).toHaveLength(20)
  })
})

describe('прореживание лога', () => {
  const v = (blocked: string) => ({ directive: 'img-src', blocked, page: '/' })

  test('одинаковое нарушение — раз в окно', () => {
    const allow = createLogThrottle({ windowMs: 600_000, perMinute: 30, maxKeys: 100 })
    const key = violationKey(v('https://a.example'))
    expect(allow(key, 0)).toBe(true)
    expect(allow(key, 1_000)).toBe(false)
    expect(allow(key, 599_999)).toBe(false)
    expect(allow(key, 600_000)).toBe(true)
    // другое нарушение окно не делит
    expect(allow(violationKey(v('https://b.example')), 600_001)).toBe(true)
  })

  test('всего строк в минуту не больше потолка, следующая минута снова пишет', () => {
    const allow = createLogThrottle({ windowMs: 600_000, perMinute: 3, maxKeys: 100 })
    const got = Array.from({ length: 5 }, (_, i) => allow(`k${i}`, 10))
    expect(got).toEqual([true, true, true, false, false])
    expect(allow('k4', 60_010)).toBe(true)
  })

  test('память ограничена: при переполнении ключи забываются', () => {
    const allow = createLogThrottle({ windowMs: 600_000, perMinute: 1_000, maxKeys: 2 })
    expect(allow('a', 0)).toBe(true)
    expect(allow('b', 0)).toBe(true)
    expect(allow('c', 0)).toBe(true) // чистка перед записью третьего
    expect(allow('a', 1)).toBe(true) // «a» забыт вместе со всеми
  })
})
