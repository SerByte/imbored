import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Db } from '@/lib/db'
import { freshDb, post } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * /api/event — шаги воронки числом за час (lib/track.ts). Держит два
 * обещания: в счётчик попадает только знакомое событие из закрытого списка,
 * и один адрес не может накрутить его без потолка.
 */

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

const send = (body: unknown, ip = '203.0.113.7') => POST(post('/api/event', body, { 'x-forwarded-for': ip }))

async function counted(): Promise<Array<[string, number]>> {
  const res = await db.execute("SELECT key, count FROM telemetry_hourly WHERE kind = 'event' ORDER BY key")
  return res.rows.map((r) => [String(r.key), Number(r.count)])
}

describe('/api/event', () => {
  test('шаг — 204 и плюс один к «событие:источник»', async () => {
    expect((await send({ event: 'quiz_done', source: 'compat' })).status).toBe(204)
    expect((await send({ event: 'quiz_done', source: 'compat' })).status).toBe(204)
    expect((await send({ event: 'launch_click' })).status).toBe(204)
    await vi.waitFor(async () =>
      expect(await counted()).toEqual([
        ['launch_click:direct', 1],
        ['quiz_done:compat', 2],
      ]),
    )
  })

  test('чужое событие и мусор — 204 без записи, битое тело — 400, большое — 413', async () => {
    expect((await send({ event: 'connect_ok' })).status).toBe(204)
    expect((await send({ event: 'quiz_done', source: '76561197960287930', extra: 'x' })).status).toBe(204)
    expect((await POST(new Request('http://localhost/api/event', { method: 'POST', body: 'не json' }))).status).toBe(400)
    expect((await send({ event: 'quiz_done', pad: 'x'.repeat(600) })).status).toBe(413)
    await vi.waitFor(async () => expect(await counted()).toEqual([['quiz_done:direct', 1]]))
    // ни SteamID, ни адреса в таблицу не попало
    const all = await db.execute('SELECT * FROM telemetry_hourly')
    expect(JSON.stringify(all.rows)).not.toMatch(/7656119|203\.0\.113/)
  })

  test('один адрес упирается в потолок, соседний — нет', async () => {
    let last = 0
    for (let i = 0; i < 61; i++) last = (await send({ event: 'share_click' }, '198.51.100.9')).status
    expect(last).toBe(429)
    expect((await send({ event: 'share_click' }, '198.51.100.10')).status).toBe(204)
  })
})
