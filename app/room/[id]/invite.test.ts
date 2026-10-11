import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRoom, joinRoom, type Db } from '@/lib/db'
import { inviteCopy } from '@/lib/roominvite'
import { PEEK_LIMIT } from '@/lib/roompeek'
import { nowSec } from '@/lib/server'
import { freshDb, params } from '@/lib/testing/route'
import { GET as peekApi } from '../../api/room/[id]/route'
import { loadRoomInviteForPage } from './invite'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Заголовок страницы приглашения — та же проверка существования кода, что и
 * /api/room/[id], и платит тем же потолком room-peek по адресу.
 *
 * Без потолка перебор просто переехал с API на страницу: /room/<код> отвечал
 * 200 с <title> «Хост зовёт в пати КОД» на живую комнату и «Пати КОД» на
 * несуществующую — со скоростью сервера, а не сорок тысяч кодов в сутки, и
 * с ником хоста в придачу.
 */

const ROOM = 'ABC234'
const MISS = 'ZZZ999'

let db: Db

beforeEach(async () => {
  db = await freshDb()
  await createRoom(db, { id: ROOM, steamid: '76561190000000001' }, nowSec())
  await joinRoom(db, ROOM, '76561190000000001', 'Хост', nowSec())
})

const from = (ip: string) => new Headers({ 'x-forwarded-for': ip })

describe('приглашение в пати: потолок на заголовок', () => {
  test('в пределах потолка — приглашение, сверх — как о комнате, которой нет', async () => {
    const h = from('198.51.100.7')
    for (let i = 0; i < PEEK_LIMIT; i++) {
      // Половина — промахи: перебор платит и за них, иначе потолок считал
      // бы только найденные комнаты
      const invite = await loadRoomInviteForPage(i % 2 ? ROOM : MISS, h)
      expect(invite === null, String(i)).toBe(i % 2 === 0)
    }
    const refused = await loadRoomInviteForPage(ROOM, h)
    expect(refused).toBeNull()
    // Отказ неотличим от несуществующей комнаты — и это не 429: страница
    // настоящему гостю нужна и так
    expect(inviteCopy(ROOM, refused).title).toBe(`Пати ${ROOM}`)

    // соседний адрес — свой потолок
    expect(await loadRoomInviteForPage(ROOM, from('198.51.100.8'))).toMatchObject({ host: 'Хост', members: 1 })
  })

  test('страница и API комнаты — один потолок на адрес', async () => {
    const ip = '198.51.100.9'
    for (let i = 0; i < PEEK_LIMIT; i++) await loadRoomInviteForPage(MISS, from(ip))
    const res = await peekApi(
      new Request(`http://localhost/api/room/${ROOM}`, { headers: { 'x-forwarded-for': ip } }),
      params({ id: ROOM }),
    )
    expect(res.status).toBe(429)
  })
})
