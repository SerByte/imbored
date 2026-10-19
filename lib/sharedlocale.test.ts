import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { CountNumber } from '../components/CountNumber'
import { LocaleProvider } from '../components/LocaleProvider'
import { ShareLinkField } from '../components/ShareLink'
import { SkelPage } from '../components/Skeleton'
import type { Locale } from './i18n'

/**
 * Общие островки, которые ставят страницы шести разделов, говорят на языке
 * страницы сами — из контекста, без нового пропа. Вызывающие передают свои
 * подписи (title, text, label) и не менялись; здесь — то, что островок
 * пишет от себя: подпись кнопки, разряды числа, объявление загрузки.
 * Без провайдера — русский, как раньше, до байта.
 */

// Дети — третьим доводом, как требует линтер; тип пропсов их ждёт в объекте
type WithChildren<P> = P & { children: ReactNode }

const render = (node: ReactNode, locale?: Locale) =>
  renderToStaticMarkup(
    locale ? createElement(LocaleProvider, { locale } as WithChildren<{ locale: Locale }>, node) : node,
  )

const field = () =>
  createElement(ShareLinkField, {
    what: 'portrait',
    url: 'https://imbored.cc/en/portrait/76561198000000001?ref=portrait',
    label: 'Link to your player portrait',
    title: 'Portrait',
    text: 'Portrait',
  })

describe('ShareLinkField', () => {
  test('на /en — «Copy», на русской — «Скопировать»', () => {
    expect(render(field(), 'en')).toContain('>Copy</span>')
    expect(render(field(), 'ru')).toContain('>Скопировать</span>')
    expect(render(field())).toBe(render(field(), 'ru'))
  })
})

describe('CountNumber', () => {
  test('разряды — языка страницы', () => {
    const n = createElement(CountNumber, { value: 2847, suffix: '%' })
    expect(render(n, 'en')).toContain('>2,847%</span>')
    expect(render(n, 'ru')).toContain('>2 847%</span>')
    expect(render(n)).toBe(render(n, 'ru'))
  })
})

describe('SkelPage', () => {
  test('объявление загрузки — на языке страницы, ячейки без JS-обёрток', () => {
    const page = createElement(
      SkelPage,
      { className: 'flex-1' } as WithChildren<{ className: string }>,
      createElement('div', { className: 'skel' }),
    )
    expect(render(page, 'en')).toBe('<div role="status" aria-label="Loading" class="flex-1"><div class="skel"></div></div>')
    expect(render(page)).toBe('<div role="status" aria-label="Загрузка" class="flex-1"><div class="skel"></div></div>')
  })
})
