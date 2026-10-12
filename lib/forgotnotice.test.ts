import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Метка «всё удалено» (lib/forgotnotice): ставит её удаление, забирает
 * главная — один раз. Ради этого она и ушла из адреса: /?forgot=1 жил в
 * истории и звучал на каждой перезагрузке.
 *
 * Модуль помнит забранное в памяти вкладки, поэтому «перезагрузка» здесь —
 * свежий импорт модуля при том же sessionStorage.
 */

/** sessionStorage вкладки; throws — приватный режим, где он бросает */
function fakeStorage(throws = false): Storage {
  const data = new Map<string, string>()
  const guard = () => {
    if (throws) throw new Error('SecurityError')
  }
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => {
      guard()
      return data.get(k) ?? null
    },
    setItem: (k: string, v: string) => {
      guard()
      data.set(k, v)
    },
    removeItem: (k: string) => {
      guard()
      data.delete(k)
    },
  }
}

const load = () => import('./forgotnotice')

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('метка «всё удалено»', () => {
  test('удаление ставит, главная забирает — и после перезагрузки её уже нет', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('sessionStorage', storage)
    const tab = await load()
    tab.markForgot()
    expect(tab.takeForgot()).toBe(true)
    // React спрашивает снимок не раз — ответ тот же
    expect(tab.takeForgot()).toBe(true)
    // но в хранилище метки уже нет
    expect(storage.length).toBe(0)

    vi.resetModules()
    const reloaded = await load()
    expect(reloaded.takeForgot()).toBe(false)
  })

  test('без удаления — ничего', async () => {
    vi.stubGlobal('sessionStorage', fakeStorage())
    expect((await load()).takeForgot()).toBe(false)
  })

  test('второе удаление в той же вкладке зажигает строку снова', async () => {
    vi.stubGlobal('sessionStorage', fakeStorage())
    const tab = await load()
    expect(tab.takeForgot()).toBe(false)
    tab.markForgot()
    expect(tab.takeForgot()).toBe(true)
  })

  test('хранилище бросает — метка доезжает в памяти вкладки и ничего не роняет', async () => {
    vi.stubGlobal('sessionStorage', fakeStorage(true))
    const tab = await load()
    expect(() => tab.markForgot()).not.toThrow()
    expect(tab.takeForgot()).toBe(true)
  })

  test('на сервере строки нет', async () => {
    expect((await load()).forgotServer()).toBe(false)
  })
})
