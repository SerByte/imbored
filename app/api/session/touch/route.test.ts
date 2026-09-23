import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { sweepStale, upsertUser, type Db } from '@/lib/db'
import { SESSION_COOKIE, sessionSecret } from '@/lib/server'
import { verifySessionV2 } from '@/lib/session'
import { SESSION_TOUCH_AFTER_SEC } from '@/lib/sessions'
import { setTestCookie } from '@/lib/testing/headers'
import { STEAMID_OF, freshDb, post, signIn, signInAs } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * /api/session/touch — единственное место, где вход продлевается, а значит и
 * единственное, где кука могла превратиться в другую.
 */

const T0 = 1_760_000_000

let db: Db

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0 * 1000)
  db = await freshDb()
})

afterEach(() => {
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
    const steamid = STEAMID_OF.demo
    await upsertUser(db, { steamid, personaName: 'Демо-игрок' }, T0)
    await signIn(db, steamid)
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
})
