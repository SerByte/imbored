import { describe, expect, test, vi } from 'vitest'

// next/font/google — функция сборки, вне Next её нет: шрифтам в тесте метадаты нужна только переменная
vi.mock('next/font/google', () => ({
  Manrope: () => ({ variable: '--font-manrope' }),
  JetBrains_Mono: () => ({ variable: '--font-jbmono' }),
}))

const { generateMetadata } = await import('./layout')

const meta = (lang: string) => generateMetadata({ params: Promise.resolve({ lang }), children: null } as never)

/*
 * Подпись корневой карточки превью (docs/i18n.md, п. 10). alt файловой
 * карточки — константа модуля, русская, и её наследует каждая страница без
 * своей карточки: /explore, /rooms, /room/new, /compat. На /en корень
 * ставит ту же карточку своим images с английским alt (rootCardOn в
 * layout.tsx); размеры и тип там — копия, и если карточка сменит формат,
 * тест это поймает.
 */
describe('корневая карточка превью', () => {
  test('русская подпись — как до перевода, и корень своего images не задаёт', async () => {
    const { alt } = await import('./opengraph-image')
    expect(alt).toBe('imbored — во что поиграть')
    const ru = await meta('ru')
    expect(ru.openGraph).not.toHaveProperty('images')
    expect(ru.twitter).not.toHaveProperty('images')
  })

  test('/en — та же карточка корня, но с английским alt', async () => {
    const { size, contentType } = await import('./opengraph-image')
    const en = await meta('en')
    expect(en.openGraph?.images).toEqual([
      {
        url: '/en/opengraph-image',
        width: size.width,
        height: size.height,
        type: contentType,
        alt: 'imbored — what to play',
      },
    ])
    // twitter:image Next дозаполняет из openGraph сам — своего тут не нужно
    expect(en.twitter).not.toHaveProperty('images')
  })
})
