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

  test('скрытая демо-личностью — тоже 404: демо пишет, и комнату создаст с её банами', async () => {
    const me = await signInAs(db, 'demo')
    await logFeedback(db, { steamid: me, appid: 548430, action: 'banned' }, nowSec())
    expect((await ask('548430')).status).toBe(404)
  })

  test('сессия по вставленной ссылке видит ответ гостя: чужие скрытые игры по одной не перебрать', async () => {
    // Ссылку на чужой профиль вставляет кто угодно. Читай здесь баны и такой
    // сессии — сравнение с ответом гостя по каждой игре каталога выдало бы,
    // что владелец профиля скрыл, а это /library ссылке уже не показывает
    const someone = await signInAs(db, 'claimed')
    await logFeedback(db, { steamid: someone, appid: 548430, action: 'banned' }, nowSec())
    const res = await ask('548430')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ appid: 548430, name: 'Deep Rock Galactic' })
  })
})
