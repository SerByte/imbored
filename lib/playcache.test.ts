import { afterEach, describe, expect, test, vi } from 'vitest'
import { NEUTRAL_MOOD } from './mood'
import {
  PLAY_CACHE_TTL_MS,
  PLAY_CACHE_VERSION,
  WARM_MARK_TTL_MS,
  forgetPlay,
  hasFreshDeal,
  hasFreshWarm,
  parsePlayCache,
  parseRecentBans,
  parseWarmMark,
  playCacheKey,
  playCacheStore,
  readRecentBans,
  recentlyBanned,
  rememberBan,
  restoreDeal,
  viewerFrom,
  warmIsFresh,
  warmMarkStore,
  whoAmI,
  withBan,
  type PlayCache,
} from './playcache'
import type { PlayPick } from './playflow'

const ME = '76561197960287930'
const OTHER = '76561197960265728'
const NOW = 1_780_000_000_000
const KEY = playCacheKey({ mood: NEUTRAL_MOOD, focus: null, roulette: false, lean: null })

function pick(appid: number, name = `Game ${appid}`): PlayPick {
  return {
    appid,
    name,
    source: 'familiar',
    reason: 'потому что',
    headerImage: null,
    art: null,
    ccu: null,
    ccuAt: null,
    shortDescription: null,
    tags: ['Co-op'],
    hoursPlayed: 12,
    store: null,
    storeUrl: null,
    priceFinal: null,
    isFree: null,
    discount: null,
    signals: null,
    via: null,
    deferred: null,
    edge: null,
    refund: false,
  }
}

function entry(over: Partial<PlayCache> = {}): PlayCache {
  return {
    v: PLAY_CACHE_VERSION,
    key: KEY,
    viewer: ME,
    at: NOW,
    deal: {
      picks: [pick(10), pick(20), pick(30)],
      discoveries: [pick(40)],
      continueGame: { appid: 570, name: 'Dota 2', recentHours: 3 },
      engine: 'heuristic',
      lean: 'fresh',
      scope: 'library',
      seed: null,
      nudge: null,
      nowSec: Math.floor(NOW / 1000),
      viewer: ME,
    },
    hero: 20,
    liked: [10],
    ...over,
  }
}

const NO_BANS = new Set<number>()

describe('playCacheKey', () => {
  test('каждая часть запроса из адреса меняет ключ', () => {
    const base = { mood: NEUTRAL_MOOD, focus: null, roulette: false, lean: null } as const
    const keys = [
      playCacheKey(base),
      playCacheKey({ ...base, mood: { ...NEUTRAL_MOOD, time: 'long' } }),
      playCacheKey({ ...base, focus: 'untouched' }),
      playCacheKey({ ...base, roulette: true }),
      playCacheKey({ ...base, lean: 'lowenergy' }),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('тот же запрос — тот же ключ', () => {
    const q = { mood: { ...NEUTRAL_MOOD }, focus: null, roulette: false, lean: null } as const
    expect(playCacheKey(q)).toBe(KEY)
  })
})

describe('parsePlayCache', () => {
  test('своя запись проходит туда и обратно через JSON', () => {
    const e = entry()
    expect(parsePlayCache(JSON.parse(JSON.stringify(e)))).toEqual(e)
  })

  test('запись прошлой версии сайта не узнаётся', () => {
    expect(parsePlayCache({ ...entry(), v: 0 })).toBeNull()
    expect(parsePlayCache({ ...entry(), v: undefined })).toBeNull()
  })

  test('одна битая карточка — вся запись мимо', () => {
    const e = entry()
    const broken = { ...e, deal: { ...e.deal, picks: [pick(10), { appid: 20, name: 'X' }] } }
    expect(parsePlayCache(broken)).toBeNull()
    const noTags = { ...e, deal: { ...e.deal, discoveries: [{ ...pick(40), tags: 'Co-op' }] } }
    expect(parsePlayCache(noTags)).toBeNull()
  })

  test('мусор вместо записи — null, а не исключение', () => {
    for (const raw of [null, 42, 'deal', [], {}, { ...entry(), at: 'вчера' }, { ...entry(), liked: ['10'] }]) {
      expect(parsePlayCache(raw)).toBeNull()
    }
  })

  test('пустая выдача и чужой источник — не выдача', () => {
    const e = entry()
    expect(parsePlayCache({ ...e, deal: { ...e.deal, picks: [] } })).toBeNull()
    expect(parsePlayCache({ ...e, deal: { ...e.deal, scope: 'everything' } })).toBeNull()
  })

  test('запись и выдача внутри неё обязаны быть одного человека', () => {
    const e = entry()
    expect(parsePlayCache({ ...e, deal: { ...e.deal, viewer: OTHER } })).toBeNull()
  })

  test('мусор в оси — «без оси», запись при этом жива', () => {
    const e = entry()
    expect(parsePlayCache({ ...e, deal: { ...e.deal, lean: 'sideways' } })?.deal.lean).toBeNull()
  })

  test('выдача из соседей «Как «X», но…» возвращается со своей затравкой', () => {
    const e = entry()
    const seeded = { ...e, deal: { ...e.deal, seed: { appid: 1145360, name: 'Hades' } } }
    expect(parsePlayCache(JSON.parse(JSON.stringify(seeded)))?.deal.seed).toEqual({
      appid: 1145360,
      name: 'Hades',
    })
  })

  test('запись до затравки и мусор в ней — обычная выдача, запись жива', () => {
    const old: Record<string, unknown> = { ...entry().deal }
    delete old.seed
    expect(parsePlayCache({ ...entry(), deal: old })?.deal.seed).toBeNull()
    for (const seed of ['Hades', { appid: '1', name: 'Hades' }, { appid: 0, name: 'X' }, { appid: 5, name: '' }]) {
      expect(parsePlayCache({ ...entry(), deal: { ...entry().deal, seed } })?.deal.seed).toBeNull()
    }
  })

  test('выдача по подталкиванию возвращается с ним; запись до них и мусор — без него', () => {
    const e = entry()
    const nudged = { ...e, deal: { ...e.deal, nudge: 'shorter' } }
    expect(parsePlayCache(JSON.parse(JSON.stringify(nudged)))?.deal.nudge).toBe('shorter')
    const old: Record<string, unknown> = { ...e.deal }
    delete old.nudge
    expect(parsePlayCache({ ...e, deal: old })?.deal.nudge).toBeNull()
    expect(parsePlayCache({ ...e, deal: { ...e.deal, nudge: 'faster' } })?.deal.nudge).toBeNull()
  })
})

describe('restoreDeal', () => {
  const q = { key: KEY, viewer: ME, nowMs: NOW + 60_000, banned: NO_BANS }

  test('свежая запись того же запроса возвращается с тем же героем и «Зашло»', () => {
    const back = restoreDeal(entry(), q)
    expect(back?.index).toBe(1)
    expect(back?.deal.picks.map((p) => p.appid)).toEqual([10, 20, 30])
    expect(back?.deal.scope).toBe('library')
    expect(back?.deal.lean).toBe('fresh')
    expect(back?.liked).toEqual([10])
    expect(back?.at).toBe(NOW)
  })

  test('старше пятнадцати минут — уже не та выдача', () => {
    expect(restoreDeal(entry(), { ...q, nowMs: NOW + PLAY_CACHE_TTL_MS })).not.toBeNull()
    expect(restoreDeal(entry(), { ...q, nowMs: NOW + PLAY_CACHE_TTL_MS + 1 })).toBeNull()
  })

  test('запись «из будущего» — часы перевели, возраст неизвестен', () => {
    expect(restoreDeal(entry(), { ...q, nowMs: NOW - 5 * 60_000 })).toBeNull()
  })

  test('другой запрос — другая выдача', () => {
    const other = playCacheKey({ mood: NEUTRAL_MOOD, focus: null, roulette: true, lean: null })
    expect(restoreDeal(entry(), { ...q, key: other })).toBeNull()
  })

  test('другой вход в той же вкладке чужую выдачу не получит', () => {
    expect(restoreDeal(entry(), { ...q, viewer: OTHER })).toBeNull()
    // не знаем, кто вошёл, — не восстанавливаем вовсе
    expect(restoreDeal(entry(), { ...q, viewer: null })).toBeNull()
  })

  test('бан из соседней вкладки убирает игру, а герой остаётся героем', () => {
    const back = restoreDeal(entry(), { ...q, banned: new Set([10, 40]) })
    expect(back?.deal.picks.map((p) => p.appid)).toEqual([20, 30])
    expect(back?.deal.discoveries).toEqual([])
    // герой — по appid, а не по индексу: он сдвинулся, но остался тем же
    expect(back?.index).toBe(0)
    expect(back?.deal.picks[back.index].appid).toBe(20)
  })

  test('забанен сам герой — на экран первая из оставшихся', () => {
    const back = restoreDeal(entry(), { ...q, banned: new Set([20]) })
    expect(back?.deal.picks[back.index].appid).toBe(10)
  })

  test('забанено всё — восстанавливать нечего', () => {
    expect(restoreDeal(entry(), { ...q, banned: new Set([10, 20, 30]) })).toBeNull()
  })

  test('нет записи — нет и выдачи', () => {
    expect(restoreDeal(null, q)).toBeNull()
  })
})

describe('hasFreshDeal', () => {
  test('спрашивать, кто вошёл, стоит только при свежей записи того же запроса', () => {
    expect(hasFreshDeal(entry(), KEY, NOW + 1000)).toBe(true)
    expect(hasFreshDeal(entry(), 'другой', NOW + 1000)).toBe(false)
    expect(hasFreshDeal(entry(), KEY, NOW + PLAY_CACHE_TTL_MS + 1)).toBe(false)
    expect(hasFreshDeal(null, KEY, NOW)).toBe(false)
  })
})

describe('метка прогрева', () => {
  const mark = { viewer: ME, at: NOW }

  test('десять минут — пропускаем, дольше — греем снова', () => {
    expect(warmIsFresh(mark, ME, NOW + WARM_MARK_TTL_MS)).toBe(true)
    expect(warmIsFresh(mark, ME, NOW + WARM_MARK_TTL_MS + 1)).toBe(false)
  })

  test('чужой прогрев не в счёт: снимок библиотеки заводит именно он', () => {
    expect(warmIsFresh(mark, OTHER, NOW + 1000)).toBe(false)
    expect(warmIsFresh(mark, null, NOW + 1000)).toBe(false)
    // но повод спросить, кто вошёл, — есть
    expect(hasFreshWarm(mark, NOW + 1000)).toBe(true)
  })

  test('разбор: без viewer и числового времени метки нет', () => {
    expect(parseWarmMark(mark)).toEqual(mark)
    expect(parseWarmMark({ viewer: '', at: NOW })).toBeNull()
    expect(parseWarmMark({ viewer: ME, at: 'сейчас' })).toBeNull()
    expect(parseWarmMark(null)).toBeNull()
  })
})

describe('недавние баны', () => {
  test('новый бан дописывается, протухшие и повторы выбрасываются', () => {
    const old = { appid: 1, at: NOW - PLAY_CACHE_TTL_MS - 1 }
    const recent = { appid: 2, at: NOW - 1000 }
    const list = withBan([old, recent, { appid: 3, at: NOW - 5000 }], 3, NOW)
    expect(list).toEqual([recent, { appid: 3, at: NOW }])
  })

  test('в фильтр идут только свежие', () => {
    const list = [
      { appid: 1, at: NOW - PLAY_CACHE_TTL_MS - 1 },
      { appid: 2, at: NOW - 1000 },
    ]
    expect([...recentlyBanned(list, NOW)]).toEqual([2])
    expect(recentlyBanned(null, NOW).size).toBe(0)
  })

  test('битые элементы выбрасываются поштучно', () => {
    expect(parseRecentBans([{ appid: 5, at: NOW }, { appid: '6', at: NOW }, null, 7])).toEqual([
      { appid: 5, at: NOW },
    ])
    expect(parseRecentBans({ appid: 5 })).toBeNull()
  })
})

describe('кто вошёл', () => {
  test('steamid — только у вошедшего', () => {
    expect(viewerFrom({ authed: true, steamid: ME, writer: true })).toBe(ME)
    expect(viewerFrom({ authed: false })).toBeNull()
    expect(viewerFrom({ authed: true })).toBeNull()
    expect(viewerFrom({ authed: true, steamid: 42 })).toBeNull()
    expect(viewerFrom(null)).toBeNull()
  })

  test('whoAmI спрашивает touch, а любой сбой — «не знаю»', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    const ok = (async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      return Response.json({ authed: true, steamid: ME })
    }) as typeof fetch
    expect(await whoAmI(undefined, ok)).toBe(ME)
    expect(calls[0][0]).toBe('/api/session/touch')
    expect(calls[0][1]?.method).toBe('POST')

    const down = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    expect(await whoAmI(undefined, down)).toBeNull()

    const fail = (async () => new Response('nope', { status: 500 })) as typeof fetch
    expect(await whoAmI(undefined, fail)).toBeNull()

    const junk = (async () => new Response('<html>', { status: 200 })) as typeof fetch
    expect(await whoAmI(undefined, junk)).toBeNull()
  })
})

describe('хранилища', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function fakeStorage() {
    const data: Record<string, string> = {}
    return {
      data,
      area: {
        getItem: (k: string) => (Object.hasOwn(data, k) ? data[k] : null),
        setItem: (k: string, v: string) => {
          data[k] = v
        },
        removeItem: (k: string) => {
          delete data[k]
        },
      },
    }
  }

  test('выдача и метка — во вкладке, баны — на все вкладки; выход забывает всё', () => {
    const session = fakeStorage()
    const local = fakeStorage()
    vi.stubGlobal('sessionStorage', session.area)
    vi.stubGlobal('localStorage', local.area)

    playCacheStore.set(entry())
    warmMarkStore.set({ viewer: ME, at: NOW })
    rememberBan(10, NOW)
    expect(Object.keys(session.data).sort()).toEqual(['imbored.play.deal', 'imbored.play.warm'])
    expect(Object.keys(local.data)).toEqual(['imbored.play.bans'])

    forgetPlay()
    expect(session.data).toEqual({})
    expect(local.data).toEqual({})
    expect(playCacheStore.get()).toBeNull()
    expect(readRecentBans(NOW).size).toBe(0)
  })

  /**
   * Список банов никто не слушает, а страница живёт через «Подробнее» →
   * «Назад»: модуль тот же, и кэш первого чтения — тоже. Бан соседней вкладки
   * после него обязан быть виден — иначе игру, убранную навсегда, «Назад»
   * возвращает на экран, порой героем.
   */
  test('бан соседней вкладки виден и после первого чтения в этой', () => {
    const local = fakeStorage()
    vi.stubGlobal('localStorage', local.area)
    expect(readRecentBans(NOW).size).toBe(0)

    // соседняя вкладка пишет в хранилище напрямую, события сюда не приходит
    local.data['imbored.play.bans'] = JSON.stringify([{ appid: 20, at: NOW }])

    const back = restoreDeal(entry(), {
      key: KEY,
      viewer: ME,
      nowMs: NOW + 1000,
      banned: readRecentBans(NOW + 1000),
    })
    expect(back?.deal.picks.map((p) => p.appid)).toEqual([10, 30])
  })

  test('свой бан дописывается к хранилищу и не стирает бан соседней вкладки', () => {
    const local = fakeStorage()
    vi.stubGlobal('localStorage', local.area)
    expect(readRecentBans(NOW).size).toBe(0)

    local.data['imbored.play.bans'] = JSON.stringify([{ appid: 20, at: NOW }])
    rememberBan(30, NOW + 1000)

    const stored = parseRecentBans(JSON.parse(local.data['imbored.play.bans']))
    expect(stored?.map((b) => b.appid)).toEqual([20, 30])
    expect([...readRecentBans(NOW + 1000)].sort()).toEqual([20, 30])
  })
})
