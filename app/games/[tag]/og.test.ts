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

const render = (tag: string) => Image({ params: Promise.resolve({ tag }) })

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

describe('карточка подборки', () => {
  /** Весь текст дерева карточки подряд — шапка, заголовок, подпись */
  const text = (node: unknown): string => {
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(text).join(' ')
    if (node && typeof node === 'object' && 'props' in node) {
      return text((node as { props: { children?: unknown } }).props.children)
    }
    return ''
  }

  /*
   * «Во что поиграть с другом» пересылают чаще любого жанра, и карточка
   * обязана назвать подборку, а не «жанр главный»: у кооператива жанра нет,
   * есть отметка Steam (lib/gamehub, HUB_FACETS).
   */
  test('называет подборку и не говорит «жанр главный»', async () => {
    const card = (await render('coop')) as unknown as { element: unknown }
    const all = text(card.element)
    expect(all).toContain('ПОДБОРКИ')
    expect(all).toContain('Кооперативные игры')
    expect(all).not.toContain('жанр главный')
  })

  test('ошибка базы и у подборки уходит наружу — ISR оставит прошлую карточку', async () => {
    queriesFail()
    await expect(render('coop')).rejects.toThrow(/timed out/)
  })
})
