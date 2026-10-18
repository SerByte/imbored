import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Db } from '@/lib/db'
import { freshDb } from '@/lib/testing/route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/** satori и resvg не нужны — карточка только запоминает дерево */
vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(
      public element: unknown,
      public init: unknown,
    ) {}
  },
}))

const { default: Image } = await import('./opengraph-image')

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

/** База отвечает, но запрос падает — так выглядит таймаут Turso посреди перегенерации */
function queriesFail(): void {
  const timeout = () => Promise.reject(new Error('Turso: operation timed out'))
  db.execute = timeout as Db['execute']
  db.batch = timeout as Db['batch']
}

const render = (appid: string, gid: string) => Image({ params: Promise.resolve({ lang: 'ru', appid, gid }) })

describe('карточка патча и осечка базы', () => {
  /*
   * Сутки ISR. Пойманная ошибка (стоял try/catch → null) заменяла карточку с
   * заголовком и пересказом нейтральной «Что изменилось в играх» на весь
   * день; брошенная оставляет в кэше прошлую.
   */
  test('ошибка базы уходит наружу — ISR оставит прошлую карточку', async () => {
    queriesFail()
    await expect(render('730', '5123894512345')).rejects.toThrow(/timed out/)
  })

  test('поста нет — по-прежнему нейтральная карточка, а не ошибка', async () => {
    await expect(render('730', '5123894512345')).resolves.toBeDefined()
    // кривой gid отсекается до базы
    await expect(render('730', '../x')).resolves.toBeDefined()
  })
})
