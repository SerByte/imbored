import { beforeEach, describe, expect, test, vi } from 'vitest'
import { saveLibrarySnapshot, upsertUser } from '@/lib/db'
import { freshDb, params } from '@/lib/testing/route'
import type { LibraryGame } from '@/lib/types'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

const { generateMetadata: portraitMeta } = await import('./page')
const { generateMetadata: yearMeta } = await import('./year/page')

/**
 * Метаданные портрета и итогов года: заголовок вкладки и превью ссылки.
 *
 * Их видят раньше страницы — в чате, куда ссылку прислали, и в табе. На /en
 * там не должно остаться ни русского alt файловой картинки, ни заголовка,
 * где «player» стоит дважды подряд у самых частых имён: «Demo player» и
 * «Player 1234». Русская страница — прежняя, до объекта.
 */

const CYRILLIC = /[А-Яа-яЁё]/
const PLAYER = '76561198000000001'
const NAMELESS = '76561198000000002'
const DEMO = '00000000000000000'
const AT = Date.UTC(2026, 7, 14) / 1000

const library: LibraryGame[] = [
  { appid: 570, name: 'Dota 2', playtimeForever: 144_000, playtime2Weeks: 0 },
  { appid: 504230, name: 'Celeste', playtimeForever: 0, playtime2Weeks: 0 },
]

beforeEach(async () => {
  const db = await freshDb()
  await upsertUser(db, { steamid: PLAYER, personaName: 'Вася' }, AT)
  await upsertUser(db, { steamid: DEMO, personaName: 'Демо-игрок' }, AT)
  for (const steamid of [PLAYER, NAMELESS, DEMO]) await saveLibrarySnapshot(db, steamid, library, AT)
})

const meta = (fn: typeof portraitMeta, steamid: string, lang: string) => fn(params({ steamid, lang }))

describe('битый steamid', () => {
  test('русская страница своих метаданных не объявляет — как была', async () => {
    expect(await meta(portraitMeta, '123', 'ru')).toEqual({})
    expect(await meta(yearMeta, '123', 'ru')).toEqual({})
  })

  test('на /en — картинка под /en с английским alt, без русского текста', async () => {
    for (const [fn, path, alt] of [
      [portraitMeta, '/en/portrait/123/opengraph-image', 'Player portrait — imbored'],
      [yearMeta, '/en/portrait/123/year/opengraph-image', 'Year in review — imbored'],
    ] as const) {
      const m = await meta(fn, '123', 'en')
      expect(m.openGraph?.images).toEqual([{ url: path, width: 1200, height: 630, type: 'image/png', alt }])
      // og:url нет, как у корня: у битого адреса его нет и на русской
      expect(m.openGraph).not.toHaveProperty('url')
      expect(JSON.stringify(m)).not.toMatch(CYRILLIC)
    }
  })
})

describe('заголовок портрета', () => {
  test('по-английски ник — после тире, «player» не стоит дважды подряд', async () => {
    const titles = await Promise.all([DEMO, NAMELESS].map(async (id) => (await meta(portraitMeta, id, 'en')).title))
    expect(titles).toEqual(['Player portrait — Demo player', 'Player portrait — Player 0002'])
    for (const t of titles) expect(t).not.toMatch(/player'?s? player/i)
    const m = await meta(portraitMeta, PLAYER, 'en')
    expect([m.title, m.openGraph?.title, m.twitter?.title]).toEqual(Array(3).fill('Player portrait — Вася'))
  })

  test('по-русски — прежний', async () => {
    const m = await meta(portraitMeta, PLAYER, 'ru')
    expect([m.title, m.openGraph?.title, m.twitter?.title]).toEqual(Array(3).fill('Портрет игрока Вася'))
  })

  test('итоги года — тем же порядком, что и были', async () => {
    expect((await meta(yearMeta, DEMO, 'en')).title).toBe('Year in review — Demo player')
    expect((await meta(yearMeta, PLAYER, 'ru')).title).toBe('Итоги года — Вася')
  })
})
