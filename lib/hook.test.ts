import { describe, expect, test } from 'vitest'
import { distinctiveTags, GENERIC_TAGS } from './hook'
import { tagWeightFrom, type TagWeight } from './tagweight'

/*
 * Карта тегов как у каталога: сколько игр несёт тег. Самый частый —
 * Singleplayer у половины витрины, отсюда и редкости.
 */
const STATS = new Map<string, number>([
  ['Singleplayer', 3000],
  ['Indie', 1750],
  ['Action', 2400],
  ['Great Soundtrack', 570],
  ['Puzzle', 730],
  ['Story Rich', 1240],
  ['Exploration', 1400],
  ['Metroidvania', 120],
  ['Souls-like', 125],
  ['Platformer', 400],
  ['Difficult', 450],
  ['Roguelike', 350],
  ['Roguelite', 340],
  ['Action Roguelike', 240],
  ['Mythology', 60],
  ['Hack and Slash', 300],
  ['Farming Sim', 94],
  ['Nudity', 170],
  ['Cooking', 45],
])
const weight = tagWeightFrom(STATS)!

const HOLLOW = {
  tags: {
    Metroidvania: 934,
    Platformer: 700,
    'Souls-like': 694,
    Difficult: 687,
    'Great Soundtrack': 684,
    Indie: 677,
    Singleplayer: 555,
  },
  genres: ['Экшены', 'Инди'],
}

describe('distinctiveTags', () => {
  test('берёт редкие и заметные в игре теги, от самого характерного', () => {
    expect(distinctiveTags(HOLLOW, weight)).toEqual(['Metroidvania', 'Souls-like'])
  })

  test('без карты тегов — null, а не «самые частые»', () => {
    expect(distinctiveTags(HOLLOW, null)).toBeNull()
    // непрогретый каталог: карта есть, но пригодной её tagWeightFrom не считает
    expect(tagWeightFrom(new Map([['Metroidvania', 3]]))).toBeNull()
    expect(distinctiveTags(HOLLOW, tagWeightFrom(new Map()))).toBeNull()
  })

  test('общие теги не проходят, как бы редкими их ни посчитали', () => {
    const everythingRare: TagWeight = () => 5
    const meta = { tags: { Indie: 1000, Singleplayer: 900, 'Great Soundtrack': 800, Nudity: 700, Action: 600 }, genres: [] }
    expect(distinctiveTags(meta, everythingRare)).toBeNull()
    for (const tag of Object.keys(meta.tags)) expect(GENERIC_TAGS.has(tag), tag).toBe(true)
  })

  test('жанры самой игры не проходят', () => {
    const meta = { tags: { Mythology: 1000, Cooking: 900 }, genres: ['Mythology'] }
    expect(distinctiveTags(meta, weight)).toEqual(['Cooking'])
  })

  test('хвост списка не проходит, даже редкий', () => {
    const meta = { tags: { Platformer: 1000, Mythology: 200 }, genres: [] }
    // Mythology редкий, но у игры всего пятая часть голосов лидера
    expect(distinctiveTags(meta, weight)).toEqual(['Platformer'])
  })

  test('частый тег не дотягивает до порога — честное null', () => {
    // у трети каталога и чаще: вес × редкость ниже порога
    const meta = { tags: { 'Story Rich': 1000, Exploration: 900 }, genres: [] }
    expect(distinctiveTags(meta, weight)).toBeNull()
  })

  test('одно семейство — один тег: Action Roguelike и Roguelite вместе не показываются', () => {
    const meta = { tags: { 'Action Roguelike': 1000, Roguelite: 900, Roguelike: 800, Mythology: 700 }, genres: [] }
    expect(distinctiveTags(meta, weight)).toEqual(['Mythology', 'Action Roguelike'])
  })

  test('k ограничивает число тегов', () => {
    const meta = { tags: { Mythology: 1000, Cooking: 950, 'Farming Sim': 900, Metroidvania: 850 }, genres: [] }
    expect(distinctiveTags(meta, weight, 1)).toEqual(['Cooking'])
    expect(distinctiveTags(meta, weight, 3)).toHaveLength(3)
    expect(distinctiveTags(meta, weight, 0)).toBeNull()
  })

  test('равный счёт решается именем, а не порядком ключей', () => {
    const flat: TagWeight = () => 2
    const a = { tags: { Zeta: 100, Alpha: 100, Mu: 100 }, genres: [] }
    const b = { tags: { Mu: 100, Alpha: 100, Zeta: 100 }, genres: [] }
    expect(distinctiveTags(a, flat)).toEqual(['Alpha', 'Mu'])
    expect(distinctiveTags(b, flat)).toEqual(['Alpha', 'Mu'])
  })

  test('мусор в тегах и в весе не роняет и не даёт NaN', () => {
    const meta = {
      tags: { Metroidvania: Number.NaN, 'Souls-like': 'много', Mythology: 500 } as unknown as Record<string, number>,
      genres: [],
    }
    expect(distinctiveTags(meta, weight)).toEqual(['Mythology'])
    expect(distinctiveTags({ tags: { Mythology: 5 }, genres: [] }, () => Number.NaN)).toBeNull()
    expect(distinctiveTags({ tags: {}, genres: [] }, weight)).toBeNull()
  })
})
