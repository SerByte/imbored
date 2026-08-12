import { describe, expect, test } from 'vitest'
import { buildGroupDeck } from './group'
import type { GameMeta, LibraryGame } from './types'

const MP = [1, 9, 38]
const SP = [2]

function lib(appid: number, hours = 10): LibraryGame {
  return { appid, name: `g${appid}`, playtimeForever: hours * 60, playtime2Weeks: 0 }
}

function meta(
  appid: number,
  tags: Record<string, number>,
  categories: number[] = MP,
  priceFinal?: number,
): GameMeta {
  return {
    appid,
    name: `g${appid}`,
    tags,
    genres: [],
    categories,
    ...(priceFinal !== undefined ? { priceFinal } : {}),
  }
}

const METAS = new Map<number, GameMeta>([
  [1, meta(1, { 'Co-op': 100, FPS: 80 })], // общая MP
  [2, meta(2, { 'Story Rich': 100 }, SP)], // общая, но одиночная
  [3, meta(3, { 'Co-op': 100, Mining: 50 })], // только у Ани
  [4, meta(4, { 'Co-op': 90, Party: 70 }, MP, 1999)], // ни у кого (из пула)
  [5, meta(5, { MOBA: 100, Competitive: 90 })], // общая MP, дальше от профиля
])

const metaOf = (id: number) => METAS.get(id)

const MEMBERS = [
  { steamid: 'a', name: 'Аня', library: [lib(1, 50), lib(2), lib(3, 100), lib(5, 5)] },
  { steamid: 'b', name: 'Боря', library: [lib(1, 20), lib(2), lib(5, 5)] },
]

describe('buildGroupDeck', () => {
  test('общая мультиплеерная игра — ownedByAll, без missingFor', () => {
    const deck = buildGroupDeck({ members: MEMBERS, metaOf, extraPool: [], limit: 10 })
    const card = deck.find((c) => c.appid === 1)
    expect(card).toBeDefined()
    expect(card!.ownedByAll).toBe(true)
    expect(card!.missingFor).toEqual([])
  })

  test('общая одиночная игра в колоду не попадает', () => {
    const deck = buildGroupDeck({ members: MEMBERS, metaOf, extraPool: [], limit: 10 })
    expect(deck.find((c) => c.appid === 2)).toBeUndefined()
  })

  test('игра не у всех — missingFor с именами тех, у кого её нет', () => {
    const deck = buildGroupDeck({
      members: MEMBERS,
      metaOf,
      extraPool: [METAS.get(3)!, METAS.get(4)!],
      limit: 10,
    })
    const onlyAnya = deck.find((c) => c.appid === 3)
    expect(onlyAnya!.missingFor).toEqual(['Боря'])
    const nobody = deck.find((c) => c.appid === 4)
    expect(nobody!.missingFor.sort()).toEqual(['Аня', 'Боря'])
    expect(nobody!.priceFinal).toBe(1999)
  })

  test('общие игры идут раньше недостающих, внутри — по близости к вкусу пати', () => {
    const deck = buildGroupDeck({
      members: MEMBERS,
      metaOf,
      extraPool: [METAS.get(4)!],
      limit: 10,
    })
    const ownedAll = deck.filter((c) => c.ownedByAll)
    const notAll = deck.filter((c) => !c.ownedByAll)
    expect(ownedAll.length).toBeGreaterThan(0)
    expect(notAll.length).toBeGreaterThan(0)
    // все ownedByAll раньше остальных
    expect(deck.indexOf(notAll[0])).toBeGreaterThan(deck.indexOf(ownedAll[ownedAll.length - 1]))
    // co-op игра (1) ближе к профилю пати (в нём много Co-op от 100ч в игре 3), чем MOBA (5)
    expect(deck.indexOf(deck.find((c) => c.appid === 1)!)).toBeLessThan(
      deck.indexOf(deck.find((c) => c.appid === 5)!),
    )
  })

  test('limit ограничивает размер колоды', () => {
    const deck = buildGroupDeck({
      members: MEMBERS,
      metaOf,
      extraPool: [METAS.get(3)!, METAS.get(4)!],
      limit: 2,
    })
    expect(deck).toHaveLength(2)
  })
})
