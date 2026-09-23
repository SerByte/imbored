import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import { freshDb, post } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * /api/clienterr — единственный способ узнать, что у человека упала
 * клиентская страница. Потерянный отчёт — регрессия, которую видит только он;
 * лог без масок — чужие steamid и коды пати там, где обещано, что их нет.
 *
 * Прореживание одинаковых строк живёт на модуле роута и общее на весь файл,
 * поэтому у каждого теста свой текст ошибки.
 */

let log: MockInstance<typeof console.error>

beforeEach(async () => {
  await freshDb()
  log = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => log.mockRestore())

const report = (message: string, over: Record<string, unknown> = {}) => ({
  kind: 'boundary',
  message,
  name: 'TypeError',
  page: '/play',
  code: 'c0abc123',
  ...over,
})

const lines = () => log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)

describe('/api/clienterr', () => {
  test('падение — одна строка client-error в логе, ответ 204', async () => {
    const res = await POST(post('/api/clienterr', report('один'), { 'user-agent': 'Firefox/140', 'x-forwarded-for': '203.0.113.7' }))
    expect(res.status).toBe(204)
    expect(lines()).toEqual([
      {
        event: 'client-error',
        kind: 'boundary',
        message: 'один',
        name: 'TypeError',
        page: '/play',
        code: 'c0abc123',
        ua: 'Firefox/140',
      },
    ])
    // адрес не логируется: он не нужен, а это персональные данные
    expect(String(log.mock.calls[0][0])).not.toContain('203.0.113.7')
  })

  test('тело не проходит в лог как есть: маски заново, лишние поля — мимо', async () => {
    await POST(
      post(
        '/api/clienterr',
        report('упало на /room/K7Q2PX?join=K7Q2PX', {
          page: '/compat/76561198000000000',
          cookie: 'imbored_session=SECRET',
        }),
      ),
    )
    const line = String(log.mock.calls[0][0])
    expect(line).not.toContain('K7Q2PX')
    expect(line).not.toContain('76561198000000000')
    expect(line).not.toContain('SECRET')
    expect(lines()[0]).toMatchObject({ page: '/compat/:steamid', message: 'упало на /room/:id?join=…' })
  })

  test('та же поломка от следующих посетителей лог не засоряет', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await POST(post('/api/clienterr', report('два'), { 'x-forwarded-for': `198.51.100.${i}` }))
      expect(res.status).toBe(204)
    }
    expect(lines()).toHaveLength(1)
  })

  test('один адрес не зальёт ни лог, ни базу: потолок — 429', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 22; i++) {
      const res = await POST(post('/api/clienterr', report(`три-${i}`), { 'x-forwarded-for': '192.0.2.1' }))
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 20).every((s) => s === 204)).toBe(true)
    expect(statuses.slice(20)).toEqual([429, 429])
    expect(lines()).toHaveLength(20)
  })

  test('мусор отвечает без лога', async () => {
    expect((await POST(post('/api/clienterr', 'не json'))).status).toBe(400)
    expect((await POST(post('/api/clienterr', { kind: 'hack', message: 'x' }))).status).toBe(204)
    expect((await POST(post('/api/clienterr', 'x'.repeat(9000)))).status).toBe(413)
    expect(log).not.toHaveBeenCalled()
  })
})
