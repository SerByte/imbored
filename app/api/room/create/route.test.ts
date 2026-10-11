import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getRoom, logFeedback, roomMembers, upsertGameMeta, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, post, signInAs } from '@/lib/testing/route'
import type { GameMeta } from '@/lib/types'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Комната создаётся от имени профиля: хост управляет ею и виден на доске под
 * своим ником. По вставленной ссылке на чужой профиль — нельзя.
 */

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

describe('/api/room/create', () => {
  test('без сессии — 401 nosession', async () => {
    const res = await POST(post('/api/room/create'))
    expect(res.status).toBe(401)
  })

  test('сессия по ссылке — 403 needsteam, и комнаты нет', async () => {
    await signInAs(db, 'claimed')
    const res = await POST(post('/api/room/create'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'needsteam' })
    const rows = await db.execute('SELECT COUNT(*) AS n FROM rooms')
    expect(Number(rows.rows[0]?.n)).toBe(0)
  })

  test('вход через Steam и демо создают комнату и сразу в ней сидят', async () => {
    for (const kind of ['openid', 'demo'] as const) {
      const steamid = await signInAs(db, kind)
      const res = await POST(post('/api/room/create'))
      expect(res.status, kind).toBe(200)
      const { roomId } = (await res.json()) as { roomId: string }
      expect((await getRoom(db, roomId))?.createdBy, kind).toBe(steamid)
      expect((await roomMembers(db, roomId)).map((m) => m.steamid), kind).toEqual([steamid])
      // Членство хоста помнит пишущий вход: ссылка на его профиль за хоста
      // в комнате не действует (lib/roomseat)
      expect((await roomMembers(db, roomId))[0]?.writer, kind).toBe(true)
    }
  })
})

/**
 * «Позвать в эту игру»: тело запроса несёт appid первой карты. Он приходит из
 * адреса, то есть откуда угодно, и комната берёт его, только если игра есть в
 * каталоге, в неё играют вместе и создатель её не скрывал. Иначе — комната
 * как обычно, без игры и без отказа: человек хотел пати, и он её получает.
 */
describe('/api/room/create: игра, в которую зовут', () => {
  const game = (appid: number, name: string, categories: number[], extra: Partial<GameMeta> = {}): GameMeta => ({
    appid,
    name,
    tags: { 'Co-op': 100 },
    genres: [],
    categories,
    ...extra,
  })
  const DRG = game(548430, 'Deep Rock Galactic', [1, 9])
  const SOLO = game(620, 'Portal', [2])
  const DEAD = game(10, 'Мёртвый сетевой', [1])
  const OLD = game(80, 'Counter-Strike: Condition Zero', [1])

  async function create(body: unknown) {
    const res = await POST(post('/api/room/create', body))
    expect(res.status).toBe(200)
    const { roomId } = (await res.json()) as { roomId: string }
    return getRoom(db, roomId)
  }

  beforeEach(async () => {
    for (const g of [DRG, SOLO, DEAD, OLD]) await upsertGameMeta(db, g, nowSec())
    // Вердикт офлайн-курации так и пишется — отдельным UPDATE с signals_at
    // (promote-catalog); без signals_at rowToMeta его не читает
    await db.execute('UPDATE games SET alive = 0, signals_at = 1 WHERE appid = 10')
    await db.execute('UPDATE games SET superseded_by = 730, signals_at = 1 WHERE appid = 80')
  })

  test('сетевая игра из каталога — первая карта комнаты; с настроением вместе', async () => {
    await signInAs(db, 'openid')
    const mood = { time: 'short', vibe: 'engaged', social: 'friends' }
    const room = await create({ mood, game: 548430 })
    expect(room?.seedAppid).toBe(548430)
    expect(room?.mood).toEqual(mood)
    // строкой из адреса — тоже
    expect((await create({ game: '548430' }))?.seedAppid).toBe(548430)
  })

  test('одиночная, неизвестная и мусор — комната без игры, а не отказ', async () => {
    await signInAs(db, 'openid')
    for (const g of [620, 999999, -548430, 0, 548430.5, '548430abc', { appid: 548430 }, null]) {
      const room = await create({ game: g })
      expect(room, JSON.stringify(g)).not.toBeNull()
      expect(room?.seedAppid, JSON.stringify(g)).toBeUndefined()
    }
  })

  test('мёртвая и вытесненная преемником — не первая карта', async () => {
    // Колода их всё равно отсеет (filterActual), а приглашение звало бы в
    // игру, которой у друзей в колоде не окажется
    await signInAs(db, 'openid')
    expect((await create({ game: 10 }))?.seedAppid).toBeUndefined()
    expect((await create({ game: 80 }))?.seedAppid).toBeUndefined()
  })

  test('скрытая создателем («Больше не показывать») — не первая карта', async () => {
    const me = await signInAs(db, 'openid')
    await logFeedback(db, { steamid: me, appid: 548430, action: 'banned' }, nowSec())
    expect((await create({ game: 548430 }))?.seedAppid).toBeUndefined()
  })
})
