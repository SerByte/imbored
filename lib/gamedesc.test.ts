import { describe, expect, test } from 'vitest'
import { DEMO_METAS } from './demo'
import { descriptionFor, storeUrlFor } from './gamedesc'
import { OTHER_STORE_EN, OTHER_STORE_GAMES } from './otherstores'
import type { GameMeta } from './types'

const CYRILLIC = /[А-Яа-яЁё]/
const RU = 'Головоломка с порталами и лучший кооператив на свете.'
const EN = 'The highly anticipated sequel to the puzzle game of the year.'

const meta = (over: Partial<GameMeta> = {}): GameMeta => ({
  appid: 620,
  name: 'Portal 2',
  tags: {},
  genres: [],
  categories: [],
  ...over,
})

describe('descriptionFor', () => {
  test('ru — то, что лежит в shortDescription, как и раньше', () => {
    expect(descriptionFor(meta({ shortDescription: RU, shortDescriptionEn: EN }), 'ru')).toBe(RU)
    // английский хвост прогрева русская ветка видит, как видела всегда
    expect(descriptionFor(meta({ shortDescription: EN }), 'ru')).toBe(EN)
    expect(descriptionFor(meta({ shortDescription: '   ' }), 'ru')).toBeNull()
    expect(descriptionFor(meta(), 'ru')).toBeNull()
    expect(descriptionFor(undefined, 'ru')).toBeNull()
  })

  test('en — английский слот первым', () => {
    expect(descriptionFor(meta({ shortDescription: RU, shortDescriptionEn: EN }), 'en')).toBe(EN)
  })

  test('en — своё описание, если оно английское, а русское — никогда', () => {
    expect(descriptionFor(meta({ shortDescription: EN }), 'en')).toBe(EN)
    expect(descriptionFor(meta({ shortDescription: RU }), 'en')).toBeNull()
    // текст студии не на английском — тоже не английский: блок молчит
    expect(descriptionFor(meta({ shortDescription: '传送门续作，年度解谜游戏。' }), 'en')).toBeNull()
    expect(descriptionFor(meta({ shortDescriptionEn: '  ' , shortDescription: RU }), 'en')).toBeNull()
  })

  test('en — пул других магазинов по наложению, без пересева базы', () => {
    const fortnite = OTHER_STORE_GAMES.find((g) => g.appid === -101)!
    expect(descriptionFor(fortnite, 'en')).toBe('Battle royale, building and endless crossovers. Free to play.')
    // а русская ветка — прежняя, из записи пула
    expect(descriptionFor(fortnite, 'ru')).toBe(fortnite.shortDescription)
  })

  test('на en ни одно описание пула и демо не говорит по-русски', () => {
    for (const g of [...OTHER_STORE_GAMES, ...DEMO_METAS]) {
      const text = descriptionFor(g, 'en')
      expect(text, g.name).toBeTruthy()
      expect(CYRILLIC.test(text!), `${g.name}: ${text}`).toBe(false)
    }
  })
})

describe('storeUrlFor', () => {
  test('пул других магазинов на en — английская страница магазина', () => {
    const lol = OTHER_STORE_GAMES.find((g) => g.appid === -106)!
    expect(storeUrlFor(lol, 'en')).toBe('https://www.leagueoflegends.com/en-us/')
    expect(storeUrlFor(lol, 'ru')).toBe('https://www.leagueoflegends.com/ru-ru/')
  })

  test('игра Steam своей страницы не несёт ни на каком языке', () => {
    expect(storeUrlFor(meta(), 'en')).toBeNull()
    expect(storeUrlFor(meta(), 'ru')).toBeNull()
    expect(storeUrlFor(undefined, 'en')).toBeNull()
  })

  test('у каждой игры пула английская страница — en-US, без русской локали в адресе', () => {
    for (const g of OTHER_STORE_GAMES) {
      const url = storeUrlFor(g, 'en')!
      expect(url, g.name).toMatch(/^https:\/\//)
      expect(url, g.name).not.toMatch(/ru-ru|\/ru\//i)
    }
  })
})

describe('наложение OTHER_STORE_EN', () => {
  test('пара — у каждой записи пула и ни у кого больше', () => {
    const pool = OTHER_STORE_GAMES.map((g) => String(g.appid)).sort()
    expect(Object.keys(OTHER_STORE_EN).sort()).toEqual(pool)
  })
})
