import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import type { Db } from '@/lib/db'
import { freshDb } from '@/lib/testing/route'
import { POST } from './route'

// Счётчик нарушений пишется в базу (lib/telemetry): без подменённой базы
// тест писал бы в локальную data/imbored.db
vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * /api/csp-report — по его строкам владелец решает, можно ли включать запрет
 * CSP. Потерянный отчёт значит включить вслепую, а лог без прореживания —
 * тысячу одинаковых строк на одну пропущенную картинку.
 *
 * Прореживание живёт на модуле роута и общее на весь файл, поэтому у каждого
 * теста свои хосты.
 */

let warn: MockInstance<typeof console.warn>
let db: Db

beforeEach(async () => {
  db = await freshDb()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
})

const report = (blocked: string, page = 'https://imbored.cc/game/730') =>
  JSON.stringify({
    'csp-report': { 'document-uri': page, 'effective-directive': 'img-src', 'blocked-uri': blocked },
  })

const send = (body: string, headers: Record<string, string> = {}) =>
  POST(
    new Request('http://localhost/api/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report', ...headers },
      body,
    }),
  )

const logged = () => warn.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)

describe('/api/csp-report', () => {
  test('нарушение — одна строка csp-report в логе, ответ 204', async () => {
    const res = await send(report('https://one.example/a.png?t=secret'))
    expect(res.status).toBe(204)
    expect(logged()).toEqual([
      { event: 'csp-report', directive: 'img-src', blocked: 'https://one.example', page: '/game/…' },
    ])
  })

  test('то же нарушение от следующих посетителей лог не засоряет', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await send(report('https://two.example/x.png', `https://imbored.cc/game/${i}`))).status).toBe(204)
    }
    expect(logged()).toHaveLength(1)
  })

  test('формат Reporting API тоже разбирается', async () => {
    const res = await send(
      JSON.stringify([
        {
          type: 'csp-violation',
          body: { documentURL: 'https://imbored.cc/', effectiveDirective: 'connect-src', blockedURL: 'https://three.example/api' },
        },
      ]),
      { 'content-type': 'application/reports+json' },
    )
    expect(res.status).toBe(204)
    expect(logged()).toEqual([
      { event: 'csp-report', directive: 'connect-src', blocked: 'https://three.example', page: '/' },
    ])
  })

  // Число за час по директиве — те же прореженные строки, а не каждый отчёт:
  // иначе запись в базу на каждого посетителя и каждое расширение
  test('в почасовой счётчик ложится то, что попало в лог', async () => {
    for (let i = 0; i < 3; i++) await send(report('https://four.example/y.png'))
    await send(report('https://five.example/z.png'))
    await vi.waitFor(async () => {
      const res = await db.execute("SELECT key, count FROM telemetry_hourly WHERE kind = 'csp'")
      expect(res.rows.map((r) => [r.key, Number(r.count)])).toEqual([['img-src', 2]])
    })
  })

  test('не JSON — 400, слишком большое тело — 413, в лог ничего', async () => {
    expect((await send('not json')).status).toBe(400)
    expect((await send('{}', { 'content-length': String(1024 * 1024) })).status).toBe(413)
    expect((await send(JSON.stringify({ pad: 'x'.repeat(70 * 1024) }))).status).toBe(413)
    // разобралось, но нарушения в нём нет
    expect((await send('{}')).status).toBe(204)
    expect(warn).not.toHaveBeenCalled()
  })
})
