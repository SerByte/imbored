import type { ResolvingMetadata } from 'next'
import { describe, expect, test } from 'vitest'
import { generateMetadata as newRoomMetadata } from '../room/new/layout'
import { generateMetadata as roomsMetadata } from './layout'

/**
 * Подпись корневой карточки в превью /rooms и /room/new (docs/i18n.md, п. 10).
 *
 * Своей карточки у этих страниц нет — превью показывает корневую
 * (app/[lang]/opengraph-image.tsx), а её alt — русская константа модуля. На
 * /en страница берёт ту же карточку у родителя и переподписывает её
 * siteTitle('en'); русская openGraph не объявляет — голова прежняя до байта.
 */

const ROOT_CARD = {
  url: new URL('https://imbored.cc/en/opengraph-image?0123456789abcdef'),
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: 'imbored — во что поиграть',
}
const inherited = { images: [ROOT_CARD] }
const parent = Promise.resolve({ openGraph: inherited }) as unknown as ResolvingMetadata

const cases = [
  { path: '/rooms', meta: (lang?: string) => roomsMetadata({ params: Promise.resolve({ lang }) } as never, parent) },
  { path: '/room/new', meta: (lang?: string) => newRoomMetadata({ params: Promise.resolve({ lang }) } as never, parent) },
]

describe('корневая карточка в превью пати', () => {
  for (const { path, meta } of cases) {
    test(`${path}: по-русски — только заголовок и описание, как было`, async () => {
      for (const lang of [undefined, 'ru']) {
        const m = await meta(lang)
        expect(Object.keys(m).sort(), path).toEqual(['description', 'title'])
      }
    })

    test(`/en${path}: та же карточка, подпись — siteTitle('en'), свой адрес`, async () => {
      const m = await meta('en')
      expect(m.openGraph?.images).toEqual([{ ...ROOT_CARD, alt: 'imbored — what to play' }])
      expect(m.openGraph).toMatchObject({ url: `/en${path}`, locale: 'en_US', siteName: 'imbored', type: 'website' })
      expect(m.alternates).toEqual({ canonical: `/en${path}` })
      // twitter:image Next дозаполняет из openGraph сам
      expect(m).not.toHaveProperty('twitter')
      expect(JSON.stringify(m)).not.toMatch(/[А-Яа-яЁё]/)
    })
  }
})
