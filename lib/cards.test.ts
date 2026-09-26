import { describe, expect, test } from 'vitest'
import type { CandidateSet } from './candidates'
import { aboutLine, cardView, dailyCardView, heroMediaView, pickContext, storeCardView } from './cards'
import { NEUTRAL_MOOD } from './mood'
import { topTags } from './recommend'
import { HERO_SLIDES } from './shots'
import type { GameMeta, LibraryGame } from './types'

/**
 * Карточка выдачи — один контракт на /play, «Игру дня» и колоду
 * исследователя. Здесь закреплено то, что раньше жило в двух копиях и
 * расходилось: покупочное (скидка, возврат) только у не купленного, теги —
 * одной мерой, часы — только у своего.
 */

const NOW = 1_780_000_000

function meta(appid: number, over: Partial<GameMeta> = {}): GameMeta {
  return {
    appid,
    name: `Игра ${appid}`,
    tags: { Roguelike: 900, Indie: 700, Strategy: 500, Puzzle: 300, Cozy: 100 },
    genres: [],
    categories: [2],
    priceFinal: 1999,
    priceInitial: 3999,
    discountPercent: 50,
    priceAt: NOW - 60,
    headerImage: `https://cdn.example/${appid}.jpg`,
    ...over,
  }
}

function set(metas: GameMeta[], games: LibraryGame[]): CandidateSet {
  const byId = new Map(metas.map((m) => [m.appid, m]))
  return {
    now: NOW,
    mood: NEUTRAL_MOOD,
    games,
    libMetas: byId,
    metaOf: (id) => byId.get(id),
    feedback: [],
    banned: new Set(),
    cooldown: new Map(),
    profile: {},
    tagWeight: null,
    seed: null,
    candidates: [],
    actual: [],
    own: [],
    discovery: [],
    heroPool: [],
  }
}

describe('topTags', () => {
  test('по голосам, четыре по умолчанию; без меты — пусто', () => {
    expect(topTags(meta(1))).toEqual(['Roguelike', 'Indie', 'Strategy', 'Puzzle'])
    expect(topTags(meta(1), 2)).toEqual(['Roguelike', 'Indie'])
    expect(topTags(undefined)).toEqual([])
  })
})

describe('cardView', () => {
  const ctx = pickContext(
    set([meta(10), meta(20)], [{ appid: 10, name: 'Игра 10', playtimeForever: 150, playtime2Weeks: 0 }]),
  )

  test('своя — часы есть, скидки и возврата нет: цена у неё в прошлом', () => {
    const card = cardView({ appid: 10, name: 'Игра 10', source: 'backlog', reason: 'потому что' }, ctx)
    expect(card).toMatchObject({ appid: 10, reason: 'потому что', hoursPlayed: 3, discount: null, refund: false })
    expect(card.tags).toEqual(topTags(meta(10)))
    expect(card.edge).toBeNull()
  })

  test('покупка — скидка посчитана, часов нет', () => {
    const card = cardView({ appid: 20, name: 'Игра 20', source: 'new', reason: '' }, ctx)
    expect(card.hoursPlayed).toBeNull()
    expect(card.discount?.percent).toBe(50)
    expect(card.priceFinal).toBe(1999)
  })

  test('без меты — пустые поля, а не падение', () => {
    const card = cardView({ appid: 30, name: 'Игра 30', source: 'new', reason: '' }, ctx)
    expect(card).toMatchObject({ headerImage: null, tags: [], signals: null, discount: null, refund: false })
  })
})

describe('storeCardView и dailyCardView', () => {
  test('плитка полки — всегда покупка: скидка есть', () => {
    const tile = storeCardView({ appid: 20, name: 'Игра 20' }, meta(20), NOW, false)
    expect(tile.discount?.percent).toBe(50)
    expect(Object.keys(tile)).not.toContain('refund')
  })

  test('герой дня из своего — без скидки; из каталога — со скидкой и теми же тегами', () => {
    const day = { reason: 'r', sharedTags: ['Puzzle'], hoursPlayed: null, hideUrgency: false }
    const own = dailyCardView({ appid: 10, name: 'Игра 10', source: 'untouched' }, meta(10), NOW, day)
    const bought = dailyCardView({ appid: 20, name: 'Игра 20', source: 'new' }, meta(20), NOW, day)
    expect(own.discount).toBeNull()
    expect(bought.discount?.percent).toBe(50)
    expect(bought.tags).toEqual(topTags(meta(20)))
    expect(bought.sharedTags).toEqual(['Puzzle'])
  })

  test('трейлер героя дня — из записи игры, без него явный null', () => {
    const day = { reason: 'r', sharedTags: [], hoursPlayed: null, hideUrgency: false }
    const trailer = { mp4: 'https://video.akamai.steamstatic.com/store_trailers/10/m.mp4' }
    const withClip = dailyCardView({ appid: 10, name: 'Игра 10', source: 'untouched' }, { ...meta(10), trailer }, NOW, day)
    const without = dailyCardView({ appid: 10, name: 'Игра 10', source: 'untouched' }, meta(10), NOW, day)
    expect(withClip.trailer).toEqual(trailer)
    expect(without.trailer).toBeNull()
  })

  test('ориентир героя дня — из записи, у старой записи явный null', () => {
    const day = { reason: 'r', sharedTags: [], hoursPlayed: null, hideUrgency: false }
    const via = { appid: 570, name: 'Dota 2', hours: 2400 }
    const lol = { appid: -106, name: 'League of Legends', source: 'new' as const }
    expect(dailyCardView(lol, undefined, NOW, { ...day, via }).via).toEqual(via)
    expect(dailyCardView(lol, undefined, NOW, day).via).toBeNull()
  })
})

describe('heroMediaView', () => {
  test('кадры обрезаны до HERO_SLIDES, без трейлера — явный null', () => {
    const shots = Array.from({ length: HERO_SLIDES + 3 }, (_, i) => `s${i}.jpg`)
    expect(heroMediaView({ screenshots: shots })).toEqual({
      screenshots: shots.slice(0, HERO_SLIDES),
      trailer: null,
    })
    expect(heroMediaView(undefined)).toEqual({ screenshots: [], trailer: null })
  })
})

describe('aboutLine', () => {
  const ru = 'Взберись на гору с друзьями и не сорвись.'
  const en = 'Climb a mountain with your friends.'
  test('только у игры из каталога и только по-русски', () => {
    expect(aboutLine('new', { ...meta(20), shortDescription: ru })).toBe(ru)
    expect(aboutLine('new', { ...meta(20), shortDescription: en })).toBeNull()
    expect(aboutLine('untouched', { ...meta(20), shortDescription: ru })).toBeNull()
    expect(aboutLine('new', undefined)).toBeNull()
    expect(aboutLine('new', { ...meta(20), shortDescription: '   ' })).toBeNull()
  })
})
