import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { upsertGameMeta, type Db } from '@/lib/db'
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

const { default: Image, generateStaticParams, revalidate } = await import('./opengraph-image')

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

/*
 * Срок кэша карточки — до деплоя, а не сутки: стена постеров жанра стоит
 * неделями, а каждая перерисовка — ~785 КБ PNG, около ста блоков ISR Writes
 * (докблок revalidate в opengraph-image.tsx). На сборке её нет: пустой
 * список только регистрирует сегмент, без него маршрут был бы ƒ и рисовал
 * картинку на каждый заход.
 */
describe('кэш карточки жанра', () => {
  test('без срока перегенерации и без пререндера на сборке', async () => {
    expect(revalidate).toBe(false)
    expect(await generateStaticParams()).toEqual([])
  })
})

describe('карточка жанра и осечка базы', () => {
  /*
   * Карточка живёт в кэше без срока, до следующего деплоя. Пойманная ошибка
   * (стоял try/catch → null) заменяла бы стену постеров общей «Игры по
   * жанрам» на всё это время; брошенная не кэшируется, и следующий запрос
   * рисует заново. loadGenre сам бросает только вне сборки, а на сборке эта
   * карточка не рисуется вовсе (пустой generateStaticParams).
   */
  test('ошибка базы уходит наружу — сбой не ляжет в кэш вместо карточки', async () => {
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

  // Постеры стены карточка тянет по сети (ogPoster) — в тесте сети нет, стена пустая
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('сеть в тесте закрыта'))))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const cardText = async (tag: string, lang = 'ru') =>
    text(((await Image({ params: Promise.resolve({ lang, tag }) })) as unknown as { element: unknown }).element)

  /** Та же игра каталога, что под «с другом» в тестах ниже */
  const helldivers = () =>
    upsertGameMeta(
      db,
      {
        appid: 553850,
        name: 'HELLDIVERS 2',
        tags: { 'Online Co-Op': 1000, PvE: 896 },
        genres: [],
        categories: [1, 9, 38],
        headerImage: 'https://cdn.example/553850/header.jpg',
        reviewsTotal: 600_000,
        reviewsPercent: 80,
      },
      1_760_000_000,
    )

  /*
   * «Во что поиграть с другом» пересылают чаще любого жанра, и карточка
   * обязана назвать подборку, а не «жанр главный»: у кооператива жанра нет,
   * есть отметка Steam (lib/gamehub, HUB_FACETS). Список не пустой — иначе
   * тест проверял бы запасную строку, а не подпись подборки.
   */
  test('называет подборку и не говорит «жанр главный»', async () => {
    await helldivers()
    const all = await cardText('coop')
    expect(all).toContain('ПОДБОРКИ')
    expect(all).toContain('Кооперативные игры')
    expect(all).toContain('1 игра — по отзывам игроков Steam')
    expect(all).not.toContain('жанр главный')
  })

  /*
   * Пустая подборка — сборка без базы или «на 20 минут», которой ещё нечем
   * ответить. Запасная строка жанров («Тридцать жанров…») под «Играми на 20
   * минут» звала бы подборку жанром.
   */
  test('пустая подборка не называет себя «тридцатью жанрами»', async () => {
    const all = await cardText('short')
    expect(all).toContain('Игры на 20 минут')
    expect(all).toContain('Подборка собирается')
    expect(all).not.toContain('Тридцать жанров')
  })

  test('ошибка базы и у подборки уходит наружу — сбой не ляжет в кэш', async () => {
    queriesFail()
    await expect(render('coop')).rejects.toThrow(/timed out/)
  })

  /*
   * /en/games/coop — та же подборка: шапка «COLLECTIONS», заголовок
   * подборки по-английски (facetCopy) и подпись без «main tag» — у
   * кооператива жанра нет. Название игры — латиницей, так что кириллица
   * на карточке была бы только недоведённой подписью.
   */
  test('по-английски: подборка названа, без «main tag» и без кириллицы', async () => {
    await helldivers()
    const all = await cardText('coop', 'en')
    expect(all).toContain('COLLECTIONS')
    expect(all).toContain('Co-op games')
    expect(all).toContain('1 game, most-reviewed on Steam first')
    expect(all).not.toContain('main tag')
    expect(all).not.toMatch(/[А-Яа-яЁё]/)

    const empty = await cardText('short', 'en')
    expect(empty).toContain('20-minute games')
    expect(empty).toContain('Collection in the works')
    expect(empty).not.toContain('Thirty genres')
    expect(empty).not.toMatch(/[А-Яа-яЁё]/)
  })
})
