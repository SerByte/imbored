import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  ASK_AFTER_SEC,
  ASK_UNTIL_SEC,
  dueLaunch,
  dueLaunchNow,
  launchMemoStore,
  parseLaunchMemo,
  rememberLaunch,
  STOP_MINUTES,
  stopRuleLine,
  subscribeDueLaunch,
  type LaunchMemo,
} from './launchmemo'
import { createLocalStore } from './localstore'

/**
 * Вопрос «не зацепило?» задаётся по записи из хранилища, а пишет туда кто
 * угодно. Поэтому главное — что мусор и чужое время молчат, а окно в десять
 * минут — два часа держится с обеих сторон.
 */

const NOW = 1_700_000_000
const MEMO: LaunchMemo = { appid: 292030, name: 'The Witcher 3', at: NOW }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('parseLaunchMemo', () => {
  test('целая запись читается, лишнее отбрасывается', () => {
    expect(parseLaunchMemo({ ...MEMO, extra: 1 })).toEqual(MEMO)
  })

  test('мусор — null', () => {
    for (const raw of [
      null,
      undefined,
      'launch',
      42,
      [],
      {},
      { appid: 1, name: 'x' },
      { appid: 1, at: NOW },
      { name: 'x', at: NOW },
      { appid: '1', name: 'x', at: NOW },
      { appid: 1.5, name: 'x', at: NOW },
      { appid: 0, name: 'x', at: NOW },
      { appid: 1, name: '  ', at: NOW },
      { appid: 1, name: 'x', at: Infinity },
      { appid: 1, name: 'x', at: String(NOW) },
    ]) {
      expect(parseLaunchMemo(raw), JSON.stringify(raw)).toBeNull()
    }
  })
})

describe('dueLaunch — когда спрашивать', () => {
  test('раньше десяти минут — рано', () => {
    expect(dueLaunch(MEMO, NOW)).toBeNull()
    expect(dueLaunch(MEMO, NOW + ASK_AFTER_SEC - 1)).toBeNull()
  })

  test('от десяти минут до двух часов — пора', () => {
    expect(dueLaunch(MEMO, NOW + ASK_AFTER_SEC)).toBe(MEMO)
    expect(dueLaunch(MEMO, NOW + 45 * 60)).toBe(MEMO)
    expect(dueLaunch(MEMO, NOW + ASK_UNTIL_SEC - 1)).toBe(MEMO)
  })

  test('два часа и позже — вопрос опоздал', () => {
    expect(dueLaunch(MEMO, NOW + ASK_UNTIL_SEC)).toBeNull()
    expect(dueLaunch(MEMO, NOW + 86_400)).toBeNull()
  })

  test('запуск из будущего и пустая память — молчим', () => {
    expect(dueLaunch({ ...MEMO, at: NOW + 3600 }, NOW)).toBeNull()
    expect(dueLaunch(null, NOW)).toBeNull()
  })
})

describe('хранилище', () => {
  function fakeSession() {
    const data: Record<string, string> = {}
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => (Object.hasOwn(data, k) ? data[k] : null),
      setItem: (k: string, v: string) => {
        data[k] = v
      },
      removeItem: (k: string) => {
        delete data[k]
      },
    })
    return data
  }

  test('запуск живёт в sessionStorage, а не в localStorage', () => {
    const session = fakeSession()
    vi.stubGlobal('localStorage', undefined)
    rememberLaunch(MEMO.appid, MEMO.name, NOW)
    expect(JSON.parse(session['imbored.play.launch'])).toEqual(MEMO)
    expect(createLocalStore('imbored.play.launch', parseLaunchMemo, 'session').get()).toEqual(MEMO)
    launchMemoStore.set(null)
    expect('imbored.play.launch' in session).toBe(false)
  })

  test('снимок читает часы сам и держит ссылку, пока окно открыто', () => {
    fakeSession()
    rememberLaunch(MEMO.appid, MEMO.name, NOW)
    vi.useFakeTimers()
    vi.setSystemTime((NOW + 5 * 60) * 1000)
    expect(dueLaunchNow()).toBeNull()
    vi.setSystemTime((NOW + 15 * 60) * 1000)
    const first = dueLaunchNow()
    expect(first).toEqual(MEMO)
    expect(dueLaunchNow()).toBe(first)
    launchMemoStore.set(null)
    expect(dueLaunchNow()).toBeNull()
  })

  test('без браузера (сервер, node) — null и никаких исключений', () => {
    vi.stubGlobal('sessionStorage', undefined)
    expect(launchMemoStore.server()).toBeNull()
    expect(createLocalStore('imbored.test.launch', parseLaunchMemo, 'session').get()).toBeNull()
    const off = subscribeDueLaunch(() => {})
    expect(() => off()).not.toThrow()
  })

  test('возвращение на вкладку и фокус окна перечитывают снимок', () => {
    fakeSession()
    const on = new Map<string, Set<() => void>>()
    const target = {
      addEventListener: (type: string, h: () => void) => {
        if (!on.has(type)) on.set(type, new Set())
        on.get(type)!.add(h)
      },
      removeEventListener: (type: string, h: () => void) => on.get(type)?.delete(h),
    }
    let visibilityState = 'hidden'
    vi.stubGlobal('window', target)
    vi.stubGlobal('document', {
      ...target,
      get visibilityState() {
        return visibilityState
      },
    })
    const fire = (type: string) => on.get(type)?.forEach((h) => h())

    const cb = vi.fn()
    const off = subscribeDueLaunch(cb)
    fire('visibilitychange')
    expect(cb, 'вкладку спрятали — спрашивать некому').toHaveBeenCalledTimes(0)
    visibilityState = 'visible'
    fire('visibilitychange')
    expect(cb).toHaveBeenCalledTimes(1)
    fire('focus')
    expect(cb).toHaveBeenCalledTimes(2)
    rememberLaunch(MEMO.appid, MEMO.name, NOW)
    expect(cb, 'своя запись — тоже событие').toHaveBeenCalledTimes(3)

    off()
    fire('visibilitychange')
    fire('focus')
    expect(cb).toHaveBeenCalledTimes(3)
    launchMemoStore.set(null)
  })
})

describe('строка правила', () => {
  test('срок — по длине вечера', () => {
    expect(stopRuleLine('short')).toBe('Не зацепит за 15 минут — возвращайся, дадим другую.')
    expect(stopRuleLine('medium')).toContain('за 20 минут')
    expect(stopRuleLine('long')).toContain('за 30 минут')
  })

  test('короткому вечеру — самый короткий срок', () => {
    expect(STOP_MINUTES.short).toBeLessThan(STOP_MINUTES.medium)
    expect(STOP_MINUTES.medium).toBeLessThan(STOP_MINUTES.long)
  })

  test('мусор вместо длины вечера — средний срок, а не «undefined минут»', () => {
    expect(stopRuleLine('forever' as never)).toContain('за 20 минут')
  })
})
