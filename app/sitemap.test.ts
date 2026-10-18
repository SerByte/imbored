import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { replaceGameTags, upsertGameMeta, type Db } from '@/lib/db'
import { freshDb } from '@/lib/testing/route'
import sitemap from './sitemap'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

const T0 = 1_760_000_000
let db: Db

beforeEach(async () => {
  db = await freshDb()
  await upsertGameMeta(
    db,
    { appid: 730, name: 'Counter-Strike 2', tags: { FPS: 1000 }, genres: [], categories: [1], reviewsTotal: 9000 },
    T0,
  )
  await replaceGameTags(db, 730, [{ tag: 'FPS', weight: 1000 }])
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/** База отвечает, но запрос падает — так выглядит таймаут Turso посреди перегенерации */
function queriesFail(): void {
  const timeout = () => Promise.reject(new Error('Turso: operation timed out'))
  db.execute = timeout as Db['execute']
  db.batch = timeout as Db['batch']
}

const urls = async () => (await sitemap()).map((e) => new URL(e.url).pathname)

describe('карта сайта и осечка базы', () => {
  test('живая база — в карте и статические адреса, и карточки игр', async () => {
    const got = await urls()
    expect(got).toContain('/')
    expect(got).toContain('/game/730')
  })

  test('каждый адрес — на обоих языках, и у каждого — все версии и x-default', async () => {
    const entries = await sitemap()
    const paths = entries.map((e) => new URL(e.url).pathname)
    for (const p of ['/', '/quiz', '/games', '/whatsnew', '/privacy', '/support', '/game/730']) {
      expect(paths, p).toContain(p)
      expect(paths, p).toContain(p === '/' ? '/en' : `/en${p}`)
    }
    expect(paths.filter((p) => p.startsWith('/en')).length * 2).toBe(paths.length)
    const game = entries.filter((e) => /\/game\/730$/.test(new URL(e.url).pathname))
    expect(game).toHaveLength(2)
    for (const e of game) {
      expect(e.alternates?.languages).toEqual({
        ru: 'http://localhost:3000/game/730',
        en: 'http://localhost:3000/en/game/730',
        'x-default': 'http://localhost:3000/game/730',
      })
    }
    const home = entries.find((e) => new URL(e.url).pathname === '/en')
    expect(home?.alternates?.languages).toMatchObject({ ru: 'http://localhost:3000/', en: 'http://localhost:3000/en' })
  })

  test('квиз — в карте (он в выдаче), заглушки /daily и /rooms — нет (noindex)', async () => {
    const got = await urls()
    expect(got).toContain('/quiz')
    expect(got).not.toContain('/daily')
    expect(got).not.toContain('/rooms')
  })

  /*
   * Карта живёт на ISR сутки. Пойманная ошибка закэшировала бы карту из
   * тридцати статических адресов вместо шести тысяч — на сутки, и её
   * забрали бы Googlebot, Bing и Яндекс. Брошенная оставляет в кэше прошлую
   * полную карту (docs: incremental-static-regeneration, «Handling uncaught
   * exceptions»), и Next повторит перегенерацию следующим запросом.
   */
  test('при перегенерации ошибка уходит наружу — ISR оставит прошлую полную карту', async () => {
    queriesFail()
    await expect(sitemap()).rejects.toThrow(/timed out/)
  })

  test('на сборке без базы — статические адреса, а не упавший build', async () => {
    vi.stubEnv('NEXT_PHASE', PHASE_PRODUCTION_BUILD)
    queriesFail()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const got = await urls()
    errors.mockRestore()
    expect(got).toContain('/')
    expect(got).toContain('/games')
    expect(got).not.toContain('/game/730')
  })

  test('на сборке getDb() бросает сам (нет TURSO_DATABASE_URL) — и это не роняет build', async () => {
    vi.stubEnv('NEXT_PHASE', PHASE_PRODUCTION_BUILD)
    // Слот, в котором getDb() держит промис соединения (lib/server)
    const slot = globalThis as typeof globalThis & { __imboredDb?: Promise<Db> }
    const down = Promise.reject(new Error('TURSO_DATABASE_URL не задан'))
    down.catch(() => {})
    slot.__imboredDb = down
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const got = await urls()
    errors.mockRestore()
    expect(got).toContain('/whatsnew')
    expect(got).not.toContain('/game/730')
  })
})
