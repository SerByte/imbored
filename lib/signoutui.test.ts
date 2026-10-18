import { createElement, type ComponentProps, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { Locale } from './i18n'

/**
 * Выход и «Удалить всё обо мне» внизу /library (components/SignOut,
 * components/ForgetMe) — первый кадр на обоих языках.
 *
 * Нажать кнопку здесь нечем, а ответы роутов разобраны в lib/signoutreply и
 * lib/forgetreply. Сторожится то, что видит каждый вошедший: подписи кнопок и
 * строка о входе для сессии по ссылке — с адресом входа на языке страницы
 * (на /en — lang=en через Steam, иначе вернувшийся попал бы на русскую
 * библиотеку).
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace() {}, refresh() {}, push() {}, prefetch() {}, back() {}, forward() {} }),
}))

const { LocaleProvider } = await import('@/components/LocaleProvider')
const { SignOut } = await import('@/components/SignOut')
const { ForgetMe } = await import('@/components/ForgetMe')

const render = (locale: Locale, el: ReactElement) =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, el)).replace(
    /&#x27;/g,
    "'",
  )
const CYRILLIC = /[А-Яа-яЁё]/

describe('выход по-английски', () => {
  test('вошедший через Steam: «Sign out» и «Sign out everywhere»', () => {
    const out = render('en', createElement(SignOut, { verified: true, feedLink: true }))
    expect(out).toMatch(/<button[^>]*>Sign out<\/button>/)
    expect(out).toMatch(/<button[^>]*>Sign out everywhere<\/button>/)
    expect(out).not.toMatch(CYRILLIC)
  })

  test('сессия по ссылке: строка о входе, и вход возвращает на английскую /library', () => {
    const out = render('en', createElement(SignOut, { verified: false }))
    expect(out).toContain('To sign out everywhere or delete your data, <a href="/api/auth/steam?next=%2Flibrary&amp;lang=en"')
    expect(out).toContain('>sign in with Steam</a>')
    expect(out).not.toMatch(CYRILLIC)
  })

  test('по-русски — прежние слова и прежний адрес входа', () => {
    const out = render('ru', createElement(SignOut, { verified: false }))
    expect(out).toContain('Выход на всех устройствах и удаление данных — после <a href="/api/auth/steam?next=%2Flibrary"')
    expect(out).toContain('>входа через Steam</a>')
  })
})

describe('«Удалить всё обо мне» по-английски', () => {
  test('кнопка — имя из глоссария, тем же словом её называет /privacy', () => {
    const out = render('en', createElement(ForgetMe))
    expect(out).toMatch(/<button[^>]*>Delete everything about me<\/button>/)
    expect(out).not.toMatch(CYRILLIC)
    expect(render('ru', createElement(ForgetMe))).toMatch(/<button[^>]*>Удалить всё обо мне<\/button>/)
  })
})
