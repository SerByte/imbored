import { beforeEach, describe, expect, test, vi } from 'vitest'
import { logFeedback, upsertGameMeta, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, signInAs } from '@/lib/testing/route'
import type { GameMeta } from '@/lib/types'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Строка «Первой картой — …» на /room/new спрашивает здесь, какую игру
 * комната возьмёт первой картой. Ответ обязан совпадать с тем, что сделает
 * создание комнаты (/api/room/create): та же проверка, roomSeed.
 */

const DRG: GameMeta = { appid: 548430, name: 'Deep Rock Galactic', tags: { 'Co-op': 100 }, genres: [], categories: [1, 9] }
const SOLO: GameMeta = { appid: 620, name: 'Portal', tags: { Puzzle: 100 }, genres: [], categories: [2] }

let db: Db

beforeEach(async () => {
  db = await freshDb()
  for (const g of [DRG, SOLO]) await upsertGameMeta(db, g, nowSec())
})

const ask = (game: string) => GET(new Request(`http://localhost/api/room/seed?game=${game}`))

describe('/api/room/seed', () => {
  test('сетевая игра из каталога — её имя, и гостю тоже', async () => {
    const res = await ask('548430')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ appid: 548430, name: 'Deep Rock Galactic' })
    // ответ зависит от сессии (свои баны) — общий кэш его хранить не должен
    expect(res.headers.get('Cache-Control')).toMatch(/private/)
  })

  test('одиночная, неизвестная и мусор — 404 noseed', async () => {
    for (const game of ['620', '999999', '-548430', 'abc', '']) {
      const res = await ask(game)
      expect(res.status, game).toBe(404)
      expect(await res.json(), game).toEqual({ error: 'noseed' })
    }
  })

  test('сетевая с одиночной кампанией и пустыми серверами — 404: колода пати её снимет', async () => {
    // Каталог такую не хоронит (его alive — соло-вердикт), а строка «Первой
    // картой — …» обещала бы карту, которую filterActual уберёт (lib/roomseed)
    await upsertGameMeta(db, { appid: 80, name: 'Condition Zero', tags: { FPS: 100 }, genres: [], categories: [2, 1], ccu: 100 }, nowSec())
    expect((await ask('80')).status).toBe(404)
  })

  test('скрытая смотрящим — 404: создание комнаты её тоже не возьмёт', async () => {
    const me = await signInAs(db, 'openid')
    await logFeedback(db, { steamid: me, appid: 548430, action: 'banned' }, nowSec())
    expect((await ask('548430')).status).toBe(404)
  })
})
