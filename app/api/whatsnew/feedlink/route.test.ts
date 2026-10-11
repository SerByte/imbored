import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { feedLinkOwner, getFeedLink, type Db } from '@/lib/db'
import { FEED_LINK_LIMIT, feedTokenHash } from '@/lib/feedlink'
import { freshDb, signInAs, signOut } from '@/lib/testing/route'
import { DELETE, POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Выпуск, перевыпуск и отключение секретной ссылки на личную RSS-ленту.
 *
 * Обещания: выпускает только пишущая сессия (вход через Steam или демо —
 * requireWriter), ключ показывается один раз и в базу не попадает,
 * перевыпуск гасит прежнюю ссылку, а ответ с ключом нигде не кэшируется.
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

// Тела у ручки нет: кто и что — из сессии. Межсайтовый POST/DELETE отсекает
// proxy.ts по Origin ещё до роута (lib/origin.test.ts)
const issue = () => POST()
const disable = () => DELETE()

/** Ключ из ответа на выпуск — последний сегмент пути */
async function keyOf(res: Response): Promise<string> {
  const body = (await res.json()) as { path?: unknown }
  expect(typeof body.path).toBe('string')
  const path = body.path as string
  expect(path).toMatch(/^\/whatsnew\/feed\/[0-9a-f]{32}$/)
  return path.split('/').pop()!
}

async function linkRows(): Promise<number> {
  const res = await db.execute('SELECT COUNT(*) AS n FROM feed_links')
  return Number(res.rows[0]?.n)
}

describe('/api/whatsnew/feedlink: кто выпускает', () => {
  test('гость — 401, ссылки нет', async () => {
    signOut()
    expect((await issue()).status).toBe(401)
    expect((await disable()).status).toBe(401)
    expect(await linkRows()).toBe(0)
  })

  /**
   * Сессия по вставленной ссылке на профиль владение не доказала. Выпусти
   * она ключ — любой, кто знает чужой профиль, получил бы постоянный доступ
   * к его ленте мимо входа, и ещё мог бы отключить владельцу его ссылку.
   */
  test('сессия по ссылке на профиль — 403 needsteam: ни выпустить, ни отключить', async () => {
    await signInAs(db, 'claimed')
    const res = await issue()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'needsteam' })
    expect((await disable()).status).toBe(403)
    expect(await linkRows()).toBe(0)
  })

  test('вход через Steam и демо — выпускают', async () => {
    const steamid = await signInAs(db, 'openid')
    expect((await issue()).status).toBe(200)
    expect(await getFeedLink(db, steamid)).toEqual({ createdAt: T0 })

    signOut()
    const demo = await signInAs(db, 'demo')
    expect((await issue()).status).toBe(200)
    expect(await getFeedLink(db, demo)).toEqual({ createdAt: T0 })
  })
})

describe('/api/whatsnew/feedlink: ключ', () => {
  test('ключ в ответе, в базе — только его отпечаток', async () => {
    const steamid = await signInAs(db, 'openid')
    const key = await keyOf(await issue())

    expect(await feedLinkOwner(db, feedTokenHash(key))).toBe(steamid)
    const cells = await db.execute('SELECT * FROM feed_links')
    expect(JSON.stringify(cells.rows)).not.toContain(key)
  })

  test('ответ с ключом не кэшируется нигде', async () => {
    await signInAs(db, 'openid')
    const res = await issue()
    const cc = res.headers.get('Cache-Control') ?? ''
    expect(cc).toContain('no-store')
    expect(cc).toContain('private')
  })

  test('перевыпуск: новый ключ, прежняя ссылка больше не открывает', async () => {
    const steamid = await signInAs(db, 'openid')
    const first = await keyOf(await issue())
    const second = await keyOf(await issue())

    expect(second).not.toBe(first)
    expect(await feedLinkOwner(db, feedTokenHash(first))).toBeNull()
    expect(await feedLinkOwner(db, feedTokenHash(second))).toBe(steamid)
    expect(await linkRows()).toBe(1)
  })

  test('отключение: ссылка гаснет, повтор — тоже 200', async () => {
    const steamid = await signInAs(db, 'openid')
    const key = await keyOf(await issue())

    const res = await disable()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(await feedLinkOwner(db, feedTokenHash(key))).toBeNull()
    expect(await getFeedLink(db, steamid)).toBeNull()
    expect((await disable()).status).toBe(200)
  })
})

describe('/api/whatsnew/feedlink: потолок частоты', () => {
  test('выпуск и отключение делят один потолок на человека; сверх — 429 с Retry-After', async () => {
    const steamid = await signInAs(db, 'openid')
    for (let i = 0; i < FEED_LINK_LIMIT - 1; i++) expect((await issue()).status).toBe(200)
    expect((await disable()).status).toBe(200)

    const over = await issue()
    expect(over.status).toBe(429)
    expect(Number(over.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect((await disable()).status).toBe(429)

    // Счётчик ключуется steamid — forgetUser находит его по ':' + steamid + ':'
    const keys = await db.execute("SELECT key FROM rate_limits WHERE key LIKE 'feedlink:%'")
    expect(keys.rows.map((r) => String(r.key)).every((k) => k.includes(`:${steamid}:`))).toBe(true)
  })
})
