import { describe, expect, test } from 'vitest'
import { fetchOwnedGames, parseProfileInput, resolveVanity } from './steam'

type FetchLike = typeof fetch

function fakeFetch(responses: unknown[]): { fn: FetchLike; calls: () => number } {
  let i = 0
  const fn = (async () => {
    const body = responses[Math.min(i, responses.length - 1)]
    i += 1
    return new Response(JSON.stringify(body), { status: 200 })
  }) as FetchLike
  return { fn, calls: () => i }
}

describe('parseProfileInput', () => {
  test('ссылка /profiles/ даёт steamid64', () => {
    expect(parseProfileInput('https://steamcommunity.com/profiles/76561197960287930')).toEqual({
      kind: 'steamid64',
      value: '76561197960287930',
    })
  })

  test('хвостовой слэш и query не мешают', () => {
    expect(parseProfileInput('https://steamcommunity.com/profiles/76561197960287930/?xml=1')).toEqual({
      kind: 'steamid64',
      value: '76561197960287930',
    })
  })

  test('ссылка /id/ даёт vanity-имя', () => {
    expect(parseProfileInput('https://steamcommunity.com/id/gabelogannewell/')).toEqual({
      kind: 'vanity',
      value: 'gabelogannewell',
    })
  })

  test('ссылка без схемы тоже понимается', () => {
    expect(parseProfileInput('steamcommunity.com/id/gaben')).toEqual({
      kind: 'vanity',
      value: 'gaben',
    })
  })

  test('голые 17 цифр — это steamid64', () => {
    expect(parseProfileInput('76561197960287930')).toEqual({
      kind: 'steamid64',
      value: '76561197960287930',
    })
  })

  test('голое vanity-имя принимается', () => {
    expect(parseProfileInput('gaben_2-ok')).toEqual({ kind: 'vanity', value: 'gaben_2-ok' })
  })

  test('мусор и пустая строка отклоняются', () => {
    expect(parseProfileInput('not a profile!!')).toBeNull()
    expect(parseProfileInput('')).toBeNull()
    expect(parseProfileInput('https://example.com/id/gaben')).toBeNull()
  })
})

describe('fetchOwnedGames', () => {
  const OWNED_RESPONSE = {
    response: {
      game_count: 2,
      games: [
        {
          appid: 570,
          name: 'Dota 2',
          playtime_forever: 6000,
          playtime_2weeks: 120,
          rtime_last_played: 1_699_999_000,
        },
        { appid: 620, name: 'Portal 2', playtime_forever: 30 },
      ],
    },
  }

  test('маппит ответ Steam в LibraryGame[]', async () => {
    const { fn } = fakeFetch([OWNED_RESPONSE])
    const result = await fetchOwnedGames('76561197960287930', { apiKey: 'k', fetchFn: fn })
    expect(result).toEqual([
      {
        appid: 570,
        name: 'Dota 2',
        playtimeForever: 6000,
        playtime2Weeks: 120,
        lastPlayed: 1_699_999_000,
      },
      { appid: 620, name: 'Portal 2', playtimeForever: 30, playtime2Weeks: 0 },
    ])
  })

  test('стабильно пустой ответ означает приватный профиль (после ретрая)', async () => {
    const { fn, calls } = fakeFetch([{ response: {} }])
    const result = await fetchOwnedGames('76561197960287930', {
      apiKey: 'k',
      fetchFn: fn,
      retryDelayMs: 0,
    })
    expect(result).toBe('private')
    expect(calls()).toBeGreaterThanOrEqual(2)
  })

  test('разовый пустой ответ (глюк Steam) лечится ретраем', async () => {
    const { fn } = fakeFetch([{ response: {} }, OWNED_RESPONSE])
    const result = await fetchOwnedGames('76561197960287930', {
      apiKey: 'k',
      fetchFn: fn,
      retryDelayMs: 0,
    })
    expect(Array.isArray(result)).toBe(true)
    expect((result as unknown[]).length).toBe(2)
  })
})

describe('resolveVanity', () => {
  test('success=1 возвращает steamid', async () => {
    const { fn } = fakeFetch([{ response: { success: 1, steamid: '76561197960287930' } }])
    expect(await resolveVanity('gaben', { apiKey: 'k', fetchFn: fn })).toBe('76561197960287930')
  })

  test('success=42 (не найдено) возвращает null', async () => {
    const { fn } = fakeFetch([{ response: { success: 42, message: 'No match' } }])
    expect(await resolveVanity('nope', { apiKey: 'k', fetchFn: fn })).toBeNull()
  })
})
