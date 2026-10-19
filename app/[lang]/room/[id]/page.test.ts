import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createRoom, joinRoom } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb } from '@/lib/testing/route'
import { generateMetadata } from './page'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Подпись картинки превью комнаты (docs/i18n.md, п. 10).
 *
 * alt файловой карточки — константа модуля opengraph-image.tsx, и она
 * русская, как была до перевода: русская голова комнаты не меняется ни на
 * байт, без «нейтрального» голого «imbored». На /en страница объявляет свой
 * openGraph.images — ту же карточку того же адреса с английским alt, и Next
 * берёт его вместо файла; twitter:image он дозаполняет из openGraph сам.
 * Размеры и тип в page.tsx — копия: сменит карточка формат — тест поймает.
 */

const ROOM = 'ABC234'

const props = (lang: string | undefined, id = ROOM) =>
  ({ params: Promise.resolve(lang === undefined ? { id } : { id, lang }) }) as Parameters<typeof generateMetadata>[0]

beforeEach(async () => {
  const db = await freshDb()
  await createRoom(db, { id: ROOM, steamid: '76561190000000001' }, nowSec())
  await joinRoom(db, ROOM, '76561190000000001', 'Sergey', nowSec())
})

describe('подпись карточки превью комнаты', () => {
  test('русская подпись файла — прежняя, до буквы', async () => {
    const { alt } = await import('./opengraph-image')
    expect(alt).toBe('Приглашение в пати — imbored')
  })

  test('русская страница своего images не задаёт — карточку и её alt ставит файл', async () => {
    for (const lang of [undefined, 'ru']) {
      const meta = await generateMetadata(props(lang))
      expect(meta.openGraph).not.toHaveProperty('images')
      expect(meta.twitter).not.toHaveProperty('images')
    }
    // и у кода, которого не бывает, — без openGraph вовсе, как было
    expect(await generateMetadata(props('ru', 'abc'))).toEqual({
      title: 'Пати',
      robots: { index: false, follow: false },
    })
  })

  test('на /en — та же карточка маршрута, но с английским alt', async () => {
    const { size, contentType } = await import('./opengraph-image')
    const card = (id: string) => [
      { url: `/en/room/${id}/opengraph-image`, width: size.width, height: size.height, type: contentType, alt: 'Party invite — imbored' },
    ]
    const meta = await generateMetadata(props('en'))
    expect(meta.openGraph?.images).toEqual(card(ROOM))
    // twitter:image Next дозаполняет из openGraph сам — своего тут не нужно
    expect(meta.twitter).not.toHaveProperty('images')
    // Код в нижнем регистре — та же комната и та же карточка
    expect((await generateMetadata(props('en', 'abc234'))).openGraph?.images).toEqual(card(ROOM))
    // Кода не бывает — файл всё равно рисует билет «PARTY», и подпись английская
    const bad = await generateMetadata(props('en', 'abc'))
    expect(bad.openGraph?.images).toEqual(card('abc'))
    expect(bad.openGraph).toMatchObject({ url: '/en/room/abc', locale: 'en_US' })
    expect(JSON.stringify(bad)).not.toMatch(/[А-Яа-яЁё]/)
  })
})
