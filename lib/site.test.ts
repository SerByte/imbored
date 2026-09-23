import fs from 'node:fs'
import path from 'node:path'
import type { ResolvingMetadata } from 'next'
import { describe, expect, test } from 'vitest'
import { DESTINATIONS } from './destination'
import { OG_SITE, ownAddress } from './site'

/** Родительская метадата в том виде, в каком её отдаёт Next: уже разобранная. */
function parent(images?: Array<{ url: string }>): ResolvingMetadata {
  return Promise.resolve({ openGraph: images ? { images } : null }) as unknown as ResolvingMetadata
}

const ROOT_CARD = [{ url: 'https://imbored.cc/opengraph-image?7a1c', width: 1200, height: 630 }]

describe('ownAddress', () => {
  test('canonical и og:url — адрес самой страницы', async () => {
    const meta = await ownAddress('/privacy', { title: 'Конфиденциальность' })(null, parent(ROOT_CARD))
    expect(meta.title).toBe('Конфиденциальность')
    expect(meta.alternates?.canonical).toBe('/privacy')
    expect(meta.openGraph).toMatchObject({ ...OG_SITE, type: 'website', url: '/privacy' })
  })

  /**
   * Свой openGraph заменяет корневой целиком, вместе с картинкой из
   * app/opengraph-image.tsx. Без проброса страница уходила бы в чат без
   * og:image — хуже, чем с чужим og:url.
   */
  test('корневая карточка переезжает из родителя как есть', async () => {
    const meta = await ownAddress('/whatsnew')(null, parent(ROOT_CARD))
    expect(meta.openGraph?.images).toEqual(ROOT_CARD)
  })

  test('нет карточки у родителя — нет и пустого images', async () => {
    const meta = await ownAddress('/support')(null, parent())
    expect(meta.openGraph).not.toHaveProperty('images')
    const empty = await ownAddress('/support')(null, parent([]))
    expect(empty.openGraph).not.toHaveProperty('images')
  })

  test('title и description openGraph не пишет: Next подставит страничные с шаблоном', async () => {
    const meta = await ownAddress('/daily', { title: 'Игра дня', description: 'Одна игра' })(null, parent(ROOT_CARD))
    expect(meta.openGraph).not.toHaveProperty('title')
    expect(meta.openGraph).not.toHaveProperty('description')
    expect(meta.description).toBe('Одна игра')
  })

  test('свои alternates страницы не теряются, canonical — всегда свой', async () => {
    const meta = await ownAddress('/whatsnew', {
      alternates: { canonical: '/elsewhere', types: { 'application/rss+xml': '/feed.xml' } },
    })(null, parent())
    expect(meta.alternates?.canonical).toBe('/whatsnew')
    expect(meta.alternates?.types).toEqual({ 'application/rss+xml': '/feed.xml' })
  })
})

/** Исходник без комментариев: объяснение правки в комментарии — не текст интерфейса. */
function visible(rel: string): string {
  return fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('обещание продукта одно', () => {
  /**
   * Главная обещает одну игру и объяснение, почему она. Соседние тексты
   * отставали: последний экран той же главной говорил «три вопроса и пять
   * карточек», гость, развёрнутый с /play, читал «Подборка собирается…», а
   * вкладка /play называлась «Подборка», хотя на экране одна игра.
   */
  test('вокруг /play не обещаем подборку и пять карточек', () => {
    for (const rel of [
      'components/landing/scenes/Money.tsx',
      'lib/destination.ts',
      'app/play/layout.tsx',
      'app/manifest.ts',
    ]) {
      expect(visible(rel), rel).not.toMatch(/пять карточек|Подборк|из бэклога, заброшенного или нового/)
    }
  })

  test('гость, развёрнутый с /play, читает про одну игру', () => {
    expect(DESTINATIONS['/play'].promise).toMatch(/^Одна игра/)
  })
})
