import fs from 'node:fs'
import path from 'node:path'
import Link from '@/components/Link'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { PatchShare } from '@/components/PatchShare'
import { setNewsDigest, setNewsDigestEn, upsertGameMeta, upsertNewsItems, type Db, type StoredNews } from '@/lib/db'
import { ldScript, patchArticleLd, patchBreadcrumbLd } from '@/lib/jsonld'
import { newsHeading } from '@/lib/newspage'
import { appBaseUrl, nowSec } from '@/lib/server'
import { flight as flightOf, islandsOf, textOf } from '@/lib/testing/flight'
import { freshDb } from '@/lib/testing/route'
import { loadPatch, patchHeading } from './load'
import PatchPage, { generateMetadata, revalidate } from './page'

vi.mock('next/headers', () => import('@/lib/testing/headers'))
/** Размеры карточки читаются у её модуля; рисовать её здесь незачем */
vi.mock('next/og', () => ({ ImageResponse: class {} }))

/**
 * Мост «а у меня?» со страницы патча.
 *
 * Пересказ патча — вторая по пересылаемости ссылка после выбора на вечер
 * (PatchShare делится ею с меткой ref), а нижняя строка страницы вела только
 * в игру, в Steam и к соседним патчам этой же игры. Пришедший по ссылке
 * прочитал, что изменилось в чужой игре, — и ниоткуда не узнавал, что то же
 * самое здесь собирают по его собственной библиотеке. Ссылка на «Что нового»
 * — одна строка, серверная, без скрипта.
 *
 * Страница при этом остаётся одной на всех: она в ISR на сутки, и мост не
 * знает, кто смотрит. Гостя /whatsnew не разворачивает — показывает общую
 * ленту и сам зовёт подключить Steam, — так что и сессии здесь читать
 * незачем. Сторож ниже держит это правило в исходнике: чтение куки сделало
 * бы страницу динамической, и сутки кэша молча кончились бы.
 */

const APPID = 730
const GID = '5123894512345'

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

const ISLANDS = new Map<unknown, string>([
  [Link, 'Link'],
  [GameArt, 'GameArt'],
  [PatchShare, 'PatchShare'],
])

function patch(gid: string, publishedAt: number): StoredNews {
  return {
    appid: APPID,
    gid,
    title: `Обновление ${gid}`,
    url: `https://store.steampowered.com/news/app/${APPID}/view/${gid}`,
    publishedAt,
    kind: 'patch',
    scale: 'major',
    blocks: [{ kind: 'p', runs: [{ text: 'Починили сеть' }] }],
    bodyHash: `h${gid}`,
    rank: 9000,
  }
}

async function render(): Promise<unknown> {
  const now = nowSec()
  await upsertGameMeta(
    db,
    {
      appid: APPID,
      name: 'Counter-Strike 2',
      tags: {},
      genres: [],
      categories: [],
      reviewsTotal: 1000,
      reviewsPercent: 80,
    },
    now,
  )
  await upsertNewsItems(db, [patch(GID, now - 3600)], now)
  await setNewsDigest(db, APPID, GID, { tldr: 'Починили сеть.', scale: 'major' }, now)
  return flightOf(await PatchPage({ params: Promise.resolve({ appid: String(APPID), gid: GID }) }), ISLANDS)
}

describe('страница патча: мост к своей ленте', () => {
  test('ведёт в «Что нового» — по играм своей библиотеки', async () => {
    const links = islandsOf(await render(), 'Link').filter((l) => l.href === '/whatsnew')
    expect(links).toHaveLength(1)
    expect(textOf(links[0]?.children)).toBe('Что нового')
  })

  test('мост не читает сессию: страница остаётся в ISR на сутки', () => {
    expect(revalidate).toBe(86_400)
    // Без комментариев: докблоки как раз объясняют, почему здесь нет cookies()
    const src = fs
      .readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    expect(src).not.toMatch(/next\/headers|currentSession|cookies\(|headers\(\)|searchParams/)
  })
})

/**
 * Английская страница патча. Пересказ — только английский, тело — только
 * английское, русский заголовок издателя без перевода — «{Game} update»
 * (newsTitleOn); в индекс — только с английским пересказом. Русская страница
 * того же поста — прежняя.
 */
describe('страница патча на /en', () => {
  async function renderEn(withEnglish: boolean): Promise<unknown> {
    await render()
    // Соседний патч с русским заголовком — для «More … patches» внизу
    await upsertNewsItems(db, [patch('5123894512300', nowSec() - 3 * 86_400)], nowSec())
    if (withEnglish) await setNewsDigestEn(db, APPID, GID, { tldrEn: 'Fixed the netcode.' }, nowSec())
    return flightOf(
      await PatchPage({ params: Promise.resolve({ appid: String(APPID), gid: GID, lang: 'en' }) }),
      ISLANDS,
    )
  }

  test('ни слова по-русски: «In short», запасной заголовок и строка вместо русского тела', async () => {
    const text = textOf(await renderEn(true))
    expect(text).toContain('In short')
    expect(text).toContain('Fixed the netcode.')
    expect(text).toContain('Update')
    expect(text).toContain("We don't have these patch notes in English")
    expect(text).toContain('More Counter-Strike 2 patches')
    expect(text).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('без английского пересказа блока «In short» нет — русский не подставляется', async () => {
    const text = textOf(await renderEn(false))
    expect(text).not.toContain('In short')
    expect(text).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('мост ведёт в «What\'s new» одной фразой', async () => {
    const tree = await renderEn(true)
    const links = islandsOf(tree, 'Link').filter((l) => l.href === '/whatsnew')
    expect(links).toHaveLength(1)
    expect(textOf(links[0]?.children)).toBe("What's new")
    expect(textOf(tree)).toContain("What changed in your games? What's new has the major patches from your library in one feed.")
  })

  test('метаданные: английский заголовок и описание, noindex без английского пересказа', async () => {
    await render()
    const en = { params: Promise.resolve({ appid: String(APPID), gid: GID, lang: 'en' }) }
    const ru = { params: Promise.resolve({ appid: String(APPID), gid: GID }) }
    const without = await generateMetadata(en)
    expect(without.robots).toEqual({ index: false, follow: true })
    expect(String(without.title)).toMatch(/^Counter-Strike 2: Update \([A-Z][a-z]{2} \d{1,2}, \d{4}\) — what changed$/)
    expect(String(without.description)).not.toMatch(/[А-Яа-яЁё]/)
    // Русская страница того же поста — с русским пересказом, как была
    const ruMeta = await generateMetadata(ru)
    expect(ruMeta.description).toBe('Починили сеть.')
    expect(String(ruMeta.title)).toContain('— что изменилось')

    await setNewsDigestEn(db, APPID, GID, { tldrEn: 'Fixed the netcode.' }, nowSec())
    const withEn = await generateMetadata(en)
    expect(withEn.description).toBe('Fixed the netcode.')
    expect(withEn.robots).toEqual(ruMeta.robots)
    expect(withEn.alternates?.canonical).toBe(`/en/game/${APPID}/news/${GID}`)
  })
})

/** JSON-LD страницы, как он уходит в HTML */
function ldOf(tree: unknown): string {
  let html: string | undefined
  const walk = (node: unknown): void => {
    if (html !== undefined || !node || typeof node !== 'object') return
    const inner = (node as { dangerouslySetInnerHTML?: { __html?: unknown } }).dangerouslySetInnerHTML
    if (typeof inner?.__html === 'string') {
      html = inner.__html
      return
    }
    Object.values(node).forEach(walk)
  }
  walk(tree)
  expect(html, 'ld+json на странице не найден').toBeDefined()
  return html!
}

/** Текст первого элемента с этим тегом */
function tagText(tree: unknown, tag: string): string | undefined {
  let found: unknown
  const walk = (node: unknown): void => {
    if (found !== undefined || !node || typeof node !== 'object') return
    if ((node as { tag?: string }).tag === tag) {
      found = node
      return
    }
    Object.values(node).forEach(walk)
  }
  walk(tree)
  return found === undefined ? undefined : textOf(found)
}

/**
 * Общий «{Game} update» — заголовок поста без своего английского. newsHeading
 * срезал бы с него название игры и оставил голое «Update» — в h1, на
 * карточке в чате, в headline и крошках. Русский двойник, «Обновление
 * Counter-Strike 2», цел: название в конце.
 */
describe('заголовок патча: общий «{Game} update» — целиком', () => {
  test('patchHeading режет название только у настоящего заголовка', () => {
    const ru = { title: 'Обновление 7.41d' }
    expect(patchHeading(ru, 'Dota 2', 'en')).toBe('Dota 2 update')
    expect(patchHeading(ru, null, 'en')).toBe('Update')
    // Свой английский заголовок с названием впереди режется, как на русской странице
    expect(patchHeading({ ...ru, titleEn: 'Dota 2 - Update 7.41d' }, 'Dota 2', 'en')).toBe('Update 7.41d')
    expect(patchHeading({ title: 'Portal 2 - Update' }, 'Portal 2', 'en')).toBe('Update')
    // Русская страница — ровно newsHeading, как было
    for (const title of ['Обновление Counter-Strike 2', 'Portal 2 - Update', 'Counter-Strike 2 update', '']) {
      expect(patchHeading({ title }, 'Counter-Strike 2'), title).toBe(newsHeading(title, 'Counter-Strike 2'))
    }
  })

  test('/en: h1, headline и последняя крошка — «Counter-Strike 2 update»', async () => {
    await render()
    const tree = flightOf(
      await PatchPage({ params: Promise.resolve({ appid: String(APPID), gid: GID, lang: 'en' }) }),
      ISLANDS,
    )
    expect(tagText(tree, 'h1')).toBe('Counter-Strike 2 update')
    const [article, crumbs] = JSON.parse(ldOf(tree)) as [
      { headline: string },
      { itemListElement: Array<{ name: string }> },
    ]
    expect(article.headline).toBe('Counter-Strike 2 update')
    expect(crumbs.itemListElement.at(-1)?.name).toBe('Counter-Strike 2 update')
  })

  test('русская разметка — байт в байт то, что строит lib/jsonld', async () => {
    const tree = await render()
    const page = await loadPatch(String(APPID), GID)
    expect(page).not.toBeNull()
    const { item, game } = page!
    const baseUrl = appBaseUrl()
    expect(ldOf(tree)).toBe(
      ldScript([
        patchArticleLd({ item, game, baseUrl, locale: 'ru' }),
        patchBreadcrumbLd({ item, game, baseUrl, locale: 'ru' }),
      ]),
    )
    expect(tagText(tree, 'h1')).toBe(`Обновление ${GID}`)
  })
})

/**
 * alt файловой карточки один на все языки, поэтому /en ставит свой images —
 * ту же карточку с английской подписью. Русская страница своего images не
 * задаёт: её картинка, размеры и alt — от файла, как были.
 */
describe('карточка патча в чате', () => {
  const en = { params: Promise.resolve({ appid: String(APPID), gid: GID, lang: 'en' }) }
  const ru = { params: Promise.resolve({ appid: String(APPID), gid: GID }) }

  test('/en — та же карточка с английским alt; twitter берёт её из openGraph', async () => {
    await render()
    const { size, contentType } = await import('./opengraph-image')
    const meta = await generateMetadata(en)
    expect(meta.openGraph?.images).toEqual([
      {
        url: `/en/game/${APPID}/news/${GID}/opengraph-image`,
        width: size.width,
        height: size.height,
        type: contentType,
        alt: 'What changed in this patch — imbored',
      },
    ])
    // Свои картинки у twitter отменили бы наследование от openGraph
    expect(meta.twitter).not.toHaveProperty('images')
  })

  test('русская страница своего images не задаёт — карточку ставит файл', async () => {
    await render()
    const meta = await generateMetadata(ru)
    expect(meta.openGraph).toBeDefined()
    expect(meta.openGraph).not.toHaveProperty('images')
    expect(meta.twitter).not.toHaveProperty('images')
  })
})
