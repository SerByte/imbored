import { beforeEach, describe, expect, test, vi } from 'vitest'
import { setNewsDigest, setNewsDigestEn, upsertNewsItems, type Db } from '@/lib/db'
import { freshDb } from '@/lib/testing/route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/** satori и resvg не нужны — карточка только запоминает дерево */
vi.mock('next/og', () => ({
  ImageResponse: class {
    /** Тот же заголовок, что ставит настоящий next/og: его снимает isrImage */
    headers = new Headers({ 'content-type': 'image/png', 'cache-control': 'public, max-age=0, must-revalidate' })
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

/** Текст карточки: строки из children дерева, которое запомнил ImageResponse */
function cardText(card: unknown): string {
  const walk = (n: unknown): string => {
    if (typeof n === 'string' || typeof n === 'number') return `${n}\n`
    if (Array.isArray(n)) return n.map(walk).join('')
    if (n && typeof n === 'object' && 'props' in n) return walk((n as { props: { children?: unknown } }).props.children)
    return ''
  }
  return walk((card as { element: unknown }).element)
}

describe('карточка патча на языке адреса', () => {
  const NOW = 1_760_000_000
  async function seed(): Promise<void> {
    // Игры нет в каталоге — карточка без арта, в Steam за ним не ходим
    await upsertNewsItems(
      db,
      [
        {
          appid: 730,
          gid: '5123894512345',
          title: 'Обновление Counter-Strike 2',
          url: 'https://store.steampowered.com/news/app/730/view/5123894512345',
          publishedAt: NOW,
          kind: 'patch',
          scale: 'major',
          blocks: [{ kind: 'p', runs: [{ text: 'Починили сеть' }] }],
          bodyHash: 'h',
          rank: 9000,
        },
      ],
      NOW,
    )
    await setNewsDigest(db, 730, '5123894512345', { tldr: 'Починили сеть.', scale: 'major' }, NOW)
    await setNewsDigestEn(db, 730, '5123894512345', { tldrEn: 'Fixed the netcode.' }, NOW)
  }

  test('/en: английский пересказ, «WHAT CHANGED», дата по-английски — без кириллицы', async () => {
    await seed()
    const text = cardText(await Image({ params: Promise.resolve({ lang: 'en', appid: '730', gid: '5123894512345' }) }))
    expect(text).toContain('WHAT CHANGED')
    expect(text).toContain('Fixed the netcode.')
    expect(text).toContain('Patch · October 9, 2025')
    expect(text).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('русская карточка — прежняя', async () => {
    await seed()
    const text = cardText(await render('730', '5123894512345'))
    expect(text).toContain('ЧТО ИЗМЕНИЛОСЬ')
    expect(text).toContain('Починили сеть.')
    expect(text).toContain('Патч · 9 октября 2025 г.')
  })

  test('поста нет — нейтральная карточка своего языка', async () => {
    const text = cardText(await Image({ params: Promise.resolve({ lang: 'en', appid: '730', gid: '5123894512345' }) }))
    expect(text).toContain('What changed in games')
    expect(text).not.toMatch(/[А-Яа-яЁё]/)
  })
})
