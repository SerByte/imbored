import { afterEach, describe, expect, test, vi } from 'vitest'
import { createDb, type Db } from './db'
import { demoSteamId, getDb, isDemoId, sessionCookieOptions, sessionSecret } from './server'

// Настоящий createDb ходил бы в сеть или в файл data/imbored.db. Остальные
// экспорты модуля — настоящие: подменяется ровно фабрика соединения.
vi.mock('./db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./db')>()),
  createDb: vi.fn(),
}))

/**
 * Два предохранителя окружения. Оба про один и тот же класс ошибки: молчаливую
 * подстановку небезопасного значения по умолчанию там, где отсутствие
 * переменной обязано быть отказом.
 */

const ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ENV }
})

describe('sessionSecret', () => {
  test('в проде без переменной — отказ, а не заглушка', () => {
    process.env = { ...ENV, NODE_ENV: 'production' }
    delete process.env.SESSION_SECRET
    expect(() => sessionSecret()).toThrow(/SESSION_SECRET/)
  })

  test('на Vercel без переменной — тоже отказ, даже если NODE_ENV не production', () => {
    process.env = { ...ENV, VERCEL: '1', NODE_ENV: 'development' }
    delete process.env.SESSION_SECRET
    expect(() => sessionSecret()).toThrow(/SESSION_SECRET/)
  })

  test('заданный секрет побеждает везде', () => {
    process.env = { ...ENV, NODE_ENV: 'production', SESSION_SECRET: 'достаточно-длинный-секрет' }
    expect(sessionSecret()).toBe('достаточно-длинный-секрет')
  })

  test('локально работает без секрета — иначе разработку не начать', () => {
    process.env = { ...ENV, NODE_ENV: 'development' }
    delete process.env.SESSION_SECRET
    delete process.env.VERCEL
    expect(sessionSecret()).toBeTruthy()
  })
})

/**
 * Демо-игрок был одной константой на всех, а по steamid ключуется всё: баны,
 * фидбек, снапшот, портрет, членство в комнате. Любой нажавший «🚫» убирал игру
 * из демо навсегда и для всех, а двое зашедших одновременно оказывались одним
 * участником комнаты.
 */
describe('демо-личность', () => {
  test('семнадцать цифр — иначе не пройдёт ни подпись сессии, ни маршруты', () => {
    for (const v of [1, 2] as const) {
      const id = demoSteamId(v)
      expect(id, `вариант ${v}`).toMatch(/^\d{17}$/)
    }
  })

  test('у каждого посетителя своя', () => {
    const ids = new Set(Array.from({ length: 200 }, () => demoSteamId(1)))
    // 13 знаков случайности — совпадений на двух сотнях быть не должно
    expect(ids.size).toBe(200)
  })

  test('«демо-друг» встаёт в пару со своим игроком, а не со случайным чужим', () => {
    const me = demoSteamId(1)
    const friend = demoSteamId(2, me)

    expect(friend).not.toBe(me)
    // общая основа, разный вариант — это один посетитель, два участника
    expect(friend.slice(0, 16)).toBe(me.slice(0, 16))
    expect(friend.endsWith('2')).toBe(true)
  })

  test('без текущей сессии друг получает свою основу, а не чужую', () => {
    expect(demoSteamId(2, null).slice(0, 16)).not.toBe(demoSteamId(2, null).slice(0, 16))
  })

  test('настоящий steamid демо-основой не становится', () => {
    const real = '76561198000000001'
    expect(isDemoId(real)).toBe(false)
    // из настоящей сессии основа не переиспользуется — иначе демо-друг
    // унаследовал бы кусок чужого steamid
    expect(demoSteamId(2, real).slice(0, 3)).toBe('000')
  })

  test('старые демо-сессии продолжают опознаваться', () => {
    // константы, жившие в продакшене до этой правки
    expect(isDemoId('00000000000000000')).toBe(true)
    expect(isDemoId('00000000000000001')).toBe(true)
  })

  test('префикс 000 не пересекается с настоящими SteamID64', () => {
    // диапазон Valve начинается с 7656119…, так что первая цифра никогда не 0
    expect(isDemoId('76561197960265728')).toBe(false)
    expect(isDemoId('00000000000000000')).toBe(true)
  })
})

describe('кука сессии', () => {
  test('httpOnly и sameSite стоят всегда', () => {
    const o = sessionCookieOptions()
    expect(o.httpOnly).toBe(true)
    expect(o.sameSite).toBe('lax')
  })

  test('secure в проде', () => {
    process.env = { ...ENV, NODE_ENV: 'production' }
    expect(sessionCookieOptions().secure).toBe(true)
  })

  test('secure выключен локально: на http://localhost браузер такую куку не примет', () => {
    process.env = { ...ENV, NODE_ENV: 'development' }
    delete process.env.VERCEL
    expect(sessionCookieOptions().secure).toBe(false)
  })

  test('secure и на превью-деплое, где NODE_ENV не production', () => {
    // Регрессия: secure смотрел только на NODE_ENV, в отличие от sessionSecret
    // и getDb, и превью раздавал куку без Secure.
    process.env = { ...ENV, VERCEL: '1', NODE_ENV: 'development' }
    expect(sessionCookieOptions().secure).toBe(true)
  })

  test('срок — год: вход не должен умирать сам по себе', () => {
    expect(sessionCookieOptions().maxAge).toBe(60 * 60 * 24 * 365)
  })
})

/**
 * Кэш соединения хранит ПРОМИС, и раньше хранил его и отклонённым: одна
 * неудача миграции на холодном старте (обрыв до Turso, SQLITE_BUSY у файла)
 * отвечала ошибкой на каждый следующий запрос этого инстанса, хотя база уже
 * поднялась, — до самой его переработки.
 */
describe('getDb', () => {
  const store = globalThis as typeof globalThis & { __imboredDb?: Promise<Db> }
  const create = vi.mocked(createDb)

  function remote() {
    // удалённая ветка: локальная полезла бы создавать data/ в рабочей папке
    process.env = { ...ENV, TURSO_DATABASE_URL: 'libsql://test.invalid' }
  }

  afterEach(() => {
    store.__imboredDb = undefined
    create.mockReset()
    vi.restoreAllMocks()
  })

  test('после сбоя на старте следующий запрос подключается заново', async () => {
    remote()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = {} as Db
    create
      .mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'))
      .mockResolvedValueOnce(db)

    await expect(getDb()).rejects.toThrow(/SQLITE_BUSY/)
    expect(await getDb()).toBe(db)
    expect(create).toHaveBeenCalledTimes(2)
  })

  test('сбой оставляет в логе одну строку с причиной', async () => {
    remote()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    create.mockRejectedValueOnce(new Error('обрыв до Turso '.repeat(40)))

    await expect(getDb()).rejects.toThrow()
    expect(log).toHaveBeenCalledTimes(1)
    const line = JSON.parse(String(log.mock.calls[0][0]))
    expect(line.event).toBe('db-init-failed')
    expect(line.message).toContain('обрыв до Turso')
    // сообщение драйвера бывает простынёй — в строку лога идёт начало
    expect(line.message.length).toBeLessThanOrEqual(200)
  })

  test('удачное подключение живёт на процесс: миграции один раз за холодный старт', async () => {
    remote()
    create.mockResolvedValue({} as Db)

    const [a, b] = await Promise.all([getDb(), getDb()])
    await getDb()
    expect(a).toBe(b)
    expect(create).toHaveBeenCalledTimes(1)
  })

  test('отказ старого промиса не стирает занявший слот новый', async () => {
    remote()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let fail!: (e: Error) => void
    create.mockReturnValueOnce(new Promise<Db>((_, reject) => (fail = reject)))

    const first = getDb()
    // слот уже занят другим промисом — так кладут подменную базу тесты
    // страниц игр, и так же выглядит гонка с параллельным подключением
    const fresh = Promise.resolve({} as Db)
    store.__imboredDb = fresh
    fail(new Error('поздний отказ'))

    await expect(first).rejects.toThrow('поздний отказ')
    expect(store.__imboredDb).toBe(fresh)
  })
})
