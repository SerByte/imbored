import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRoom, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, params, post, signInAs } from '@/lib/testing/route'
import { POST as join } from '../join/route'
import { POST as vote } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Обратная сторона requireWriter: вход в комнату и голос ОСТАЮТСЯ открыты
 * сессии по ссылке. Голос живёт внутри комнаты и профиль не трогает, а друг,
 * которого позвали в пати, чаще всего подключается именно ссылкой — закрыть
 * ему свайп значило бы сломать пати целиком.
 */

const ROOM = 'ABC234'

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

describe('комната для сессии по ссылке', () => {
  test('входит и голосует', async () => {
    await createRoom(db, { id: ROOM, steamid: '76561197960287999' }, nowSec())
    await signInAs(db, 'claimed')

    const joined = await join(post(`/api/room/${ROOM}/join`), params({ id: ROOM }))
    expect(joined.status).toBe(200)

    const voted = await vote(post(`/api/room/${ROOM}/vote`, { appid: 620, vote: true }), params({ id: ROOM }))
    expect(voted.status).toBe(200)
  })
})
