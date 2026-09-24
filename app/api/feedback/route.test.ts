import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { listExplore, listFeedback, type Db } from '@/lib/db'
import { STEAMID_OF, freshDb, post, signIn, signInAs } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

// Сброс кэша портрета: настоящий revalidateTag вне сервера Next бросает, а
// здесь важно только, что и какой тег роут сбросил
const revalidated = vi.hoisted(() => [] as Array<[string, unknown]>)
vi.mock('next/cache', () => ({
  revalidateTag: (tag: string, profile: unknown) => {
    revalidated.push([tag, profile])
  },
}))

/**
 * /api/feedback — настоящим роутом, на базе в памяти.
 *
 * Здесь проверяется то, что из lib/ не видно: порядок отказов и то, что до
 * записи доходит только разобранный запрос.
 */

const STEAMID = '76561197960287930'
/** Середина десятиминутного окна лимита: сто двадцать запросов не перевалят через его край. */
const MID_WINDOW_MS = (Math.floor(1_760_000_000 / 600) * 600 + 300) * 1000

let db: Db

beforeEach(async () => {
  db = await freshDb()
  revalidated.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('/api/feedback', () => {
  test('без сессии — 401 nosession, и в базу ничего', async () => {
    const res = await POST(post('/api/feedback', { appid: 620, action: 'liked' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'nosession' })
    expect(await listFeedback(db, STEAMID)).toEqual([])
  })

  test('мусор вместо запроса — 400 badinput, и в базу ничего', async () => {
    await signIn(db, STEAMID, { verified: true })
    for (const body of [
      'это не json',
      {},
      { appid: 620 },
      { appid: 620, action: 'hacked' },
      { appid: 'шестьсот двадцать', action: 'liked' },
      { appid: 6.5, action: 'liked' },
    ]) {
      const res = await POST(post('/api/feedback', body))
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.json()).toEqual({ error: 'badinput' })
    }
    expect(await listFeedback(db, STEAMID)).toEqual([])
  })

  test('разобранный запрос пишется, мусорные mood и reason отбрасываются молча', async () => {
    await signIn(db, STEAMID, { verified: true })
    const res = await POST(
      post('/api/feedback', { appid: 620, action: 'skipped', reason: 'потому что', mood: 'грустно' }),
    )
    expect(res.status).toBe(200)
    const rows = await listFeedback(db, STEAMID)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ appid: 620, action: 'skipped' })
    expect(rows[0]).not.toHaveProperty('reason')
    expect(rows[0]).not.toHaveProperty('mood')
  })

  test('сто двадцать за окно проходят, сто двадцать первый — 429 с Retry-After', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(MID_WINDOW_MS)
    await signIn(db, STEAMID, { verified: true })

    for (let i = 0; i < 120; i++) {
      const res = await POST(post('/api/feedback', { appid: 1000 + i, action: 'skipped' }))
      expect(res.status, `запрос ${i + 1}`).toBe(200)
    }
    const res = await POST(post('/api/feedback', { appid: 620, action: 'skipped' }))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'ratelimited' })
    expect(Number(res.headers.get('Retry-After'))).toBe(300)
    // Отказ — до записи: в истории ровно пропущенные лимитом сто двадцать
    expect(await listFeedback(db, STEAMID)).toHaveLength(120)
  })

  /*
   * Сессия по вставленной ссылке — только чтение. Иначе любой, кто знает чужую
   * ссылку на профиль, банил бы человеку игры и портил вкус, по которому тому
   * же человеку потом подбирают. Все действия, а не одни баны: история оценок
   * и есть профиль вкуса.
   */
  test('сессия по ссылке — 403 needsteam на любое действие, и в базу ничего', async () => {
    const steamid = await signInAs(db, 'claimed')
    for (const action of ['liked', 'skipped', 'opened', 'banned', 'launched']) {
      const res = await POST(post('/api/feedback', { appid: 620, action }))
      expect(res.status, action).toBe(403)
      expect(await res.json()).toEqual({ error: 'needsteam' })
    }
    expect(await listFeedback(db, steamid)).toEqual([])
  })

  test('needsteam — раньше разбора тела: мусор от сессии по ссылке тоже 403, не 400', async () => {
    await signInAs(db, 'claimed')
    const res = await POST(post('/api/feedback', 'это не json'))
    expect(res.status).toBe(403)
  })

  test('сессия без строки в базе (Turso моргнула на выдаче) — тоже только чтение', async () => {
    // Происхождение неизвестно — наименьшие права, как у Resolved.verified
    const { sid } = await signIn(db, STEAMID_OF.openid, { verified: true })
    await db.execute({ sql: 'DELETE FROM sessions WHERE sid = ?', args: [sid] })
    const res = await POST(post('/api/feedback', { appid: 620, action: 'banned' }))
    expect(res.status).toBe(403)
  })

  test('вход через Steam и демо пишут, как раньше', async () => {
    for (const kind of ['openid', 'demo'] as const) {
      const steamid = await signInAs(db, kind)
      const res = await POST(post('/api/feedback', { appid: 620, action: 'banned' }))
      expect(res.status, kind).toBe(200)
      expect(await listFeedback(db, steamid), kind).toHaveLength(1)
    }
  })
})

/**
 * Модель портрета кэшируется по снапшоту, а бан снапшот не меняет. Без сброса
 * «начни с этой» на портрете указывала бы на скрытую игру до следующего
 * снапшота — сутки и дольше.
 */
describe('/api/feedback: портрет после бана', () => {
  test('бан сбрасывает кэш портрета владельца, остальные действия — нет', async () => {
    const steamid = await signInAs(db, 'openid')
    for (const action of ['liked', 'skipped', 'opened', 'launched']) {
      await POST(post('/api/feedback', { appid: 620, action }))
    }
    expect(revalidated).toEqual([])

    const res = await POST(post('/api/feedback', { appid: 620, action: 'banned' }))
    expect(res.status).toBe(200)
    expect(revalidated).toEqual([[`portrait:${steamid}`, 'max']])
  })

  test('отказ в правах до сброса не доходит', async () => {
    await signInAs(db, 'claimed')
    await POST(post('/api/feedback', { appid: 620, action: 'banned' }))
    expect(revalidated).toEqual([])
  })
})

/**
 * Свайпы колоды исследователя (/explore) пишутся с причиной 'explore': по ней
 * listExplore собирает полку «Приглянулось» и не повторяет пролистанное.
 */
describe('/api/feedback: колода исследователя', () => {
  test('«Интересно» и «Мимо» пишутся с причиной explore', async () => {
    const steamid = await signInAs(db, 'openid')
    for (const [appid, action] of [
      [620, 'opened'],
      [570, 'skipped'],
    ] as const) {
      const res = await POST(post('/api/feedback', { appid, action, reason: 'explore' }))
      expect(res.status, action).toBe(200)
    }
    expect((await listExplore(db, steamid)).map((r) => [r.appid, r.liked])).toEqual([
      [570, false],
      [620, true],
    ])
  })
})

/**
 * Снимок выдачи к оценке (lib/feedbackctx) — для отчёта, белым списком. Мусор
 * в нём оценку не срывает: пишется то, что прошло, или ничего.
 */
describe('/api/feedback: снимок выдачи', () => {
  const ctxOf = async (steamid: string) =>
    (
      await db.execute({
        sql: 'SELECT ctx_json FROM feedback WHERE steamid = ? ORDER BY id',
        args: [steamid],
      })
    ).rows.map((r) => (r.ctx_json === null ? null : JSON.parse(String(r.ctx_json))))

  test('годное пишется, незнакомое отбрасывается', async () => {
    const steamid = await signInAs(db, 'openid')
    const res = await POST(
      post('/api/feedback', {
        appid: 620,
        action: 'liked',
        ctx: {
          source: 'play',
          slot: 'hero',
          rank: 0,
          engine: 'claude',
          parts: { taste: 0.51234, mood: 1.1, hacked: 9 },
          steamid: '76561197960287930',
        },
      }),
    )
    expect(res.status).toBe(200)
    expect(await ctxOf(steamid)).toEqual([
      { source: 'play', slot: 'hero', rank: 0, engine: 'claude', parts: { taste: 0.5123, mood: 1.1 } },
    ])
  })

  test('без снимка или с одним мусором — оценка есть, снимка нет', async () => {
    const steamid = await signInAs(db, 'openid')
    for (const ctx of [undefined, 'hero', { slot: 'sidebar' }, [1, 2]]) {
      const res = await POST(post('/api/feedback', { appid: 620, action: 'opened', ctx }))
      expect(res.status, JSON.stringify(ctx)).toBe(200)
    }
    expect(await ctxOf(steamid)).toEqual([null, null, null, null])
  })
})

/**
 * Исход совета (lib/outcome.ts): запуск и переход в магазин за не купленной
 * заводят строку, которую следующие снапшоты дополнят реальными минутами.
 */
describe('/api/feedback: исход совета', () => {
  const outcomesOf = async (steamid: string) =>
    (
      await db.execute({
        sql: `SELECT appid, source, launched_at IS NOT NULL AS launched
                FROM outcomes WHERE steamid = ? ORDER BY appid`,
        args: [steamid],
      })
    ).rows.map((r) => [Number(r.appid), r.source, Number(r.launched)])

  test('запуск и магазин пишут исход, остальное — нет', async () => {
    const steamid = await signInAs(db, 'openid')
    const send = (appid: number, action: string, ctx?: unknown) =>
      POST(post('/api/feedback', { appid, action, ctx }))
    await send(620, 'launched', { source: 'play', intent: 'launch', candidate: 'untouched' })
    await send(999, 'opened', { source: 'play', intent: 'store', candidate: 'new' })
    // карточка на сайте, «Зашло», скип — не совет, принятый в работу
    await send(570, 'opened', { source: 'play', intent: 'details' })
    await send(440, 'liked', { source: 'play' })
    await send(730, 'skipped')
    // запуск без снимка — тоже запуск, только без источника
    await send(10, 'launched')
    expect(await outcomesOf(steamid)).toEqual([
      [10, null, 1],
      [620, 'untouched', 1],
      [999, 'new', 0],
    ])
  })

  test('демо-личности исход не пишется: её библиотека не меняется', async () => {
    const steamid = await signInAs(db, 'demo')
    const res = await POST(post('/api/feedback', { appid: 620, action: 'launched' }))
    expect(res.status).toBe(200)
    expect(await outcomesOf(steamid)).toEqual([])
  })
})
