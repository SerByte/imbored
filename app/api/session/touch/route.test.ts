import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveDailyPick, sweepStale, upsertGamesMeta, upsertUser, type Db } from '@/lib/db'
import { dayKey } from '@/lib/daily'
import { SESSION_COOKIE, sessionSecret } from '@/lib/server'
import { verifySessionV2 } from '@/lib/session'
import { SESSION_TOUCH_AFTER_SEC } from '@/lib/sessions'
import { setTestCookie } from '@/lib/testing/headers'
import { STEAMID_OF, freshDb, post, signIn, signInAs } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/*
 * after() из next/server вне сервера Next бросает, и роут тогда пускает
 * работу сам, никого не дожидаясь. Здесь она складывается в список, чтобы тест
 * мог её дождаться: иначе «повтор в те же сутки не считается» проверялся бы
 * гонкой с таймером.
 */
const { pending } = vi.hoisted(() => ({ pending: [] as Array<Promise<unknown>> }))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (work: Promise<unknown> | (() => unknown)) => {
    pending.push(typeof work === 'function' ? Promise.resolve().then(work) : work)
  },
}))

/** Дождаться всего, что роут отложил на после ответа */
async function settled(): Promise<void> {
  while (pending.length) await pending.shift()
}

/**
 * /api/session/touch — единственное место, где вход продлевается, а значит и
 * единственное, где кука могла превратиться в другую.
 */

const T0 = 1_760_000_000
const DAY = 86_400

let db: Db

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0 * 1000)
  db = await freshDb()
})

afterEach(async () => {
  // Отложенное прошлым тестом не должно доехать до базы следующего
  await settled()
  vi.useRealTimers()
})

/** Новое значение куки сессии из ответа, если роут его ставил. */
function newCookie(res: Response): string | null {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))
  return line ? decodeURIComponent(line.slice(SESSION_COOKIE.length + 1).split(';')[0]) : null
}

describe('/api/session/touch', () => {
  test('легаси-кука v1 — гость, и годовой сессии взамен не выдаётся', async () => {
    // Раньше именно здесь v1 без срока менялась на свежую v2 на год: утёкший
    // однажды токен работал вечно. Формата в коде больше нет — собираем руками.
    const steamid = STEAMID_OF.openid
    const hmac = createHmac('sha256', sessionSecret()).update(steamid).digest('hex')
    setTestCookie(SESSION_COOKIE, `${steamid}.${hmac}`)

    const res = await POST(post('/api/session/touch'))
    expect(await res.json()).toEqual({ authed: false })
    expect(newCookie(res)).toBeNull()
    // и строки под неё тоже не заводится
    const rows = await db.execute('SELECT COUNT(*) AS n FROM sessions')
    expect(Number(rows.rows[0]?.n)).toBe(0)
  })

  test('через неделю кука продлевается с тем же sid', async () => {
    const { sid } = await signIn(db, STEAMID_OF.openid, { verified: true })
    vi.setSystemTime((T0 + SESSION_TOUCH_AFTER_SEC + 60) * 1000)

    const res = await POST(post('/api/session/touch'))
    const renewed = verifySessionV2(newCookie(res) ?? '', sessionSecret())
    expect(renewed?.sid).toBe(sid)
    expect(renewed?.iat).toBe(T0 + SESSION_TOUCH_AFTER_SEC + 60)
  })

  test('свежая кука не переставляется', async () => {
    await signIn(db, STEAMID_OF.openid, { verified: true })
    const res = await POST(post('/api/session/touch'))
    expect(newCookie(res)).toBeNull()
  })

  test('демо, в которое заходят каждый день, суточная уборка не трогает', async () => {
    // Визит продлевает куку и отметку seen_at лишь раз в неделю, а уборка
    // считала неделю без отметки молчанием: демо без оценок сносило на
    // седьмой день посреди пользования.
    const DAY = 86_400
    const steamid = await signInAs(db, 'demo')
    for (let day = 1; day <= 40; day++) {
      vi.setSystemTime((T0 + day * DAY) * 1000)
      const res = await POST(post('/api/session/touch'))
      expect(await res.json(), `день ${day}`).toMatchObject({ authed: true, steamid })
      const renewed = newCookie(res)
      if (renewed) setTestCookie(SESSION_COOKIE, renewed)
      // уборка — ночью, между этим визитом и завтрашним
      await sweepStale(db, T0 + day * DAY + DAY / 2)
      const left = await db.execute({
        sql: 'SELECT COUNT(*) AS n FROM users WHERE steamid = ?',
        args: [steamid],
      })
      expect(Number(left.rows[0]?.n), `день ${day}`).toBe(1)
    }
  })

  test('кука демо, убранного уборкой, — гость, а не вход без библиотеки', async () => {
    // Кука живёт год, а демо — неделю тишины. Раньше после уборки touch
    // отвечал authed: true, лендинг звал «Продолжить», а /library и /play без
    // снимка разворачивали обратно: из петли выводил только вход через Steam.
    const steamid = await signInAs(db, 'demo')
    const later = T0 + 30 * 86_400
    vi.setSystemTime(later * 1000)
    expect((await sweepStale(db, later)).demos).toBe(1)

    const res = await POST(post('/api/session/touch'))
    expect(await res.json()).toEqual({ authed: false })
    // и продлевать нечего — годовой куки взамен не выдаётся
    expect(newCookie(res)).toBeNull()
    const users = await db.execute({
      sql: 'SELECT COUNT(*) AS n FROM users WHERE steamid = ?',
      args: [steamid],
    })
    expect(Number(users.rows[0]?.n)).toBe(0)
  })

  test('writer: пишут вход через Steam и демо, сессия по ссылке — только читает', async () => {
    for (const [kind, writer] of [
      ['openid', true],
      ['demo', true],
      ['claimed', false],
    ] as const) {
      await signInAs(db, kind)
      const res = await POST(post('/api/session/touch'))
      expect(await res.json(), kind).toMatchObject({ authed: true, writer })
    }
  })

  test('card=1 говорит главной, демо ли это; без card признака нет', async () => {
    for (const [kind, demo] of [
      ['openid', false],
      ['claimed', false],
      ['demo', true],
    ] as const) {
      await signInAs(db, kind)
      const card = await (await POST(post('/api/session/touch?card=1'))).json()
      expect(card, kind).toMatchObject({ authed: true, demo })
      // Остальные страницы спрашивают только writer — ник и демо им не нужны
      const plain = await (await POST(post('/api/session/touch'))).json()
      expect(plain, kind).not.toHaveProperty('demo')
    }
  })

  test('card=1 у пишущей сессии — живая строка: игра дня и «как тебе?»', async () => {
    const steamid = await signInAs(db, 'openid')
    // Пока сказать нечего — поле есть, но пустое: карточка покажет дверь в библиотеку
    const empty = await (await POST(post('/api/session/touch?card=1'))).json()
    expect(empty.live).toEqual({ daily: null, ask: null })

    await saveDailyPick(
      db,
      steamid,
      dayKey(T0),
      {
        pick: { appid: 620, name: 'Portal 2', source: 'untouched' },
        shelf: [],
        hoursPlayed: null,
        reasonBase: 'Причина.',
        sharedTags: [],
        hideUrgency: false,
      },
      T0,
    )
    await upsertGamesMeta(db, [{ appid: 1145360, name: 'Hades', tags: {}, genres: [], categories: [] }], T0)
    // Совет два дня назад, сверен, сыграно 135 минут, ответа нет — pendingOutcomeAsk
    await db.execute({
      sql: `INSERT INTO outcomes (steamid, appid, source, shown_at, minutes_before, minutes_after, owned_after, checked_at)
            VALUES (?, 1145360, 'backlog', ?, 60, 195, 1, ?)`,
      args: [steamid, T0 - 2 * 86_400, T0 - 86_400],
    })
    const card = await (await POST(post('/api/session/touch?card=1'))).json()
    expect(card.live).toEqual({
      daily: { appid: 620, name: 'Portal 2' },
      ask: { appid: 1145360, name: 'Hades', shownAt: T0 - 2 * 86_400, minutes: 135, bought: false },
    })
    // Остальным страницам живая строка не нужна — и в базу за ней не ходят
    const plain = await (await POST(post('/api/session/touch'))).json()
    expect(plain).not.toHaveProperty('live')
  })

  test('демо и вход по ссылке живой строки не получают', async () => {
    for (const kind of ['demo', 'claimed'] as const) {
      await signInAs(db, kind)
      const card = await (await POST(post('/api/session/touch?card=1'))).json()
      expect(card, kind).toMatchObject({ authed: true })
      expect(card, kind).not.toHaveProperty('live')
    }
  })
})

/**
 * Отметка возврата (lib/retention) стоит в роуте, а не в SessionKeeper: на
 * главной он молчит, и её заход приходит сюда же с card=1. T0 — четверг
 * 2025-10-09 по Москве, неделя 2025-W41.
 */
describe('/api/session/touch: возвраты по когортам', () => {
  async function returns(): Promise<Record<string, number>> {
    const res = await db.execute(
      "SELECT key, SUM(count) AS n FROM telemetry_hourly WHERE key GLOB 'return:*' GROUP BY key ORDER BY key",
    )
    return Object.fromEntries(res.rows.map((r) => [String(r.key), Number(r.n)]))
  }

  /** Заход в момент sec: touch, продлённая кука и всё отложенное после ответа */
  async function visit(sec: number, path = '/api/session/touch'): Promise<Response> {
    vi.setSystemTime(sec * 1000)
    const res = await POST(post(path))
    const renewed = newCookie(res)
    if (renewed) setTestCookie(SESSION_COOKIE, renewed)
    await settled()
    return res
  }

  /** Вход через Steam: строку users заводит возврат OpenID (upsertUser) */
  async function steamUser(): Promise<void> {
    await upsertUser(db, { steamid: STEAMID_OF.openid }, T0)
    await signInAs(db, 'openid')
  }

  test('приход, назавтра, вторая неделя и месяц — по единице; повторы в окне не удваивают', async () => {
    await steamUser()
    await visit(T0)
    // Те же сутки с главной: её touch с card=1 — тот же заход
    await visit(T0 + 60, '/api/session/touch?card=1')
    for (const n of [1, 3, 8, 12, 31, 35, 50]) await visit(T0 + n * DAY)
    expect(await returns()).toEqual({
      'return:2025-W41:d0:steam': 1,
      'return:2025-W41:d1:steam': 1,
      'return:2025-W41:d7:steam': 1,
      'return:2025-W41:d30:steam': 1,
    })
  })

  test('демо считается отдельно от Steam', async () => {
    await signInAs(db, 'demo')
    await visit(T0)
    await visit(T0 + DAY)
    expect(await returns()).toEqual({
      'return:2025-W41:d0:demo': 1,
      'return:2025-W41:d1:demo': 1,
    })
  })

  test('у демо d30 — нижняя граница: пропавшего на две недели уборка сносит раньше окна', async () => {
    // На этом стоит оговорка в DEPLOY.md, 6.10, и пустой d30 демо в отчёте.
    // Поменяется уборка демо — перечитай оговорку
    await signInAs(db, 'demo')
    await visit(T0)
    await visit(T0 + 8 * DAY)
    for (let day = 9; day <= 29; day++) await sweepStale(db, T0 + day * DAY + DAY / 2)
    // Кука жива, а личности уже нет: гость, и возврат через месяц не считается
    expect(await (await visit(T0 + 30 * DAY)).json()).toEqual({ authed: false })
    expect(await returns()).toEqual({
      'return:2025-W41:d0:demo': 1,
      'return:2025-W41:d7:demo': 1,
    })
  })

  test('главная и страница разом — одна единица: защёлка на сервере', async () => {
    await steamUser()
    await Promise.all([POST(post('/api/session/touch?card=1')), POST(post('/api/session/touch'))])
    await settled()
    expect(await returns()).toEqual({ 'return:2025-W41:d0:steam': 1 })
  })

  test('гость и вход без строки users ничего не считают', async () => {
    await visit(T0)
    // Строка users не записалась при входе — кука всё равно живая
    await signInAs(db, 'openid')
    expect(await (await visit(T0 + 60)).json()).toMatchObject({ authed: true })
    expect(await returns()).toEqual({})
  })

  test('отказ отметки не мешает ни ответу, ни продлению', async () => {
    await steamUser()
    // Колонки нет — так выглядит любая ошибка базы на чтении отметки
    await db.execute('ALTER TABLE users RENAME COLUMN last_active_day TO gone_day')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await visit(T0 + SESSION_TOUCH_AFTER_SEC + 60)
      expect(await res.json()).toMatchObject({ authed: true, steamid: STEAMID_OF.openid })
      expect(newCookie(res)).not.toBeNull()
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('touch:return')
    } finally {
      warn.mockRestore()
    }
    expect(await returns()).toEqual({})
  })
})
