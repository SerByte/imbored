import { createElement, isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { saveLibrarySnapshot, upsertUser, type Db } from '@/lib/db'
import { freshDb } from '@/lib/testing/route'
import type { LibraryGame } from '@/lib/types'

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

/* Постеры — data-URI со Steam: в тесте сети нет, стена пустая */
vi.mock('@/lib/ogcard', async (orig) => ({ ...(await orig<typeof import('@/lib/ogcard')>()), postersOf: async () => [] }))

const { CardImage, loadCardData } = await import('./share-card')
const { YearCardImage, loadYearCardData } = await import('./year/share-card')
const { default: OgImage } = await import('./opengraph-image')
const { default: YearOgImage } = await import('./year/opengraph-image')

/**
 * Карточки портрета и итогов года на двух языках.
 *
 * Язык карточки — из адреса картинки (params.lang), и он обязан дойти до
 * каждой подписи: на /en/portrait/…/card.png русское «ПОРТРЕТ ИГРОКА» или
 * «в играх» — та же ошибка, что русская строка на английской странице, только
 * её уже отправили в чат картинкой. Русская карточка при этом — прежняя.
 */

const CYRILLIC = /[А-Яа-яЁё]/
const PLAYER = '76561198000000001'
const NAMELESS = '76561198000000002'
const DEMO = '00000000000000000'

const YEAR_START = Date.UTC(2026, 0, 5) / 1000
const NOW = Date.UTC(2026, 7, 14) / 1000

function library(extra: number): LibraryGame[] {
  return [
    { appid: 570, name: 'Dota 2', playtimeForever: 144_000 + extra, playtime2Weeks: 0 },
    { appid: 730, name: 'Counter-Strike 2', playtimeForever: 48_000 + extra, playtime2Weeks: 0 },
    { appid: 413150, name: 'Stardew Valley', playtimeForever: extra ? 600 : 0, playtime2Weeks: 0 },
    { appid: 504230, name: 'Celeste', playtimeForever: 0, playtime2Weeks: 0 },
  ]
}

let db: Db

beforeEach(async () => {
  db = await freshDb()
  for (const [steamid, personaName] of [
    [PLAYER, 'Вася'],
    [DEMO, 'Демо-игрок'],
  ] as const) {
    await upsertUser(db, { steamid, personaName }, YEAR_START)
  }
  // Два снимка в одном году: первый становится отметкой года, второй — итогом
  for (const steamid of [PLAYER, NAMELESS, DEMO]) {
    await saveLibrarySnapshot(db, steamid, library(0), YEAR_START)
    await saveLibrarySnapshot(db, steamid, library(3_000), NOW)
  }
})

/** Текст карточки — разметкой, как её прочтёт satori */
const textOf = (el: ReactElement) => renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ')

describe('карточка портрета', () => {
  test('по-английски — ни одной русской буквы, кроме ника', async () => {
    const data = (await loadCardData(PLAYER, 'en'))!
    for (const wide of [true, false]) {
      const text = textOf(createElement(CardImage, { data, wide }))
      expect(text).toContain('IMBORED.CC · PLAYER PORTRAIT')
      expect(text).toContain('games in library')
      expect(text).toContain('hours played')
      expect(text).toContain('Вася')
      expect(text.replace('Вася', ''), text).not.toMatch(CYRILLIC)
    }
    // Разряды — английские, а не неразрывный пробел русской записи
    expect(textOf(createElement(CardImage, { data, wide: true }))).toContain('3,310')
    expect(textOf(createElement(CardImage, { data, wide: false }))).toContain('74% of all playtime — “Dota 2”')
  })

  test('по-русски — прежние подписи', async () => {
    const text = textOf(createElement(CardImage, { data: (await loadCardData(PLAYER))!, wide: false }))
    expect(text).toContain('IMBORED.CC · ПОРТРЕТ ИГРОКА')
    expect(text).toContain('игры в библиотеке')
    // Разряды русской записи — неразрывный пробел
    expect(text).toContain('3 310')
    expect(text).toContain('74% всего времени — «Dota 2»')
  })

  test('ник: демо — на языке карточки, без ника — запасное имя языка', async () => {
    expect((await loadCardData(DEMO, 'en'))!.name).toBe('Demo player')
    expect((await loadCardData(DEMO, 'ru'))!.name).toBe('Демо-игрок')
    expect((await loadCardData(NAMELESS, 'en'))!.name).toBe('Player 0002')
    expect((await loadCardData(NAMELESS))!.name).toBe('Игрок 0002')
  })

  test('превью берёт язык из адреса', async () => {
    const res = (await OgImage({ params: Promise.resolve({ lang: 'en', steamid: PLAYER }) })) as unknown as {
      element: ReactElement
    }
    expect(isValidElement(res.element)).toBe(true)
    expect(textOf(res.element)).toContain('PLAYER PORTRAIT')
  })
})

describe('карточка итогов года', () => {
  test('по-английски — ни одной русской буквы, кроме ника', async () => {
    const data = (await loadYearCardData(PLAYER, 'en'))!
    expect(data).not.toBeNull()
    for (const wide of [true, false]) {
      const text = textOf(createElement(YearCardImage, { data, wide }))
      expect(text).toContain('2026 IN REVIEW')
      expect(text).toContain('played')
      expect(text).toContain('“Dota 2” — +50 h')
      expect(text).toContain('Based on library snapshots from January 5 to August 14')
      expect(text.replace('Вася', ''), text).not.toMatch(CYRILLIC)
    }
  })

  test('по-русски — прежние подписи', async () => {
    const text = textOf(createElement(YearCardImage, { data: (await loadYearCardData(PLAYER))!, wide: false }))
    expect(text).toContain('ИТОГИ 2026')
    expect(text).toContain('в играх')
    expect(text).toContain('«Dota 2» — +50 ч')
    expect(text).toContain('По снимкам библиотеки: с 5 января по 14 августа')
  })

  test('превью берёт язык из адреса', async () => {
    const res = (await YearOgImage({ params: Promise.resolve({ lang: 'en', steamid: DEMO }) })) as unknown as {
      element: ReactElement
    }
    const text = textOf(res.element)
    expect(text).toContain('Demo player')
    expect(text).not.toMatch(CYRILLIC)
  })
})
