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

const render = (tag: string) => Image({ params: Promise.resolve({ lang: 'ru', tag }) })

describe('карточка жанра и осечка базы', () => {
  /*
   * Карточка живёт на ISR сутки. Пойманная ошибка (стоял try/catch → null)
   * заменяла стену постеров общей «Игры по жанрам» на весь день; брошенная
   * оставляет в кэше прошлую карточку. loadGenre сам бросает только вне
   * сборки, а на сборке эта карточка не рисуется вовсе (пустой
   * generateStaticParams).
   */
  test('ошибка базы уходит наружу — ISR оставит прошлую карточку', async () => {
    queriesFail()
    await expect(render('roguelike')).rejects.toThrow(/timed out/)
  })

  test('незнакомый жанр — по-прежнему нейтральная карточка, а не ошибка', async () => {
    await expect(render('no-such-genre')).resolves.toBeDefined()
  })
})

describe('английская карточка жанра', () => {
  /*
   * Порядок полки — по числу отзывов, а не по их доле, и подпись говорит
   * так же, как страница («most-reviewed first»), а не «ranked by reviews».
   */
  test('подписи по-английски, без кириллицы', async () => {
    const card = (await Image({ params: Promise.resolve({ lang: 'en', tag: 'no-such-genre' }) })) as unknown as {
      element: unknown
    }
    const tree = JSON.stringify(card.element)
    expect(tree).toContain('IMBORED.CC · GAMES BY GENRE')
    expect(tree).toContain('Games by genre')
    expect(tree).toContain('Thirty genres, most-reviewed games first')
    expect(tree).not.toMatch(/[А-Яа-яЁё]/)
  })
})
