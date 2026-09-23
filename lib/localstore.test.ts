import { afterEach, describe, expect, test, vi } from 'vitest'
import { createLocalStore, parseFlag } from './localstore'

/**
 * Хранилище на устройстве — чужие руки и чужие среды: в node его нет, в
 * приватном режиме оно бросает, а внутри может лежать что угодно. Поэтому
 * проверяем не «сохраняется ли», а «что будет, если всё пошло не так»:
 * страница не имеет права падать из-за строки в хранилище.
 */

type Store = Record<string, string>

function fakeStorage(store: Store, opts: { throws?: boolean } = {}) {
  const guard = () => {
    if (opts.throws) throw new Error('заблокировано')
  }
  return {
    getItem: (k: string) => {
      guard()
      return Object.hasOwn(store, k) ? store[k] : null
    },
    setItem: (k: string, v: string) => {
      guard()
      store[k] = v
    },
    removeItem: (k: string) => {
      guard()
      delete store[k]
    },
  }
}

/** window с ручным вызовом события storage — как запись из соседней вкладки */
function fakeWindow() {
  const handlers = new Set<(e: { key: string | null }) => void>()
  vi.stubGlobal('window', {
    addEventListener: (_: string, h: (e: { key: string | null }) => void) => handlers.add(h),
    removeEventListener: (_: string, h: (e: { key: string | null }) => void) => handlers.delete(h),
  })
  return {
    fire: (key: string | null) => handlers.forEach((h) => h({ key })),
    count: () => handlers.size,
  }
}

const KEY = 'imbored.test'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createLocalStore без браузера', () => {
  /**
   * Ровно тот случай, в котором страница рендерится на сервере и в тестах:
   * ни window, ни рабочего хранилища. Ничего не бросает, значения нет.
   */
  test('в node без window: null и никаких исключений', () => {
    // Хранилища нет вовсе. Именно undefined, а не встроенное в node 25: то
    // без --localstorage-file отдаёт пустышку без методов (путь через тот же
    // catch) и печатает в прогон предупреждение
    vi.stubGlobal('localStorage', undefined)
    vi.stubGlobal('sessionStorage', undefined)
    const store = createLocalStore(KEY, parseFlag)
    expect(store.get()).toBeNull()
    expect(store.server()).toBeNull()
    expect(() => store.set(true)).not.toThrow()
    const off = store.subscribe(() => {})
    expect(() => off()).not.toThrow()

    const session = createLocalStore(KEY, parseFlag, 'session')
    expect(session.get()).toBeNull()
    expect(() => session.set(false)).not.toThrow()
  })
})

describe('createLocalStore', () => {
  test('записанное читается обратно, null стирает', () => {
    const data: Store = {}
    vi.stubGlobal('localStorage', fakeStorage(data))
    const store = createLocalStore(KEY, parseFlag)
    expect(store.get()).toBeNull()
    store.set(true)
    expect(store.get()).toBe(true)
    expect(data[KEY]).toBe('true')
    store.set(null)
    expect(store.get()).toBeNull()
    expect(KEY in data).toBe(false)
  })

  test('мусор в хранилище — null, а не падение и не «что-то похожее»', () => {
    for (const raw of ['{', 'undefined', '"true"', '1', 'null', '[]']) {
      vi.stubGlobal('localStorage', fakeStorage({ [KEY]: raw }))
      expect(createLocalStore(KEY, parseFlag).get()).toBeNull()
    }
  })

  test('разбор, который сам бросает, тоже даёт null', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [KEY]: '{}' }))
    const store = createLocalStore(KEY, () => {
      throw new Error('не узнал')
    })
    expect(store.get()).toBeNull()
  })

  test('хранилище бросает — чтение null, запись живёт в памяти вкладки', () => {
    vi.stubGlobal('localStorage', fakeStorage({}, { throws: true }))
    const store = createLocalStore(KEY, parseFlag)
    expect(store.get()).toBeNull()
    expect(() => store.set(true)).not.toThrow()
    expect(store.get()).toBe(true)
  })

  /**
   * useSyncExternalStore сравнивает снимки по ссылке: новый объект на каждом
   * вызове — бесконечный рендер. Пока значение не менялось, ссылка одна.
   */
  test('снимок — одна и та же ссылка, пока значение не менялось', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [KEY]: JSON.stringify({ a: 1 }) }))
    const store = createLocalStore(KEY, (raw) => (typeof raw === 'object' ? (raw as { a: number }) : null))
    const first = store.get()
    expect(first).toEqual({ a: 1 })
    expect(store.get()).toBe(first)
  })

  test('подписчик слышит свою запись и перестаёт слышать после отписки', () => {
    vi.stubGlobal('localStorage', fakeStorage({}))
    const store = createLocalStore(KEY, parseFlag)
    const cb = vi.fn()
    const off = store.subscribe(cb)
    store.set(true)
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    store.set(false)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  test('запись из соседней вкладки перечитывается, чужой ключ — нет', () => {
    const data: Store = {}
    vi.stubGlobal('localStorage', fakeStorage(data))
    const win = fakeWindow()
    const store = createLocalStore(KEY, parseFlag)
    const cb = vi.fn()
    const off = store.subscribe(cb)
    expect(store.get()).toBeNull()

    data[KEY] = 'true'
    win.fire('imbored.other')
    expect(cb).not.toHaveBeenCalled()
    expect(store.get()).toBeNull()

    win.fire(KEY)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(store.get()).toBe(true)

    off()
    expect(win.count()).toBe(0)
  })

  /**
   * Кэш снимка сбрасывает событие storage, а слушает его только subscribe.
   * Кто читает без подписки, получает от get первое прочитанное навсегда —
   * так список банов /play не видел бан соседней вкладки. fresh читает мимо.
   */
  test('без подписки get помнит первое прочитанное, fresh видит соседнюю вкладку', () => {
    const data: Store = {}
    vi.stubGlobal('localStorage', fakeStorage(data))
    const store = createLocalStore(KEY, parseFlag)
    expect(store.get()).toBeNull()

    data[KEY] = 'true'
    expect(store.get()).toBeNull()
    expect(store.fresh()).toBe(true)
    // прочитанное через fresh — теперь и снимок
    expect(store.get()).toBe(true)

    delete data[KEY]
    expect(store.fresh()).toBeNull()
    expect(store.get()).toBeNull()
  })

  test('fresh при бросающем хранилище отдаёт записанное в памяти вкладки', () => {
    vi.stubGlobal('localStorage', fakeStorage({}, { throws: true }))
    const store = createLocalStore(KEY, parseFlag)
    expect(store.fresh()).toBeNull()
    store.set(true)
    expect(store.fresh()).toBe(true)
  })

  test('sessionStorage живёт отдельно и соседей не слушает', () => {
    const local: Store = {}
    const session: Store = {}
    vi.stubGlobal('localStorage', fakeStorage(local))
    vi.stubGlobal('sessionStorage', fakeStorage(session))
    const win = fakeWindow()
    const store = createLocalStore(KEY, parseFlag, 'session')
    store.subscribe(() => {})
    expect(win.count()).toBe(0)
    store.set(true)
    expect(session[KEY]).toBe('true')
    expect(KEY in local).toBe(false)
  })
})
