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

/** Дать отработать микрозадачам — тем, что отписка ставит в очередь */
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

/*
 * Строка живёт один заход на главную, а не весь документ. Забранное раньше
 * помнилось до перезагрузки, и всякий следующий клиентский заход на главную
 * той же вкладки снова говорил «всё удалено»: гость, прошедший после удаления
 * квиз, вместо «Пара часов · Расслабиться · Один — запомнили» читал то же
 * «удалено» (V7), а демо-вход и «Выйти» после него — «входы на всех
 * устройствах погашены» про выход, которого не было (V10). Заход кончается,
 * когда главная отписалась и в тот же проход не подписалась снова.
 */
describe('метка «всё удалено» — на один заход', () => {
  test('ушёл с главной — следующий заход строки не видит', async () => {
    vi.stubGlobal('sessionStorage', fakeStorage())
    const tab = await load()
    tab.markForgot()
    const off = tab.subscribeForgot()
    expect(tab.takeForgot()).toBe(true)
    // квиз, /library, «Выйти» — главная размонтирована
    off()
    await flush()
    // вернулся на главную клиентским переходом: модуль тот же, строки нет
    const back = tab.subscribeForgot()
    expect(tab.takeForgot()).toBe(false)
    back()
  })

  /*
   * StrictMode в разработке и перемонтирование в одном коммите отписывают и
   * тут же подписывают снова — синхронно, до микрозадач. Это не уход с
   * главной, и строка обязана остаться: иначе она гасла бы на первом же
   * показе.
   */
  test('отписка и подписка в тот же проход — заход не кончился', async () => {
    vi.stubGlobal('sessionStorage', fakeStorage())
    const tab = await load()
    tab.markForgot()
    const first = tab.subscribeForgot()
    expect(tab.takeForgot()).toBe(true)
    first()
    const again = tab.subscribeForgot()
    await flush()
    expect(tab.takeForgot()).toBe(true)
    again()
    await flush()
    expect(tab.takeForgot()).toBe(false)
  })

  test('новое удаление после ухода снова зажигает строку', async () => {
    vi.stubGlobal('sessionStorage', fakeStorage())
    const tab = await load()
    tab.markForgot()
    const off = tab.subscribeForgot()
    expect(tab.takeForgot()).toBe(true)
    off()
    await flush()
    expect(tab.takeForgot()).toBe(false)
    tab.markForgot()
    expect(tab.takeForgot()).toBe(true)
  })

  /*
   * Удаление, нажатое между уходом с главной и микрозадачей отписки, — новая
   * метка, и уборка прошлого захода её не гасит.
   */
  test('метка, поставленная до микрозадачи ухода, переживает её', async () => {
    vi.stubGlobal('sessionStorage', fakeStorage())
    const tab = await load()
    tab.markForgot()
    const off = tab.subscribeForgot()
    expect(tab.takeForgot()).toBe(true)
    off()
    tab.markForgot()
    await flush()
    expect(tab.takeForgot()).toBe(true)
  })

  test('хранилище бросает — заход кончается так же', async () => {
    vi.stubGlobal('sessionStorage', fakeStorage(true))
    const tab = await load()
    tab.markForgot()
    const off = tab.subscribeForgot()
    expect(tab.takeForgot()).toBe(true)
    off()
    await flush()
    expect(tab.takeForgot()).toBe(false)
  })
})
