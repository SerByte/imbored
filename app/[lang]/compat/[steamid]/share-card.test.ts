import { describe, expect, test } from 'vitest'
import type { CompatInvite } from '@/lib/compatpage'
import { flight, textOf } from '@/lib/testing/flight'
import { CompatCardImage } from './share-card'

/**
 * Карточка совместимости в чате — на языке ссылки.
 *
 * Картинку из чата уже не отозвать, и английская ссылка, развернувшаяся
 * русской карточкой, — ровно то, что не ловит ни один тест страницы: карточку
 * рисует отдельный маршрут (opengraph-image.tsx). Здесь — её текст без
 * satori: серверные компоненты раскрыты до разметки (lib/testing/flight).
 */
const INVITE: CompatInvite = {
  steamid: '76561198000000041',
  name: 'Konstantin',
  gamesCount: 1234,
  totalHours: 4404,
  playtimeHidden: false,
  topGames: [],
}

const card = (invite: CompatInvite, locale?: 'ru' | 'en') =>
  textOf(flight(CompatCardImage({ invite, posters: [], locale }), new Map()))

describe('карточка совместимости (share-card)', () => {
  test('на /en — по-английски, числа с запятой', () => {
    const text = card(INVITE, 'en')
    expect(text).toContain('IMBORED.CC · COMPATIBILITY')
    expect(text).toContain('Konstantin wants to compare libraries')
    expect(text).toContain('1,234games in library')
    expect(text).toContain('4,404hours played')
    expect(text).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('скрытое время — словом и на /en', () => {
    const text = card({ ...INVITE, playtimeHidden: true }, 'en')
    expect(text).toContain('hiddenplaytime')
    expect(text).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('без языка и на русской — прежняя карточка', () => {
    for (const text of [card(INVITE), card(INVITE, 'ru')]) {
      expect(text).toContain('IMBORED.CC · СОВМЕСТИМОСТЬ')
      expect(text).toContain('Konstantin зовёт сравнить библиотеки')
      // разряды по-русски — неразрывным пробелом, как печатает Intl
      expect(text).toContain('1 234игры в библиотеке')
      expect(text).toContain('4 404часа сыграно')
    }
    expect(card({ ...INVITE, playtimeHidden: true })).toContain('скрытовремя в играх')
  })
})
