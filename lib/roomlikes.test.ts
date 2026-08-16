import { describe, expect, test } from 'vitest'
import { buildLikes, LIKES_MINE_MAX, type MemberRef } from './roomlikes'
import type { RoomVote } from './db'

const MEMBERS: MemberRef[] = [
  { steamid: 'me', name: 'Ты' },
  { steamid: 'dima', name: 'Дима' },
  { steamid: 'sasha', name: 'Саша' },
]

function vote(steamid: string, appid: number, v: 0 | 1, at = 0): RoomVote {
  return { steamid, appid, vote: v, createdAt: at }
}

describe('buildLikes: свои лайки', () => {
  test('отдаёт только мои «играем», свежие первыми', () => {
    const votes = [
      vote('me', 570, 1, 10),
      vote('me', 620, 0, 20), // «не хочу» — не лайк
      vote('me', 730, 1, 30),
      vote('dima', 999, 1, 40), // чужой лайк
    ]
    const { mineAppids } = buildLikes({ votes, members: MEMBERS, me: 'me' })
    expect(mineAppids).toEqual([730, 570])
  })

  test('ограничивает список', () => {
    const votes = Array.from({ length: LIKES_MINE_MAX + 5 }, (_, i) => vote('me', i + 1, 1, i))
    const { mineAppids } = buildLikes({ votes, members: MEMBERS, me: 'me' })
    expect(mineAppids).toHaveLength(LIKES_MINE_MAX)
  })
})

describe('buildLikes: почти совпали', () => {
  test('двое за, третий ещё не голосовал — это почти совпадение', () => {
    const votes = [vote('me', 570, 1), vote('dima', 570, 1)]
    const { near } = buildLikes({ votes, members: MEMBERS, me: 'me' })
    expect(near).toHaveLength(1)
    expect(near[0].forNames).toEqual(['Ты', 'Дима'])
    expect(near[0].pendingNames).toEqual(['Саша'])
    expect(near[0].meFor).toBe(true)
    expect(near[0].games).toBe(1)
  })

  test('один голос «против» убивает почти-совпадение', () => {
    // Иначе «вы почти совпали» — это ровно то же враньё про мёртвую карту,
    // от которого мы уходим, только переехавшее в новую секцию
    const votes = [vote('me', 570, 1), vote('dima', 570, 1), vote('sasha', 570, 0)]
    const { near } = buildLikes({ votes, members: MEMBERS, me: 'me' })
    expect(near).toEqual([])
  })

  test('все за — это уже матч, а не почти', () => {
    const votes = [vote('me', 570, 1), vote('dima', 570, 1), vote('sasha', 570, 1)]
    expect(buildLikes({ votes, members: MEMBERS, me: 'me' }).near).toEqual([])
  })

  test('один за — ещё не «вы»', () => {
    const votes = [vote('me', 570, 1)]
    expect(buildLikes({ votes, members: MEMBERS, me: 'me' }).near).toEqual([])
  })

  test('одинаковый расклад по разным играм схлопывается в один пункт', () => {
    const votes = [
      vote('me', 570, 1),
      vote('dima', 570, 1),
      vote('me', 730, 1),
      vote('dima', 730, 1),
    ]
    const { near } = buildLikes({ votes, members: MEMBERS, me: 'me' })
    expect(near).toHaveLength(1)
    expect(near[0].games).toBe(2)
  })

  test('«ждём тебя» — самый сильный случай: двое сошлись без меня', () => {
    const votes = [vote('dima', 570, 1), vote('sasha', 570, 1)]
    const { near } = buildLikes({ votes, members: MEMBERS, me: 'me' })
    expect(near[0].mePending).toBe(true)
    expect(near[0].meFor).toBe(false)
    expect(near[0].pendingNames).toEqual(['Ты'])
  })

  test('НИ НАЗВАНИЯ, НИ appid в почти-совпадении', () => {
    // Матч — самая большая эмоция продукта, и подпись «вы с Димой оба за
    // Deep Rock Galactic» сообщает финал заранее всем, кто уже «за». Плюс на
    // доске «Пати» в открытую комнату подсаживаются незнакомые, и «двое за X»
    // при двух участниках — точное раскрытие чужого голоса.
    //
    // Поля appid здесь нет вовсе — не потому что клиенту не нужно, а чтобы его
    // нельзя было случайно вывести на экран.
    const votes = [vote('me', 570, 1), vote('dima', 570, 1)]
    const { near } = buildLikes({ votes, members: MEMBERS, me: 'me' })
    expect(Object.keys(near[0])).not.toContain('appid')
    expect(JSON.stringify(near)).not.toContain('570')
  })

  test('сортировка: сначала где больше согласных, потом где больше игр', () => {
    const four: MemberRef[] = [...MEMBERS, { steamid: 'kat', name: 'Катя' }]
    const votes = [
      // 2 за, 1 игра
      vote('me', 100, 1),
      vote('dima', 100, 1),
      // 3 за, 1 игра — должно быть первым
      vote('me', 200, 1),
      vote('dima', 200, 1),
      vote('sasha', 200, 1),
    ]
    const { near } = buildLikes({ votes, members: four, me: 'me' })
    expect(near[0].forNames).toHaveLength(3)
    expect(near[1].forNames).toHaveLength(2)
  })

  test('в комнате на одного почти-совпадений не бывает', () => {
    const solo: MemberRef[] = [{ steamid: 'me', name: 'Ты' }]
    const votes = [vote('me', 570, 1)]
    expect(buildLikes({ votes, members: solo, me: 'me' }).near).toEqual([])
  })
})
