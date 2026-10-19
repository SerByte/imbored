import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { LocaleProvider } from '../components/LocaleProvider'
import { LocaleSwitch, rememberLocale } from '../components/LocaleSwitch'
import type { Locale } from './i18n'

const nav = vi.hoisted(() => ({ pathname: '/', search: '' }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}))

beforeEach(() => {
  nav.pathname = '/'
  nav.search = ''
})

function render(locale: Locale): string {
  return renderToStaticMarkup(
    createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, createElement(LocaleSwitch)),
  )
}

/** Открывающие теги ссылок по языку цели */
function links(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of html.matchAll(/<a\b[^>]*>/g)) {
    const lang = m[0].match(/ lang="(\w+)"/)?.[1]
    if (lang) out[lang] = m[0]
  }
  return out
}

describe('переключатель языка', () => {
  test('на английской выдаче: русская версия того же адреса с тем же запросом', () => {
    nav.pathname = '/en/play'
    nav.search = 'time=short&vibe=chill'
    const a = links(render('en'))
    expect(a.ru).toContain('href="/play?time=short&amp;vibe=chill"')
    expect(a.ru).toContain('hrefLang="ru"')
    expect(a.ru).not.toContain('aria-current')
    expect(a.en).toContain('href="/en/play?time=short&amp;vibe=chill"')
    expect(a.en).toContain('aria-current="true"')
    expect(a.en).not.toContain('hrefLang')
  })

  /**
   * Статическая страница русской ветки пререндерится по /ru/…: так её адрес
   * видит сервер. Ссылки обязаны выйти те же, что в браузере на /play.
   */
  test('на русском — и по внешнему адресу, и по внутреннему /ru/…', () => {
    for (const pathname of ['/play', '/ru/play']) {
      nav.pathname = pathname
      const a = links(render('ru'))
      expect(a.ru, pathname).toContain('href="/play"')
      expect(a.ru, pathname).toContain('aria-current="true"')
      expect(a.en, pathname).toContain('href="/en/play"')
      expect(a.en, pathname).toContain('hrefLang="en"')
    }
  })

  test('главная: «/» ↔ «/en»', () => {
    const a = links(render('ru'))
    expect(a.ru).toContain('href="/"')
    expect(a.en).toContain('href="/en"')
  })

  test('имя ссылки содержит видимую подпись, у группы — своё имя', () => {
    const html = render('en')
    expect(html).toMatch(/role="group" aria-label="Language"/)
    expect(html).toContain('EN<span class="sr-only"> English</span>')
    expect(html).toContain('RU<span class="sr-only"> Русский</span>')
    expect(render('ru')).toMatch(/aria-label="Язык"/)
  })

  test('выбор пишется в куку lang на год для всего сайта', () => {
    const doc = { cookie: '' }
    rememberLocale('en', doc)
    expect(doc.cookie).toBe('lang=en; Path=/; Max-Age=31536000; SameSite=Lax')
    rememberLocale('ru', doc)
    expect(doc.cookie).toBe('lang=ru; Path=/; Max-Age=31536000; SameSite=Lax')
  })
})
