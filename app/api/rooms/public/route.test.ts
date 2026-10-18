import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRoom, joinRoom, setRoomPublic, type Db } from '@/lib/db'
import { presetLabel, ROOM_PRESETS } from '@/lib/presets'
import { nowSec } from '@/lib/server'
import { freshDb } from '@/lib/testing/route'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Доска «ищут игроков» говорит, на какой вечер зовут: незнакомцу с доски
 * «⚡ Пара быстрых каток» отвечает на вопрос «подсесть ли мне сюда» раньше,
 * чем он вошёл. Наружу — название и эмодзи пресета, а не оси настроения:
 * склеивать из short/engaged подпись странице незачем.
 */

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

type Listing = { id: string; memberNames: string[]; minutesAgo: number; preset: { label: string; emoji: string } | null }

async function board(lang?: 'en'): Promise<Listing[]> {
  // Язык — в адресе (withLang у /rooms): ответ кэширует край, ключ — сам адрес
  const res = await GET(new Request(`http://localhost/api/rooms/public${lang ? `?lang=${lang}` : ''}`))
  expect(res.status).toBe(200)
  return ((await res.json()) as { rooms: Listing[] }).rooms
}

async function open(id: string, mood?: Parameters<typeof createRoom>[1]['mood'], at = nowSec()) {
  await createRoom(db, { id, steamid: '76561190000000001', ...(mood ? { mood } : {}) }, at)
  await joinRoom(db, id, '76561190000000001', 'Аня', at)
  await setRoomPublic(db, id, true)
}

describe('/api/rooms/public', () => {
  test('каждый пресет — названием и эмодзи', async () => {
    const now = nowSec()
    for (const [i, p] of ROOM_PRESETS.entries()) await open(`PRE00${i}`, p.mood, now - i)
    const rooms = await board()
    expect(rooms.map((r) => r.preset)).toEqual(ROOM_PRESETS.map((p) => ({ label: p.label, emoji: p.emoji })))
  })

  test('без настроения и со своим, без пресета, — null, а не чужое имя', async () => {
    const now = nowSec()
    await open('PLAIN1', undefined, now)
    await open('CUSTOM', { time: 'short', vibe: 'chill', social: 'friends' }, now - 1)
    expect((await board()).map((r) => [r.id, r.preset])).toEqual([
      ['PLAIN1', null],
      ['CUSTOM', null],
    ])
  })

  test('остальное в строке доски — как было', async () => {
    await open('PLAIN2')
    expect(await board()).toEqual([{ id: 'PLAIN2', memberNames: ['Аня'], minutesAgo: 0, preset: null }])
  })

  /*
   * Английская доска: название вечера — английской подписью пресета, ник
   * живого человека — как записан, без ника — «Player …», а не «Игрок …».
   * Эмодзи — те же.
   */
  test('по-английски — английские названия вечеров и метки', async () => {
    const now = nowSec()
    for (const [i, p] of ROOM_PRESETS.entries()) await open(`ENG00${i}`, p.mood, now - i)
    await createRoom(db, { id: 'NONAME', steamid: '76561190000000002' }, now - 9)
    await joinRoom(db, 'NONAME', '76561190000000002', undefined, now - 9)
    await setRoomPublic(db, 'NONAME', true)
    const rooms = await board('en')
    expect(rooms.slice(0, ROOM_PRESETS.length).map((r) => r.preset)).toEqual(
      ROOM_PRESETS.map((p) => ({ label: presetLabel(p, 'en'), emoji: p.emoji })),
    )
    expect(rooms[0].memberNames).toEqual(['Аня'])
    const noName = rooms.find((r) => r.id === 'NONAME')
    expect(noName?.memberNames).toHaveLength(1)
    expect(noName?.memberNames[0]).toMatch(/^Player \w{1,4}$/)
    expect(rooms.flatMap((r) => [r.preset?.label ?? '', ...r.memberNames.filter((n) => n !== 'Аня')]).join(' ')).not.toMatch(
      /[А-Яа-яЁё]/,
    )
  })
})
