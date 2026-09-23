import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { NextRequest } from 'next/server'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { config, proxy } from '../proxy'
import { browserHost, isSafeMethod, sameOrigin } from './origin'

/**
 * Сторож межсайтовых запросов.
 *
 * Обычная форма на чужом сайте отправляла POST на /api/connect и
 * /api/auth/logout: первый ставил посетителю куку чужого профиля, второй
 * просто выкидывал его из аккаунта. Проверка стоит одна на всё /api — в
 * proxy.ts, — и здесь проверяется и сама проверка, и то, что обойти её
 * некуда.
 */

const ROOT = path.join(__dirname, '..')
const BASE = 'https://imbored.cc'
const ENV = { ...process.env }

beforeEach(() => {
  process.env = { ...ENV, APP_BASE_URL: BASE }
})

afterEach(() => {
  process.env = { ...ENV }
})

const h = (init: Record<string, string>) => new Headers(init)

describe('sameOrigin', () => {
  const allowed = [BASE]

  test('Sec-Fetch-Site решает первым: свой fetch и ручной переход — да', () => {
    expect(sameOrigin(h({ 'sec-fetch-site': 'same-origin' }), allowed)).toBe(true)
    expect(sameOrigin(h({ 'sec-fetch-site': 'none' }), allowed)).toBe(true)
  })

  test('межсайтовый и «соседний» запрос — нет, даже с правильным на вид Origin', () => {
    // Sec-Fetch-Site ставит браузер, скрипт его не подделает; Origin рядом
    // ничего не решает, раз браузер уже сказал правду.
    expect(sameOrigin(h({ 'sec-fetch-site': 'cross-site', origin: BASE }), allowed)).toBe(false)
    expect(sameOrigin(h({ 'sec-fetch-site': 'same-site' }), allowed)).toBe(false)
    expect(sameOrigin(h({ 'sec-fetch-site': 'same-site-ish' }), allowed)).toBe(false)
  })

  test('без Sec-Fetch-Site (старый браузер) решает Origin', () => {
    expect(sameOrigin(h({ origin: BASE }), allowed)).toBe(true)
    expect(sameOrigin(h({ origin: 'https://evil.example' }), allowed)).toBe(false)
    // Поддомен и другая схема — это другой origin
    expect(sameOrigin(h({ origin: 'https://www.imbored.cc' }), allowed)).toBe(false)
    expect(sameOrigin(h({ origin: 'http://imbored.cc' }), allowed)).toBe(false)
    // Так браузер пишет Origin из песочницы и после межсайтового редиректа
    expect(sameOrigin(h({ origin: 'null' }), allowed)).toBe(false)
  })

  test('без обоих заголовков — отказ', () => {
    expect(sameOrigin(h({}), allowed)).toBe(false)
    expect(sameOrigin(h({ referer: `${BASE}/` }), allowed)).toBe(false)
  })

  test('безопасны только GET и HEAD', () => {
    expect(isSafeMethod('GET')).toBe(true)
    expect(isSafeMethod('HEAD')).toBe(true)
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) expect(isSafeMethod(m)).toBe(false)
  })
})

describe('browserHost: где браузер держит куки', () => {
  test('имя хоста из Host, без порта и в нижнем регистре', () => {
    expect(browserHost(h({ host: 'imbored.cc' }))).toBe('imbored.cc')
    expect(browserHost(h({ host: '127.0.0.1:3000' }))).toBe('127.0.0.1')
    expect(browserHost(h({ host: 'Imbored-Git-X.vercel.app' }))).toBe('imbored-git-x.vercel.app')
    expect(browserHost(h({ host: '[::1]:3000' }))).toBe('[::1]')
  })

  test('за прокси решает x-forwarded-host, и из списка — первый', () => {
    expect(browserHost(h({ host: 'localhost:3000', 'x-forwarded-host': 'imbored.cc' }))).toBe('imbored.cc')
    expect(browserHost(h({ 'x-forwarded-host': 'imbored.cc, internal.lan' }))).toBe('imbored.cc')
  })

  test('без заголовков и с мусором — не знаем', () => {
    expect(browserHost(h({}))).toBeNull()
    expect(browserHost(h({ host: 'bad host' }))).toBeNull()
  })
})

describe('proxy.ts', () => {
  const call = (method: string, url: string, headers: Record<string, string> = {}) =>
    proxy(new NextRequest(url, { method, headers }))
  const passed = (res: Response) => res.headers.get('x-middleware-next') === '1'

  test('межсайтовая форма на выход и на подключение получает 403 origin', async () => {
    for (const p of ['/api/auth/logout', '/api/connect']) {
      const res = call('POST', `${BASE}${p}`, {
        'sec-fetch-site': 'cross-site',
        origin: 'https://evil.example',
        'content-type': 'text/plain',
      })
      expect(res.status, p).toBe(403)
      expect(await res.json()).toEqual({ error: 'origin' })
    }
  })

  test('свой fetch проходит', () => {
    expect(passed(call('POST', `${BASE}/api/connect`, { 'sec-fetch-site': 'same-origin' }))).toBe(true)
    expect(passed(call('POST', `${BASE}/api/connect`, { origin: BASE }))).toBe(true)
  })

  test('на превью свой Origin — адрес деплоя, и он тоже свой', () => {
    const preview = 'https://imbored-git-branch.vercel.app'
    expect(passed(call('POST', `${preview}/api/connect`, { origin: preview }))).toBe(true)
    expect(call('POST', `${preview}/api/connect`, { origin: 'https://evil.example' }).status).toBe(403)
  })

  test('GET не трогается: кроны и чтения идут мимо проверки', () => {
    expect(passed(call('GET', `${BASE}/api/cron/news`, { 'x-cron-secret': 's' }))).toBe(true)
    expect(passed(call('GET', `${BASE}/api/news`, { 'sec-fetch-site': 'cross-site' }))).toBe(true)
  })

  test('прокси стоит на всём /api и не трогает страницы', () => {
    expect(config.matcher).toBe('/api/:path*')
    for (const url of ['/api/connect', '/api/auth/logout', '/api/room/ABC123/vote']) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(true)
    }
    for (const url of ['/', '/play', '/room/ABC123']) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(false)
    }
  })

  /**
   * Проверка стоит только на /api. Изменяющая ручка где-то ещё обошла бы её
   * молча — а route.ts можно положить в любую папку app/.
   */
  test('изменяющие ручки живут только в app/api', () => {
    const mutating = /export\s+(async\s+)?(function|const)\s+(POST|PUT|PATCH|DELETE)\b/
    const inside: string[] = []
    const outside: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/^route\.(ts|tsx|js)$/.test(e.name) && mutating.test(fs.readFileSync(p, 'utf8'))) {
          const rel = path.relative(ROOT, p).split(path.sep).join('/')
          ;(rel.startsWith('app/api/') ? inside : outside).push(rel)
        }
      }
    }
    walk(path.join(ROOT, 'app'))
    // connect, logout, feedback, комнаты… — если не нашлось ни одной, сторож ослеп
    expect(inside.length, 'POST-ручки в app/api не найдены — сторож ослеп').toBeGreaterThan(5)
    expect(outside, 'перенеси ручку в app/api или расширь matcher в proxy.ts').toEqual([])
  })

  test('старого middleware.ts рядом нет — прокси один', () => {
    for (const f of ['middleware.ts', 'middleware.js', 'src/middleware.ts']) {
      expect(fs.existsSync(path.join(ROOT, f)), f).toBe(false)
    }
  })
})
