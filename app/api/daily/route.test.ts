import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveLibrarySnapshot, upsertGamesMeta, type Db } from '@/lib/db'
import { freshDb, post, signIn, signOut } from '@/lib/testing/route'
import { POST as feedback } from '../feedback/route'
import type { GameMeta, LibraryGame } from '@/lib/types'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * /api/daily — записанный выбор дня, настоящим роутом на базе в памяти.
 *
 * Страница спрашивает сначала «только если уже выбрано» (?cached=1) и
 * прогревает каталог лишь при промахе. Здесь закреплено то, на чём это
 * держится: промах ничего не считает и не пишет, а попадание отдаёт ровно ту
 * игру, что выбрана утром, — даже если пул с тех пор изменился.
 */

const STEAMID = '76561197960287930'
/** 12:00 по Москве 23 сентября 2026 */
const NOON_MSK = Date.parse('2026-09-23T09:00:00Z')

const TAGS = ['Roguelike', 'Deckbuilding', 'Strategy', 'Puzzle', 'Cozy', 'Farming Sim']

function game(appid: number, hours: number): LibraryGame {
  return { appid, name: `Игра ${appid}`, playtimeForever: hours * 60, playtime2Weeks: 0 }
}

function meta(appid: number, tags: string[], priceAt: number): GameMeta {
  return {
    appid,
    name: `Игра ${appid}`,
    tags: Object.fromEntries(tags.map((t, i) => [t, 500 - i * 50])),
    genres: ['Indie'],
    categories: [2],
    // Цена свежая — роут не пойдёт за ней в Steam
    priceAt,
    priceFinal: 0,
    isFree: true,
  }
}

/** Библиотека: два наигранных «якоря» вкуса и несколько нетронутых игр. */
async function seedLibrary(db: Db, appids: number[], now: number) {
  const games = [game(1, 40), game(2, 25), ...appids.map((id) => game(id, 0))]
  await upsertGamesMeta(
    db,
    [
      meta(1, TAGS.slice(0, 3), now),
      meta(2, TAGS.slice(0, 3), now),
      ...appids.map((id, i) => meta(id, TAGS.slice(i % 3, (i % 3) + 3), now)),
    ],
    now,
  )
  await saveLibrarySnapshot(db, STEAMID, games, now)
}

const get = (query = '') => GET(new Request(`http://localhost/api/daily${query}`))

async function countRows(db: Db, table: string): Promise<number> {
  const res = await db.execute(`SELECT COUNT(*) AS n FROM ${table}`)
  return Number(res.rows[0].n)
}

let db: Db

beforeEach(async () => {
  // Подменяются только часы: таймеры настоящие, иначе ожидание цены
  // (refreshDealsWithin) не дождалось бы своего срока
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOON_MSK)
  // Сеть закрыта: всё, что роуту нужно, лежит в базе
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('сеть в тесте закрыта'))))
  db = await freshDb()
  await signIn(db, STEAMID, { verified: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('/api/daily: записанный выбор дня', () => {
  test('без сессии — 401 nosession и для запроса «только записанное»', async () => {
    signOut()
    const res = await get('?cached=1')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'nosession' })
  })

  test('промах — 204: без отбора, без записи и без лимита частоты', async () => {
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(NOON_MSK / 1000))
    const res = await get('?cached=1')
    expect(res.status).toBe(204)
    expect(await countRows(db, 'daily_picks')).toBe(0)
    expect(await countRows(db, 'rate_limits')).toBe(0)
    // а обычный запрос следом — и считает, и пишет, и отмечается в лимите
    expect((await get()).status).toBe(200)
    expect(await countRows(db, 'daily_picks')).toBe(1)
    expect(await countRows(db, 'rate_limits')).toBe(1)
  })

  test('промах без библиотеки — тоже 204: про библиотеку скажет обычный запрос', async () => {
    const res = await get('?cached=1')
    expect(res.status).toBe(204)
    const full = await get()
    expect(full.status).toBe(409)
    expect(await full.json()).toEqual({ error: 'nolibrary' })
  })

  test('второй заход в тот же день — та же игра, даже когда пул изменился', async () => {
    const now = Math.floor(NOON_MSK / 1000)
    await seedLibrary(db, [10, 11, 12, 13], now)

    const first = await get()
    expect(first.status).toBe(200)
    const morning = ((await first.json()) as { pick: { appid: number; source: string } }).pick
    const chosen = morning.appid
    expect(await countRows(db, 'daily_picks')).toBe(1)

    // Утренний выбор ушёл из библиотеки, остались совсем другие игры: отбор
    // заново выбрал бы из них — запись обязана его не звать
    const others = [20, 21, 22, 23].filter((id) => id !== chosen)
    await seedLibrary(db, others, now + 60)
    vi.setSystemTime(NOON_MSK + 3 * 3600_000)

    const cached = await get('?cached=1')
    expect(cached.status).toBe(200)
    const body = (await cached.json()) as {
      pick: { appid: number; source: string }
      dateLabel: string
    }
    // и та же игра, и та же роль: пересчёт мог бы вернуть её разве что
    // находкой из каталога, а не своей
    expect(body.pick).toMatchObject(morning)
    expect(body.dateLabel).toBe('23 сентября')

    const again = await get()
    expect(((await again.json()) as { pick: { appid: number } }).pick.appid).toBe(chosen)
  })

  test('в полночь по Москве запись вчерашняя — снова промах', async () => {
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(NOON_MSK / 1000))
    vi.setSystemTime(Date.parse('2026-09-23T20:59:00Z'))
    expect((await get()).status).toBe(200)
    expect((await get('?cached=1')).status).toBe(200)

    // 00:00 24-го по Москве, в UTC ещё 23-е
    vi.setSystemTime(Date.parse('2026-09-23T21:00:00Z'))
    expect((await get('?cached=1')).status).toBe(204)
    const next = await get()
    expect(((await next.json()) as { dateLabel: string }).dateLabel).toBe('24 сентября')
  })
})

/**
 * «Не сегодня» на /daily: отзыв сбрасывает запись дня, если он про героя, и
 * следующий отбор эту игру до полуночи не вернёт. «Не сейчас» про любую
 * другую игру выбор дня не трогает — ради этого запись и заведена.
 */
describe('/api/daily: «Не сегодня»', () => {
  const pickOf = async (query = '') =>
    ((await (await get(query)).json()) as { pick: { appid: number } }).pick.appid
  const notNow = (appid: number, source = 'daily') =>
    feedback(post('/api/feedback', { appid, action: 'skipped', reason: 'notnow', ctx: { source } }))

  test('про героя дня — другая игра сразу, и она же при следующем заходе', async () => {
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(NOON_MSK / 1000))
    const first = await pickOf()
    expect((await notNow(first)).status).toBe(200)
    expect(await countRows(db, 'daily_picks')).toBe(0)

    const second = await pickOf()
    expect(second).not.toBe(first)
    expect(await pickOf('?cached=1')).toBe(second)

    // и третий раз — ни одна из двух отложенных сегодня
    await notNow(second)
    expect([first, second]).not.toContain(await pickOf())
  })

  test('про другую игру — запись дня на месте', async () => {
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(NOON_MSK / 1000))
    const first = await pickOf()
    const other = [10, 11, 12, 13].find((id) => id !== first)!
    await notNow(other, 'play')
    expect(await countRows(db, 'daily_picks')).toBe(1)
    expect(await pickOf('?cached=1')).toBe(first)
  })
})
