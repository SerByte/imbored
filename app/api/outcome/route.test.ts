import { beforeEach, describe, expect, test, vi } from 'vitest'
import { listFeedback, recordOutcome, saveLibrarySnapshot, upsertGamesMeta, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, post, signInAs, signOut } from '@/lib/testing/route'
import { GET, POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * /api/outcome — «как тебе?» после сыгранного (lib/outcome.ts), настоящим
 * роутом. Здесь то, чего не видно из lib/: кому вопрос вообще задаётся, кто
 * вправе ответить и что ответ делает с оценками.
 */

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

/** Совет три дня назад и снапшот сегодня, по которому в игре прибавилось 90 минут */
async function played(steamid: string): Promise<number> {
  const now = nowSec()
  const shownAt = now - 3 * 86_400
  await upsertGamesMeta(
    db,
    [{ appid: 620, name: 'Portal 2', tags: { Puzzle: 100 }, genres: [], categories: [] }],
    now,
  )
  const lib = (minutes: number) => [
    { appid: 620, name: 'Portal 2', playtimeForever: minutes, playtime2Weeks: 0 },
  ]
  await saveLibrarySnapshot(db, steamid, lib(30), shownAt - 60)
  await recordOutcome(db, { steamid, appid: 620, source: 'untouched', launched: true }, shownAt)
  await saveLibrarySnapshot(db, steamid, lib(120), now)
  return shownAt
}

describe('/api/outcome: вопрос', () => {
  test('гостю и сессии по ссылке — ничего, даже если есть о чём спросить', async () => {
    let res = await GET()
    expect(await res.json()).toEqual({ ask: null })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')

    const claimed = await signInAs(db, 'claimed')
    await played(claimed)
    res = await GET()
    expect(await res.json()).toEqual({ ask: null })
  })

  test('вошедшему — самый свежий заметно сыгранный совет', async () => {
    const steamid = await signInAs(db, 'openid')
    const shownAt = await played(steamid)
    const res = await GET()
    expect(await res.json()).toEqual({
      ask: { appid: 620, name: 'Portal 2', shownAt, minutes: 90, bought: false },
    })
  })
})

describe('/api/outcome: ответ', () => {
  test('сессия по ссылке — 403 needsteam, и ответ не пишется', async () => {
    const steamid = await signInAs(db, 'claimed')
    const shownAt = await played(steamid)
    const res = await POST(post('/api/outcome', { appid: 620, shownAt, verdict: 'hooked' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'needsteam' })
    expect(await listFeedback(db, steamid)).toEqual([])
  })

  test('без сессии — 401', async () => {
    signOut()
    const res = await POST(post('/api/outcome', { appid: 620, shownAt: 1, verdict: 'meh' }))
    expect(res.status).toBe(401)
  })

  test('мусор — 400 badinput', async () => {
    await signInAs(db, 'openid')
    for (const body of [
      'не json',
      {},
      { appid: 620, shownAt: 1, verdict: 'liked' },
      { appid: 0, shownAt: 1, verdict: 'meh' },
      { appid: 620, shownAt: 'вчера', verdict: 'meh' },
    ]) {
      const res = await POST(post('/api/outcome', body))
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
  })

  test('«Зацепило» — ответ и оценка «зашло»; вопрос больше не задаётся', async () => {
    const steamid = await signInAs(db, 'openid')
    const shownAt = await played(steamid)
    const res = await POST(post('/api/outcome', { appid: 620, shownAt, verdict: 'hooked' }))
    expect(res.status).toBe(200)
    expect((await listFeedback(db, steamid)).map((f) => [f.appid, f.action])).toEqual([[620, 'liked']])
    expect(await (await GET()).json()).toEqual({ ask: null })
  })

  test('«Так себе» и «Закрыть» — только ответ, вкус не трогают; повтор ничего не дописывает', async () => {
    const steamid = await signInAs(db, 'openid')
    const shownAt = await played(steamid)
    await POST(post('/api/outcome', { appid: 620, shownAt, verdict: 'meh' }))
    // Второй ответ с соседней вкладки — не «зашло» поверх «так себе»
    await POST(post('/api/outcome', { appid: 620, shownAt, verdict: 'hooked' }))
    expect(await listFeedback(db, steamid)).toEqual([])
    const row = await db.execute({ sql: 'SELECT verdict FROM outcomes WHERE steamid = ?', args: [steamid] })
    expect(row.rows.map((r) => r.verdict)).toEqual(['meh'])
  })
})
