import type { ResolvingMetadata } from 'next'
import { describe, expect, test, vi } from 'vitest'
import { generateMetadata } from './page'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Хаб /compat своей карточки не рисует: превью — корневая, а её alt — русская
 * константа файла (app/[lang]/opengraph-image.tsx). Английская страница
 * переподписывает её своим openGraph (docs/i18n.md, п. 10); русская своего
 * openGraph не объявляет и остаётся прежней до байта.
 */
describe('/compat: метаданные', () => {
  const rootCard = {
    url: 'http://localhost/en/opengraph-image?7a1c',
    width: 1200,
    height: 630,
    type: 'image/png',
    alt: 'imbored — во что поиграть',
  }
  const inherited = { images: [rootCard] }
  const parent = Promise.resolve({ openGraph: inherited }) as unknown as ResolvingMetadata
  const meta = (lang?: string) =>
    generateMetadata(
      { params: Promise.resolve(lang ? { lang } : {}), searchParams: Promise.resolve({}) } as PageProps<'/[lang]/compat'>,
      parent,
    )

  test('на /en — английские вкладка и подпись превью, та же картинка', async () => {
    const en = await meta('en')
    expect(en).toMatchObject({
      title: 'Compatibility',
      description: 'Your taste match, based on real libraries and playtime — and what to play together.',
    })
    expect(en.openGraph).toMatchObject({
      siteName: 'imbored',
      locale: 'en_US',
      url: '/en/compat',
      images: [{ ...rootCard, alt: 'imbored — what to play' }],
    })
    expect(JSON.stringify(en)).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('русская — прежний набор полей, без своего openGraph', async () => {
    const ru = {
      title: 'Совместимость',
      description: 'Процент совпадения игровых вкусов по реальным библиотекам и часам — и во что вам зайти вместе.',
    }
    expect(await meta()).toEqual(ru)
    expect(await meta('ru')).toEqual(ru)
  })
})
