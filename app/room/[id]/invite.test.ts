import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRoom, joinRoom, setRoomMatched, upsertGameMeta, type Db } from '@/lib/db'
import { inviteCopy } from '@/lib/roominvite'
import { PEEK_LIMIT } from '@/lib/roompeek'
import { nowSec } from '@/lib/server'
import { freshDb, params } from '@/lib/testing/route'
import { GET as peekApi } from '../../api/room/[id]/route'
import { loadRoomInvite, loadRoomInviteForPage } from './invite'

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

/**
 * Что приглашение знает о вечере: настроение (пресет хоста) и игру, в которую
 * звали. Обе вещи и так видит любой вошедший — в шапке комнаты и первой
 * картой, — так что превью не выдаёт ничего сверх того, что откроет ссылка.
 */
describe('приглашение в пати: настроение и игра, в которую звали', () => {
  const HOST = '76561190000000002'

  async function room(id: string, extra: Partial<Parameters<typeof createRoom>[1]>) {
    await createRoom(db, { id, steamid: HOST, ...extra }, nowSec())
    await joinRoom(db, id, HOST, 'Аня', nowSec())
  }

  test('пресет — названием, а не осями; своё настроение без пресета — null', async () => {
    await room('MOOD22', { mood: { time: 'short', vibe: 'engaged', social: 'friends' } })
    expect(await loadRoomInvite('MOOD22')).toMatchObject({ preset: 'Пара быстрых каток', seedName: null })
    // «коротко и спокойно» пресета не имеет — называть его чужим именем нельзя
    await room('MOOD23', { mood: { time: 'short', vibe: 'chill', social: 'friends' } })
    expect(await loadRoomInvite('MOOD23')).toMatchObject({ preset: null })
    // комната старше выбора настроения
    expect(await loadRoomInvite(ROOM)).toMatchObject({ preset: null, seedName: null })
  })

  test('игра, в которую звали, — имя и арт для карточки', async () => {
    const drg = { appid: 548430, name: 'Deep Rock Galactic', tags: { 'Co-op': 100 }, genres: [], categories: [1, 9] }
    await upsertGameMeta(db, drg, nowSec())
    await room('SEED22', { seedAppid: 548430 })
    const invite = await loadRoomInvite('SEED22')
    expect(invite).toMatchObject({ seedName: 'Deep Rock Galactic', seedArt: { appid: 548430 } })
    expect(inviteCopy('SEED22', invite).title).toBe('Аня зовёт в «Deep Rock Galactic» · пати SEED22')

    // после матча говорит игра матча, а предложенная молчит
    await upsertGameMeta(db, { ...drg, appid: 570, name: 'Dota 2' }, nowSec())
    await setRoomMatched(db, 'SEED22', 570)
    expect(inviteCopy('SEED22', await loadRoomInvite('SEED22')).title).toBe('Пати SEED22 сошлась на «Dota 2»')
  })

  test('игры уже нет в каталоге — приглашение без неё, а не с пустыми кавычками', async () => {
    await room('SEED23', { seedAppid: 999999 })
    const invite = await loadRoomInvite('SEED23')
    expect(invite).toMatchObject({ seedName: null })
    expect(inviteCopy('SEED23', invite).title).toBe('Аня зовёт в пати SEED23')
  })
})
