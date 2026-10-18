import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { LocaleProvider } from '../components/LocaleProvider'
import { NeedSteam } from '../components/NeedSteam'
import type { Locale } from './i18n'

/**
 * Строка «войди через Steam» для сессии, которой писать нельзя
 * (components/NeedSteam), — на обоих языках.
 *
 * Мест у неё десять, и половина — серверные страницы, где языка в пропсах
 * нет: язык строка берёт из контекста сама, а from приходит без префикса.
 * Поэтому здесь сторожится, что на /en вход везёт lang=en (возврат — на
 * английскую страницу, а не на русскую) и что русская строка осталась той
 * же до символа.
 */

const WHYS = ['save', 'launch', 'room', 'host', 'see'] as const

const render = (locale: Locale, from: string, why?: (typeof WHYS)[number]) =>
  renderToStaticMarkup(
    createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, NeedSteam({ from, why })),
  ).replace(/&#x27;/g, "'")

describe('NeedSteam по-английски', () => {
  test.each(WHYS)('%s: ни буквы кириллицы, вход — «Sign in with Steam»', (why) => {
    const out = render('en', '/library', why)
    expect(out).not.toMatch(/[А-Яа-яЁё]/)
    expect(out).toMatch(why === 'save' ? />sign in with Steam<\/a>/ : />Sign in with Steam<\/a>/)
  })

  test('адрес возврата — на языке страницы: next и join без префикса, язык — lang=en', () => {
    expect(render('en', '/library', 'see')).toContain('href="/api/auth/steam?next=%2Flibrary&amp;lang=en"')
    expect(render('en', '/room/ABC234', 'host')).toContain('href="/api/auth/steam?join=ABC234&amp;lang=en"')
    // уже английский адрес второй раз не префиксуется
    expect(render('en', '/en/library', 'see')).toContain('href="/api/auth/steam?next=%2Flibrary&amp;lang=en"')
  })

  test('слова по месту — те же, что по-русски', () => {
    expect(render('en', '/game/730', 'launch')).toContain("View only for now: this launch won't be saved")
    expect(render('en', '/room/new', 'room')).toContain('Only someone signed in with Steam can start a party')
    expect(render('en', '/room/ABC234', 'host')).toContain('remove people and put the party on the board')
    expect(render('en', '/library', 'see')).toContain('ratings, hidden games and “Your evenings”')
    expect(render('en', '/library')).toContain('To save ratings and create rooms, <a')
  })

  test('по-русски и без провайдера — прежняя строка', () => {
    const bare = renderToStaticMarkup(NeedSteam({ from: '/library', why: 'see' }))
    expect(render('ru', '/library', 'see')).toBe(bare)
    expect(bare).toContain('href="/api/auth/steam?next=%2Flibrary"')
    expect(bare).toMatch(/>Войди через Steam<\/a> — и они будут здесь\.<\/p>$/)
  })
})
