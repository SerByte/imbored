import { afterEach, describe, expect, test, vi } from 'vitest'
import { rememberFinished } from './finishlocal'
import { launchMemoStore, rememberLaunch } from './launchmemo'
import { readRecentBans } from './playcache'

/**
 * «Уже прошёл» вне /play — что остаётся на устройстве. Хранилища — подменные,
 * как в lib/playcache.test.ts: в node их нет.
 */

const NOW = 1_780_000_000_000

function fakeStorage() {
  const data: Record<string, string> = {}
  return {
    getItem: (k: string) => (Object.hasOwn(data, k) ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v
    },
    removeItem: (k: string) => {
      delete data[k]
    },
  }
}

describe('rememberFinished', () => {
  afterEach(() => {
    launchMemoStore.set(null)
    vi.unstubAllGlobals()
  })

  test('пройденная уходит из выдачи после «Назад» и не вызывает «не зацепило?»', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    vi.stubGlobal('sessionStorage', fakeStorage())
    rememberLaunch(367520, 'Hollow Knight', Math.floor(NOW / 1000))

    rememberFinished(367520, NOW)

    expect(readRecentBans(NOW).has(367520)).toBe(true)
    expect(launchMemoStore.get()).toBeNull()
  })

  test('запуск другой игры не трогает: ответ про одну — не ответ про другую', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    vi.stubGlobal('sessionStorage', fakeStorage())
    rememberLaunch(620, 'Portal 2', Math.floor(NOW / 1000))

    rememberFinished(367520, NOW)

    expect(launchMemoStore.get()?.appid).toBe(620)
  })
})
