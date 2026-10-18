import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { langOn, ogImageOn, playerName, SnapshotDates, withForeignRuns } from './portrait-text'

/**
 * Общие куски портрета и итогов года на языке страницы.
 *
 * Главное здесь — русская страница: каждый помощник на 'ru' обязан отдать
 * ровно то, что стояло в разметке до перевода (ни атрибута lang, ни своей
 * картинки превью, ни разрезанной цитаты), а английская — не пропустить ни
 * одной русской буквы, кроме чужого текста с lang="ru".
 */

const html = (node: ReactNode) => renderToStaticMarkup(createElement('p', null, node))

describe('playerName', () => {
  test('демо-ник — на языке страницы, живой ник — как записан', () => {
    expect(playerName('00000000000000000', 'Демо-игрок', 'en')).toBe('Demo player')
    expect(playerName('00000000000000002', 'Демо-друг', 'en')).toBe('Demo friend')
    expect(playerName('00000000000000000', 'Демо-игрок', 'ru')).toBe('Демо-игрок')
    expect(playerName('76561198000000001', 'Вася', 'en')).toBe('Вася')
  })

  test('без ника — «Игрок 1234» / «Player 1234»; пустой ник по-русски — как был', () => {
    expect(playerName('76561198000001234', null, 'ru')).toBe('Игрок 1234')
    expect(playerName('76561198000001234', null, 'en')).toBe('Player 1234')
    expect(playerName('76561198000001234', '', 'ru')).toBe('')
  })
})

describe('langOn и withForeignRuns', () => {
  test('lang="ru" — только у русского текста и только на /en', () => {
    expect(langOn('en', 'Вася Пупкин')).toBe('ru')
    expect(langOn('en', 'Dota 2')).toBeUndefined()
    // Русская страница без атрибутов, как была: латиница там не помечалась
    expect(langOn('ru', 'Dota 2')).toBeUndefined()
    expect(langOn('ru', 'Вася')).toBeUndefined()
  })

  test('русский ник внутри английской цитаты — своим узлом, каждым вхождением', () => {
    const text = 'Вася is 39% strategist. “Смута (1.0)” took it all, Вася.'
    expect(html(withForeignRuns('en', text, ['Вася', 'Смута (1.0)', 'Dota 2']))).toBe(
      '<p><span lang="ru">Вася</span> is 39% strategist. “<span lang="ru">Смута (1.0)</span>” took it all, ' +
        '<span lang="ru">Вася</span>.</p>',
    )
  })

  test('длинное имя режется раньше своей части', () => {
    expect(html(withForeignRuns('en', 'Вася Пупкин and Вася', ['Вася', 'Вася Пупкин']))).toBe(
      '<p><span lang="ru">Вася Пупкин</span> and <span lang="ru">Вася</span></p>',
    )
  })

  test('русская страница и латинский ник — та же строка, без единого узла', () => {
    const ru = 'Вася, ты на 39% стратег.'
    expect(withForeignRuns('ru', ru, ['Вася'])).toBe(ru)
    const en = 'Demo player is 39% strategist.'
    expect(withForeignRuns('en', en, ['Demo player', null, undefined])).toBe(en)
  })
})

describe('ogImageOn', () => {
  test('русская страница своей картинки не объявляет — файловая остаётся с хэшем', () => {
    expect(ogImageOn('ru', '/portrait/76561198000000001', 'Портрет игрока — imbored')).toEqual({})
  })

  test('английская — та же картинка под /en, с английским alt', () => {
    expect(ogImageOn('en', '/portrait/76561198000000001/year', 'Year in review — imbored')).toEqual({
      images: [
        {
          url: '/en/portrait/76561198000000001/year/opengraph-image',
          width: 1200,
          height: 630,
          type: 'image/png',
          alt: 'Year in review — imbored',
        },
      ],
    })
  })
})

describe('SnapshotDates', () => {
  const year = { from: Date.UTC(2026, 0, 1) / 1000, to: Date.UTC(2026, 7, 14) / 1000, fromPrevYear: false, closed: false }

  test('по-русски — прежняя фраза', () => {
    expect(html(createElement(SnapshotDates, { year, locale: 'ru' }))).toBe(
      '<p>По снимкам библиотеки: с 1 января по 14 августа.</p>',
    )
  })

  test('по-английски — целой фразой', () => {
    expect(html(createElement(SnapshotDates, { year, locale: 'en' }))).toBe(
      '<p>Based on library snapshots from January 1 to August 14.</p>',
    )
  })
})
