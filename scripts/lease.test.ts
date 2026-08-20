import { describe, expect, test, vi } from 'vitest'
import { acquireLease, createDb, DIGEST_LEASE, releaseLease, STEAM_LEASE } from '../lib/db'
import { withLease } from './lease'

/** Настоящие часы: withLease берёт их же, а не подставное время теста */
const сейчас = () => Math.floor(Date.now() / 1000)
const freshDb = () => createDb(':memory:')

/** Занял ли ключ кто-то посторонний — проверяем попыткой взять его чужим holder */
async function свободен(db: Awaited<ReturnType<typeof freshDb>>, key: string): Promise<boolean> {
  const got = await acquireLease(db, key, 'проверка', 10, сейчас())
  if (got) await releaseLease(db, key, 'проверка')
  return got
}

describe('аренда вокруг ручного прогона', () => {
  test('тело выполняется, ключ отдаётся после', async () => {
    const db = await freshDb()
    let звали = 0

    const res = await withLease(db, STEAM_LEASE, { busyNote: 'занято' }, async () => {
      звали++
      expect(await свободен(db, STEAM_LEASE)).toBe(false)
      return 'готово'
    })

    expect(звали).toBe(1)
    expect(res).toBe('готово')
    expect(await свободен(db, STEAM_LEASE)).toBe(true)
  })

  test('ключ занят — тело не трогаем и возвращаем null', async () => {
    const db = await freshDb()
    await acquireLease(db, STEAM_LEASE, 'крон', 300, сейчас())
    const тихо = vi.spyOn(console, 'log').mockImplementation(() => {})

    let звали = 0
    const res = await withLease(db, STEAM_LEASE, { busyNote: 'занято' }, async () => {
      звали++
      return 'готово'
    })

    expect(звали).toBe(0)
    expect(res).toBeNull()
    тихо.mockRestore()
  })

  test('второй ключ занят — первый обязаны отпустить, а не держать', async () => {
    const db = await freshDb()
    await acquireLease(db, DIGEST_LEASE, 'крон-пересказов', 300, сейчас())
    const тихо = vi.spyOn(console, 'log').mockImplementation(() => {})

    const res = await withLease(db, [STEAM_LEASE, DIGEST_LEASE], { busyNote: 'занято' }, async () => 'готово')

    expect(res).toBeNull()
    // Вот ради чего тест: STEAM_LEASE мы успели взять до отказа на втором.
    // Оставь мы его висеть — прогон, не сделавший ни одной строки работы,
    // запирал бы крон новостей на весь TTL.
    expect(await свободен(db, STEAM_LEASE)).toBe(true)
    тихо.mockRestore()
  })

  test('исключение в теле аренду не оставляет', async () => {
    const db = await freshDb()
    await expect(
      withLease(db, [STEAM_LEASE, DIGEST_LEASE], { busyNote: 'занято' }, async () => {
        throw new Error('срез упал')
      }),
    ).rejects.toThrow('срез упал')

    expect(await свободен(db, STEAM_LEASE)).toBe(true)
    expect(await свободен(db, DIGEST_LEASE)).toBe(true)
  })
})
