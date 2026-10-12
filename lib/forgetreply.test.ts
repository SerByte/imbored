import { describe, expect, test } from 'vitest'
import { forgetPreviewReply, forgetReply } from './forgetreply'

/**
 * Ответы /api/forget глазами кнопки «Удалить всё обо мне». Главное здесь —
 * что «всё удалено» звучит только по ответу самого роута: человек, ушедший с
 * экрана с этими словами после обрыва, считал бы себя забытым.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('forgetReply: удаление', () => {
  test('удалено — только { ok: true } от роута', async () => {
    expect(await forgetReply(json({ ok: true }))).toBe('done')
    expect(await forgetReply(json({}))).toBe('failed')
    expect(await forgetReply(new Response('<html>ok</html>', { status: 200 }))).toBe('failed')
  })

  test('отказы роута названы своими словами, остальное — failed', async () => {
    expect(await forgetReply(json({ error: 'needsteam' }, 403))).toBe('needsteam')
    expect(await forgetReply(json({ error: 'ratelimited' }, 429))).toBe('ratelimited')
    expect(await forgetReply(json({ error: 'nosession' }, 401))).toBe('gone')
    expect(await forgetReply(json({ error: 'failed' }, 503))).toBe('failed')
    expect(await forgetReply(json({ error: 'badinput' }, 400))).toBe('failed')
    // 403 без кода — не наш needsteam: страница платформы, а не «войди через Steam»
    expect(await forgetReply(new Response('Forbidden', { status: 403 }))).toBe('failed')
  })
})

describe('forgetPreviewReply: что хранится', () => {
  test('списки строк — ok, всё прочее — failed', async () => {
    expect(await forgetPreviewReply(json({ items: ['Снимки библиотеки — 3'], effects: ['Ты выйдешь на всех устройствах.'] }))).toEqual({
      kind: 'ok',
      items: ['Снимки библиотеки — 3'],
      effects: ['Ты выйдешь на всех устройствах.'],
    })
    expect(await forgetPreviewReply(json({ items: [1], effects: [] }))).toEqual({ kind: 'failed' })
    expect(await forgetPreviewReply(json(null))).toEqual({ kind: 'failed' })
  })

  test('отказы — те же коды, что у удаления', async () => {
    expect(await forgetPreviewReply(json({ error: 'needsteam' }, 403))).toEqual({ kind: 'needsteam' })
    expect(await forgetPreviewReply(json({ error: 'ratelimited' }, 429))).toEqual({ kind: 'ratelimited' })
    expect(await forgetPreviewReply(json({ error: 'nosession' }, 401))).toEqual({ kind: 'gone' })
    expect(await forgetPreviewReply(new Response('oops', { status: 502 }))).toEqual({ kind: 'failed' })
  })
})
