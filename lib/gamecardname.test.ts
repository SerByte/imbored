import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { GameCardBody } from '@/components/GameCard'
import { LocaleProvider } from '@/components/LocaleProvider'
import type { Locale } from '@/lib/i18n'

/**
 * Название под обложкой карточки (GameCardBody → GameCardName).
 *
 * Название игры не переводят, но голос скринридера выбирается по lang: на
 * /en русское название без пометки английский голос читает по буквам (WCAG
 * 3.1.2). Русская страница атрибута не получает вовсе — она обязана остаться
 * прежней до байта.
 */

/** Карточка в контексте языка страницы — как её ставит корневой layout */
const card = (name: string, locale?: Locale) => {
  const body = createElement(GameCardBody, { appid: 730, name, headerImage: 'https://cdn.example/header.jpg' })
  const tree = locale
    ? createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, body)
    : body
  return renderToStaticMarkup(tree)
}
/** Элемент названия целиком: тот, у которого текстом стоит само название */
const nameEl = (html: string, name: string) => html.match(new RegExp(`<span[^>]*>${name}</span>`))?.[0]

describe('название карточки игры', () => {
  test('на /en русское название — lang="ru"', () => {
    expect(nameEl(card('Смута', 'en'), 'Смута')).toContain('lang="ru"')
    // название игры в тексте не входит в подсчёт — тут оно и есть текст
    expect(nameEl(card('Бесконечное лето', 'en'), 'Бесконечное лето')).toContain('lang="ru"')
  })

  test('на /en латинское название — без атрибута: оно на языке страницы', () => {
    expect(nameEl(card('Counter-Strike 2', 'en'), 'Counter-Strike 2')).not.toContain('lang=')
  })

  test('русская страница — без единого lang, разметка названия прежняя', () => {
    for (const html of [card('Смута', 'ru'), card('Counter-Strike 2', 'ru'), card('Смута')]) {
      expect(html).not.toContain('lang=')
    }
    expect(nameEl(card('Смута', 'ru'), 'Смута')).toBe(
      '<span class="block truncate text-[15px] leading-tight font-extrabold tracking-[-0.01em]">Смута</span>',
    )
  })
})

/*
 * Игра не из Steam — типографская обложка (TypeCover внутри GameArt) с
 * жанром одной строкой. На /en жанр — из английской таблицы
 * (otherStoreGenre): «Королевская битва» поверх обложки Fortnite на полке
 * /en/library была бы русским словом на английской странице.
 */
describe('обложка игры не из Steam внутри карточки', () => {
  const fortnite = (locale?: Locale) => {
    const body = createElement(GameCardBody, { appid: -101, name: 'Fortnite' })
    return renderToStaticMarkup(
      locale ? createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, body) : body,
    )
  }

  test('на /en жанр по-английски, ни буквы по-русски', () => {
    const html = fortnite('en')
    expect(html).toContain('<span class="type-cover-genre">Battle royale</span>')
    expect(html).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('на русской — как было', () => {
    for (const html of [fortnite('ru'), fortnite()]) {
      expect(html).toContain('<span class="type-cover-genre">Королевская битва</span>')
    }
  })
})
