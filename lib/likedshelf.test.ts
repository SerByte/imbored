import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { LikedShelf, type LikedGame } from '../components/LikedShelf'
import { LocaleProvider } from '../components/LocaleProvider'
import type { Locale } from './i18n'

// Островку нужен роутер (useLocaleRouter): до нажатия он только хранится
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {}, refresh() {}, back() {}, forward() {} }),
}))

/**
 * Полка «Зашло» на /library (components/LikedShelf) настоящим рендером.
 *
 * Абзац под заголовком объясняет, что делают оценки. Английский был калькой
 * «пауза после «не то» снимается»: о паузе на /en больше нигде не сказано, и
 * фраза ни к чему не цеплялась. Теперь он говорит, что выходит (cooldownOf в
 * lib/recommend: «зашло» после скипа возвращает игру), и без числа — под
 * «1 game …» «these» читалось ошибкой.
 */

const game = (appid: number, name: string): LikedGame => ({ appid, name, headerImage: null, art: null })

const html = (locale: Locale, games: LikedGame[]) =>
  renderToStaticMarkup(
    createElement(
      LocaleProvider,
      { locale } as ComponentProps<typeof LocaleProvider>,
      createElement(LikedShelf, { games, total: games.length, writer: true }),
    ),
  ).replaceAll('&#x27;', "'")

/** Абзац под заголовком полки */
const lead = (out: string) => out.match(/<\/h2><p class="text-dim[^"]*">([^<]*)<\/p>/)?.[1]

describe('полка «Зашло»: абзац под заголовком', () => {
  test('на /en — что делает оценка, без кальки и без числа', () => {
    const one = html('en', [game(1, 'Portal 2')])
    expect(one).toContain('1</span> game you marked “Liked it”')
    expect(lead(one)).toBe(
      'Picks learn your taste from your likes: similar games rank higher, and liking a game you skipped with “Not it” brings it back. Tapped by mistake or changed your mind? Remove it.',
    )
    // Одна строка на любое число: у двух игр абзац тот же
    expect(lead(html('en', [game(1, 'Portal 2'), game(2, 'Celeste')]))).toBe(lead(one))
  })

  test('русский абзац прежний', () => {
    expect(lead(html('ru', [game(1, 'Portal 2')]))).toBe(
      'По ним он учится твоему вкусу: похожее — выше, пауза после «не то» снимается. Нажал по ошибке или вкус поменялся — убери.',
    )
  })
})
