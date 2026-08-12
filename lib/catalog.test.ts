import { describe, expect, test } from 'vitest'
import { parseAppDetails, parseSteamSpyTags } from './catalog'

const APPDETAILS_RESPONSE = {
  '620': {
    success: true,
    data: {
      type: 'game',
      name: 'Portal 2',
      steam_appid: 620,
      is_free: false,
      short_description: 'The "Perpetual Testing Initiative"...',
      header_image: 'https://cdn.example/620/header.jpg',
      screenshots: [
        { id: 0, path_thumbnail: 't0', path_full: 'https://cdn.example/620/s0.jpg' },
        { id: 1, path_thumbnail: 't1', path_full: 'https://cdn.example/620/s1.jpg' },
      ],
      genres: [{ id: '4', description: 'Casual' }],
      categories: [
        { id: 2, description: 'Single-player' },
        { id: 9, description: 'Co-op' },
      ],
      price_overview: { currency: 'USD', initial: 999, final: 499, discount_percent: 50 },
      release_date: { coming_soon: false, date: '18 Apr, 2011' },
    },
  },
}

describe('parseAppDetails', () => {
  test('извлекает GameMeta из ответа магазина', () => {
    const meta = parseAppDetails(APPDETAILS_RESPONSE, 620)
    expect(meta).toEqual({
      appid: 620,
      name: 'Portal 2',
      tags: {},
      genres: ['Casual'],
      categories: [2, 9],
      shortDescription: 'The "Perpetual Testing Initiative"...',
      headerImage: 'https://cdn.example/620/header.jpg',
      screenshots: ['https://cdn.example/620/s0.jpg', 'https://cdn.example/620/s1.jpg'],
      isFree: false,
      priceFinal: 499,
      releaseDate: '18 Apr, 2011',
    })
  })

  test('success=false или не-игра дают null', () => {
    expect(parseAppDetails({ '99': { success: false } }, 99)).toBeNull()
    expect(
      parseAppDetails({ '77': { success: true, data: { type: 'dlc', name: 'X', steam_appid: 77 } } }, 77),
    ).toBeNull()
  })
})

describe('parseSteamSpyTags', () => {
  test('извлекает теги с голосами', () => {
    expect(parseSteamSpyTags({ appid: 620, tags: { Puzzle: 3212, 'Co-op': 2800 } })).toEqual({
      Puzzle: 3212,
      'Co-op': 2800,
    })
  })

  test('SteamSpy отдаёт [] вместо объекта, когда тегов нет', () => {
    expect(parseSteamSpyTags({ appid: 1, tags: [] })).toEqual({})
    expect(parseSteamSpyTags({})).toEqual({})
  })
})
