import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Db } from '@/lib/db'
import { SESSION_COOKIE, currentSession } from '@/lib/server'
import { forgetSessionCache } from '@/lib/sessions'
import { setTestCookie } from '@/lib/testing/headers'
import { STEAMID_OF, freshDb, post, signIn, signInAs, signOut } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Выход. Держит три обещания: кука гасится всегда и первой, обычный выход
 * трогает только это устройство, а «везде» — только у доказанного входа
 * через Steam (иначе чужой по ссылке на профиль выкидывал бы владельца со
 * всех устройств).
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

const logout = (all = false) => POST(post(`/api/auth/logout${all ? '?scope=all' : ''}`))

/** Кука сессии в ответе погашена */
const cleared = (res: Response) =>
  res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=;`) && /Max-Age=0/i.test(c))

/** Жива ли сессия с этим токеном — как её увидел бы следующий запрос */
async function alive(token: string): Promise<boolean> {
  setTestCookie(SESSION_COOKIE, token)
  forgetSessionCache()
  return (await currentSession()) !== null
}

async function sessionsFrom(steamid: string): Promise<unknown> {
  const res = await db.execute({ sql: 'SELECT sessions_from FROM users WHERE steamid = ?', args: [steamid] })
  return res.rows[0]?.sessions_from ?? null
}

describe('/api/auth/logout', () => {
  test('гость и мусорная кука — 200, кука погашена', async () => {
    signOut()
    const guest = await logout()
    expect(guest.status).toBe(200)
    expect(await guest.json()).toEqual({ ok: true })
    expect(cleared(guest)).toBe(true)

    setTestCookie(SESSION_COOKIE, 'не-токен')
    const junk = await logout()
    expect(junk.status).toBe(200)
    expect(cleared(junk)).toBe(true)
  })

  test('обычный выход гасит только это устройство', async () => {
    const phone = await signIn(db, STEAMID_OF.openid, { verified: true })
    const laptop = await signIn(db, STEAMID_OF.openid, { verified: true })
    const res = await logout()
    expect(await res.json()).toEqual({ ok: true })
    expect(cleared(res)).toBe(true)
    expect(await alive(laptop.token)).toBe(false)
    expect(await alive(phone.token)).toBe(true)
  })

  test('«везде» у входа через Steam гасит все устройства и старые токены', async () => {
    const phone = await signIn(db, STEAMID_OF.openid, { verified: true })
    await signIn(db, STEAMID_OF.openid, { verified: true })
    vi.setSystemTime((T0 + 60) * 1000)
    const res = await logout(true)
    expect(await res.json()).toEqual({ ok: true })
    expect(cleared(res)).toBe(true)
    expect(await alive(phone.token)).toBe(false)
    expect(await sessionsFrom(STEAMID_OF.openid)).not.toBeNull()
  })

  test('«везде» у сессии по ссылке и у демо — только это устройство, и сказано прямо', async () => {
    for (const kind of ['claimed', 'demo'] as const) {
      const steamid = STEAMID_OF[kind]
      const other = await signIn(db, steamid)
      await signInAs(db, kind)
      const res = await logout(true)
      const body = (await res.json()) as { scope?: string; reason?: string }
      expect(body.scope).toBe('this-device')
      expect(body.reason).toBeTruthy()
      // кука погашена и в этой ветке: ответ пересобран из заголовков
      expect(cleared(res)).toBe(true)
      expect(await alive(other.token)).toBe(true)
      expect(await sessionsFrom(steamid)).toBeNull()
    }
  })
})
