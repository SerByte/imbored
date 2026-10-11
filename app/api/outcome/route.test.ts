import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  listFeedback,
  listLiked,
  logFeedback,
  recordOutcome,
  saveLibrarySnapshot,
  upsertGamesMeta,
  type Db,
} from '@/lib/db'
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
    await POST(post('/api/outcome', { appid: 620, shownAt, verdict: 'meh' }))
    expect(await listFeedback(db, steamid)).toEqual([])
    const row = await db.execute({ sql: 'SELECT verdict FROM outcomes WHERE steamid = ?', args: [steamid] })
    expect(row.rows.map((r) => r.verdict)).toEqual(['meh'])
  })

  // Ответ меняется в «Твоих вечерах»: передумал в сторону «Зацепило» — одно
  // «зашло», а повтор того же ответа второго не заводит
  test('поменял ответ на «Зацепило» — одно «зашло», повтор второго не пишет', async () => {
    const steamid = await signInAs(db, 'openid')
    const shownAt = await played(steamid)
    await POST(post('/api/outcome', { appid: 620, shownAt, verdict: 'meh' }))
    await POST(post('/api/outcome', { appid: 620, shownAt, verdict: 'hooked' }))
    await POST(post('/api/outcome', { appid: 620, shownAt, verdict: 'hooked' }))
    const liked = (await listFeedback(db, steamid)).filter((f) => f.action === 'liked')
    expect(liked).toHaveLength(1)
    const row = await db.execute({ sql: 'SELECT verdict FROM outcomes WHERE steamid = ?', args: [steamid] })
    expect(row.rows.map((r) => r.verdict)).toEqual(['hooked'])
  })

  // Обратно: «Зацепило» → «Так себе» забирает «зашло», заведённое ответом, —
  // иначе смена ответа не меняла бы подбор и полку «Зашло»
  test('передумал: «Зацепило» → «Так себе» забирает «зашло» ответа, но не нажатое само', async () => {
    const steamid = await signInAs(db, 'openid')
    const shownAt = await played(steamid)
    await POST(post('/api/outcome', { appid: 620, shownAt, verdict: 'hooked' }))
    expect(await listLiked(db, steamid)).toHaveLength(1)
    await POST(post('/api/outcome', { appid: 620, shownAt, verdict: 'meh' }))
    expect(await listLiked(db, steamid)).toEqual([])

    // «Зашло», нажатое на /play, — отдельное слово: смена ответа его не трогает
    await logFeedback(db, { steamid, appid: 620, action: 'liked' }, nowSec() + 90_000)
    await POST(post('/api/outcome', { appid: 620, shownAt, verdict: 'hooked' }))
    await POST(post('/api/outcome', { appid: 620, shownAt, verdict: 'meh' }))
    expect((await listFeedback(db, steamid)).filter((f) => f.action === 'liked')).toHaveLength(1)
  })

  /*
   * Обратный порядок: сначала «Зацепило» в ответе, через час — «Зашло»
   * кнопкой на /play или /daily. Суточный дедуп глотал кнопку («уже есть
   * зашло»), и единственной строкой оставалась строка ответа — смена ответа
   * на «Так себе» забирала её, а с ней и «Зашло», сказанное отдельно.
   */
  test('«Зашло» кнопкой после «Зацепило» в ответе переживает смену ответа', async () => {
    const steamid = await signInAs(db, 'openid')
    const shownAt = await played(steamid)
    await POST(post('/api/outcome', { appid: 620, shownAt, verdict: 'hooked' }))
    await logFeedback(db, { steamid, appid: 620, action: 'liked' }, nowSec() + 3600)
    await POST(post('/api/outcome', { appid: 620, shownAt, verdict: 'meh' }))
    expect((await listLiked(db, steamid)).map((g) => g.appid)).toEqual([620])
  })

  /*
   * Два ответа разом — с двух вкладок или двух устройств. Чтение прежнего
   * ответа и запись нового шли разными запросами: оба читали «ответа нет»,
   * «Зацепило» заводило «зашло», а «Так себе», не видя прежнего «Зацепило»,
   * его не забирало. Ответ оставался «Так себе», игра — на полке «Зашло», и
   * никакая следующая смена ответа этого уже не чинила.
   */
  test.each([
    ['hooked', 'meh'],
    ['meh', 'hooked'],
  ] as const)('ответы «%s» и «%s» разом: «зашло» есть ровно при «Зацепило»', async (first, second) => {
    const steamid = await signInAs(db, 'openid')
    const shownAt = await played(steamid)
    const res = await Promise.all([
      POST(post('/api/outcome', { appid: 620, shownAt, verdict: first })),
      POST(post('/api/outcome', { appid: 620, shownAt, verdict: second })),
    ])
    expect(res.map((r) => r.status)).toEqual([200, 200])
    const row = await db.execute({ sql: 'SELECT verdict FROM outcomes WHERE steamid = ?', args: [steamid] })
    const verdict = row.rows[0]?.verdict
    const liked = (await listFeedback(db, steamid)).filter((f) => f.action === 'liked')
    expect(liked, `ответ ${String(verdict)}`).toHaveLength(verdict === 'hooked' ? 1 : 0)
  })

  test('«Закрыть» из забытой вкладки настоящий ответ не стирает', async () => {
    const steamid = await signInAs(db, 'openid')
    const shownAt = await played(steamid)
    await POST(post('/api/outcome', { appid: 620, shownAt, verdict: 'hooked' }))
    const res = await POST(post('/api/outcome', { appid: 620, shownAt, verdict: 'dismissed' }))
    expect(res.status).toBe(200)
    const row = await db.execute({ sql: 'SELECT verdict FROM outcomes WHERE steamid = ?', args: [steamid] })
    expect(row.rows.map((r) => r.verdict)).toEqual(['hooked'])
    expect(await listLiked(db, steamid)).toHaveLength(1)
  })
})
