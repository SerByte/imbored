import { describe, expect, test } from 'vitest'
import { DEMO_METAS } from './demo'
import { descriptionFor, isEnglishText, storeUrlFor } from './gamedesc'
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

  test('en — смешанный текст студии и русский с латиницей не проходят ни слотом, ни своим описанием', () => {
    const чужие = [
      '一款以三国为背景的 RPG 游戏，支持 Steam 创意工坊。',
      'これはアクションRPGです。Steam版。',
      '한국어 MMORPG 게임 PvP',
      "Tom Clancy's Rainbow Six® Siege X — тактический шутер.",
      'Ein düsteres Abenteuer in einer Welt voller Gefahren und Geheimnisse.',
    ]
    for (const text of чужие) {
      expect(descriptionFor(meta({ shortDescription: text }), 'en'), text).toBeNull()
      // слот проверяется тем же правилом: его пишут несколько дорог
      expect(descriptionFor(meta({ shortDescriptionEn: text }), 'en'), text).toBeNull()
    }
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

describe('isEnglishText', () => {
  test('английское описание магазина — да, с именами собственными и знаками', () => {
    for (const text of [
      EN,
      'Counter-Strike 2 is the largest technical leap in Counter-Strike history, ensuring new features and updates for years to come.',
      'Explore the sunny metropolis of Los Santos with your crew.',
      'Pokémon-style monster taming in an open world.',
      "Baldur's Gate 3 — a story-rich, party-based RPG.",
    ])
      expect(isEnglishText(text), text).toBe(true)
  })

  test('нет — русская буква, мало латиницы, соседний латинский язык, ни одной буквы', () => {
    for (const text of [
      'Counter-Strike 2: Free-to-play, Premier, CS Rating и новые карты.',
      '传送门续作，年度解谜游戏。',
      '一款 RPG 游戏',
      'アクションRPG',
      'Una aventura épica en un mundo abierto lleno de peligros y secretos.',
      'Un jeu de rôle avec des combats et une histoire pour vous.',
      '1.0.3',
      '   ',
      null,
      undefined,
    ])
      expect(isEnglishText(text), String(text)).toBe(false)
  })
})
