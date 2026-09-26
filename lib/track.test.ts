import { afterEach, describe, expect, test, vi } from 'vitest'
import { captureRef, currentSource, eventKey, parseRef, parseTrackEvent, track, TRACK_PATH, withRef } from './track'

describe('разбор маяка', () => {
  test('знакомое событие и источник проходят', () => {
    expect(parseTrackEvent({ event: 'quiz_done', source: 'compat' })).toEqual({ event: 'quiz_done', source: 'compat' })
    expect(parseTrackEvent({ event: 'launch_click' })).toEqual({ event: 'launch_click', source: 'direct' })
  })

  test('чужой источник — direct, чужое событие — null', () => {
    expect(parseTrackEvent({ event: 'pick_shown', source: '76561197960287930' })).toEqual({
      event: 'pick_shown',
      source: 'direct',
    })
    // серверные шаги браузеру не доверены: их считает сервер сам
    expect(parseTrackEvent({ event: 'connect_ok' })).toBeNull()
    expect(parseTrackEvent({ event: 'drop table' })).toBeNull()
    expect(parseTrackEvent(null)).toBeNull()
    expect(parseTrackEvent([{ event: 'quiz_done' }])).toBeNull()
  })

  test('ключ счётчика — событие:источник', () => {
    expect(eventKey('share_click', 'portrait')).toBe('share_click:portrait')
    expect(eventKey('connect_ok', 'openid')).toBe('connect_ok:openid')
  })
})

describe('метка ref', () => {
  test('закрытый список', () => {
    expect(parseRef('room')).toBe('room')
    expect(parseRef('evil')).toBeNull()
    expect(parseRef(null)).toBeNull()
  })

  test('withRef ставит метку и не трогает остальное', () => {
    expect(withRef('https://imbored.cc/compat/76561197960287930', 'compat')).toBe(
      'https://imbored.cc/compat/76561197960287930?ref=compat',
    )
    expect(withRef('https://imbored.cc/room/ABC234?x=1&ref=pick', 'room')).toBe(
      'https://imbored.cc/room/ABC234?x=1&ref=room',
    )
    expect(withRef('не адрес', 'room')).toBe('не адрес')
  })
})

describe('браузер', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function browser() {
    const store = new Map<string, string>()
    const sent: Array<{ path: string; body: unknown }> = []
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    vi.stubGlobal('navigator', {
      sendBeacon: (path: string, blob: Blob) => {
        sent.push({ path, body: blob })
        return true
      },
    })
    const bodies = async () => Promise.all(sent.map(async (s) => JSON.parse(await (s.body as Blob).text())))
    return { store, sent, bodies }
  }

  test('первая метка запоминается и отмечает приход, вторая не перебивает', async () => {
    const b = browser()
    captureRef('?ref=compat&x=1')
    captureRef('?ref=room')
    expect(currentSource()).toBe('compat')
    expect(b.sent.map((s) => s.path)).toEqual([TRACK_PATH])
    expect(await b.bodies()).toEqual([{ event: 'ref_open', source: 'compat' }])
  })

  test('чужая метка — ничего не пишем и не шлём', () => {
    const b = browser()
    captureRef('?ref=76561197960287930')
    expect(b.store.size).toBe(0)
    expect(b.sent).toEqual([])
    expect(currentSource()).toBe('direct')
  })

  test('шаг уходит с источником вкладки', async () => {
    const b = browser()
    b.store.set('imbored-ref', 'portrait')
    track('launch_click')
    expect(await b.bodies()).toEqual([{ event: 'launch_click', source: 'portrait' }])
  })

  test('сломанное хранилище и отказ маяка страницу не роняют', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
    })
    vi.stubGlobal('navigator', {
      sendBeacon: () => {
        throw new Error('nope')
      },
    })
    expect(() => captureRef('?ref=room')).not.toThrow()
    expect(() => track('quiz_done')).not.toThrow()
    expect(currentSource()).toBe('direct')
  })
})
