import { describe, expect, test } from 'vitest'
import {
  fetchOwnedGames,
  friendCodeToSteamId,
  parseProfileInput,
  resolveProfile,
  resolveVanity,
} from './steam'

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

  test('голые цифры до десяти знаков — код друга', () => {
    expect(parseProfileInput('22202')).toEqual({ kind: 'friendcode', value: '22202' })
    expect(parseProfileInput(' 123456789 ')).toEqual({ kind: 'friendcode', value: '123456789' })
    expect(parseProfileInput('7')).toEqual({ kind: 'friendcode', value: '7' })
    // Цифровое имя ссылкой целиком — по-прежнему имя, а не код
    expect(parseProfileInput('https://steamcommunity.com/id/12345/')).toEqual({
      kind: 'vanity',
      value: '12345',
    })
  })

  test('вне 32 бит кода не бывает — это уже не код', () => {
    // 4294967296 — одиннадцатый знак не нужен, но в 32 бита не влезает
    expect(parseProfileInput('4294967296')).toEqual({ kind: 'vanity', value: '4294967296' })
    expect(parseProfileInput('0')).toBeNull()
    // Больше десяти цифр, но не семнадцать — имя, как и раньше
    expect(parseProfileInput('123456789012')).toEqual({ kind: 'vanity', value: '123456789012' })
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

  test('rtime_last_played = 0 сохраняется, а не теряется', async () => {
    // Ноль — это ответ «не запускалась ни разу», и он ценнее отсутствия поля.
    // Раньше проверка на truthy выбрасывала его вместе с настоящим отсутствием.
    const { fn } = fakeFetch([
      {
        response: {
          game_count: 1,
          games: [
            { appid: 504230, name: 'Celeste', playtime_forever: 0, rtime_last_played: 0 },
          ],
        },
      },
    ])
    const result = await fetchOwnedGames('76561197960287930', { apiKey: 'k', fetchFn: fn })
    expect(result).toEqual([
      { appid: 504230, name: 'Celeste', playtimeForever: 0, playtime2Weeks: 0, lastPlayed: 0 },
    ])
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

describe('friendCodeToSteamId', () => {
  test('код — младшие 32 бита SteamID64', () => {
    // Пара из документации Valve: STEAM_0:0:11101 — это 22202 и 76561197960287930
    expect(friendCodeToSteamId('22202')).toBe('76561197960287930')
    expect(friendCodeToSteamId('1')).toBe('76561197960265729')
    expect(friendCodeToSteamId('4294967295')).toBe('76561202255233023')
  })

  test('ноль, больше 32 бит и не цифры — не код', () => {
    for (const bad of ['0', '4294967296', '99999999999', '', '12a', '-5', '1.5']) {
      expect(friendCodeToSteamId(bad), bad).toBeNull()
    }
  })

  test('результат всегда семнадцать цифр — его пропустит любой маршрут', () => {
    for (const code of ['1', '22202', '123456789', '4294967295']) {
      expect(friendCodeToSteamId(code), code).toMatch(/^\d{17}$/)
    }
  })
})

/**
 * Код друга проверяется существованием аккаунта: номер из диапазона
 * складывается в SteamID64 всегда, а GetOwnedGames на пустой аккаунт ответил
 * бы так же, как на закрытый профиль.
 */
describe('resolveProfile', () => {
  /** Отвечает по методу API; считает, какие методы звали */
  function steam(routes: Record<string, unknown>) {
    const called: string[] = []
    const fn = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const method = url.pathname.split('/')[2]
      called.push(method)
      return new Response(JSON.stringify(routes[method] ?? {}), { status: 200 })
    }) as FetchLike
    return { opts: { apiKey: 'k', fetchFn: fn, retryDelayMs: 0 }, called }
  }
  const PLAYER = {
    response: { players: [{ steamid: '76561197960287930', personaname: 'Гоша', communityvisibilitystate: 3 }] },
  }

  test('код друга с живым аккаунтом — steamid и уже прочитанная сводка', async () => {
    const { opts, called } = steam({ GetPlayerSummaries: PLAYER })
    const got = await resolveProfile({ kind: 'friendcode', value: '22202' }, opts)
    expect(got?.steamid).toBe('76561197960287930')
    expect(got?.summary?.personaName).toBe('Гоша')
    // Имя не спрашивали: код нашёлся
    expect(called).toEqual(['GetPlayerSummaries'])
  })

  test('аккаунта нет — пробуем то же как цифровое имя', async () => {
    const { opts, called } = steam({
      GetPlayerSummaries: { response: { players: [] } },
      ResolveVanityURL: { response: { success: 1, steamid: '76561198000000001' } },
    })
    const got = await resolveProfile({ kind: 'friendcode', value: '31337' }, opts)
    expect(got).toEqual({ steamid: '76561198000000001' })
    expect(called).toEqual(['GetPlayerSummaries', 'ResolveVanityURL'])
  })

  test('ни аккаунта, ни имени — не найдено', async () => {
    const { opts } = steam({
      GetPlayerSummaries: { response: { players: [] } },
      ResolveVanityURL: { response: { success: 42 } },
    })
    expect(await resolveProfile({ kind: 'friendcode', value: '31337' }, opts)).toBeNull()
  })

  test('однозначный код не уходит в имена: имя короче двух знаков не бывает', async () => {
    const { opts, called } = steam({ GetPlayerSummaries: { response: { players: [] } } })
    expect(await resolveProfile({ kind: 'friendcode', value: '7' }, opts)).toBeNull()
    expect(called).toEqual(['GetPlayerSummaries'])
  })

  test('steamid64 — без сети, имя — через ResolveVanityURL', async () => {
    const direct = steam({})
    expect(
      await resolveProfile({ kind: 'steamid64', value: '76561197960287930' }, direct.opts),
    ).toEqual({ steamid: '76561197960287930' })
    expect(direct.called).toEqual([])

    const named = steam({ ResolveVanityURL: { response: { success: 1, steamid: '76561197960287930' } } })
    expect(await resolveProfile({ kind: 'vanity', value: 'gaben' }, named.opts)).toEqual({
      steamid: '76561197960287930',
    })
    expect(named.called).toEqual(['ResolveVanityURL'])
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

/**
 * Разовый сбой Steam лечится одним повтором.
 *
 * Дороже всего он стоил на входе: человек только что ввёл пароль на сайте
 * Valve, а разовая 503 выбрасывала его на ?error=steam, и вход приходилось
 * проходить заново — ассерт одноразовый.
 */
describe('повтор на разовый сбой', () => {
  const GAMES = { response: { games: [{ appid: 620, name: 'Portal 2', playtime_forever: 30 }] } }

  /** Отвечает по очереди: число — статус без тела, Error — бросок, остальное — 200 с JSON. */
  function script(steps: Array<number | Error | object>) {
    let i = 0
    const fn = (async () => {
      const step = steps[Math.min(i, steps.length - 1)]
      i += 1
      if (step instanceof Error) throw step
      if (typeof step === 'number') return new Response('сбой', { status: step })
      return new Response(JSON.stringify(step), { status: 200 })
    }) as FetchLike
    return { fn, calls: () => i }
  }
  const opts = (fn: FetchLike) => ({ apiKey: 'k', fetchFn: fn, retryDelayMs: 0 })
  const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })

  test('503, затем 200 — игры возвращаются', async () => {
    const { fn, calls } = script([503, GAMES])
    const result = await fetchOwnedGames('76561197960287930', opts(fn))
    expect(Array.isArray(result) && result.map((g) => g.appid)).toEqual([620])
    expect(calls()).toBe(2)
  })

  test('429 и таймаут тоже повторяются', async () => {
    for (const first of [429, 500, timeout()]) {
      const { fn, calls } = script([first, GAMES])
      const result = await fetchOwnedGames('76561197960287930', opts(fn))
      expect(Array.isArray(result), String(first)).toBe(true)
      expect(calls()).toBe(2)
    }
  })

  test('повтор ровно один: два сбоя подряд — отказ', async () => {
    const { fn, calls } = script([503, 503, GAMES])
    await expect(fetchOwnedGames('76561197960287930', opts(fn))).rejects.toThrow(/HTTP 503/)
    expect(calls()).toBe(2)
  })

  test('4xx и чужие ошибки не повторяются: повтор вернул бы то же', async () => {
    const forbidden = script([403, GAMES])
    await expect(fetchOwnedGames('76561197960287930', opts(forbidden.fn))).rejects.toThrow(/HTTP 403/)
    expect(forbidden.calls()).toBe(1)

    const broken = script([new TypeError('bad url'), GAMES])
    await expect(resolveVanity('gaben', opts(broken.fn))).rejects.toThrow(/bad url/)
    expect(broken.calls()).toBe(1)
  })
})
