import { createElement, type ComponentProps, type ReactElement } from 'react'
import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { GameNews } from '../components/GameNews'
import { LocaleProvider } from '../components/LocaleProvider'
import { ForeignBody, NewsBody } from '../components/NewsBody'
import { NewsDate, ScaleBadge } from '../components/NewsMeta'
import { PatchShare } from '../components/PatchShare'
import { Cover } from '../components/whatsnew/Cover'
import { FeedLink } from '../components/whatsnew/FeedLink'
import { changesLabel } from '../components/whatsnew/format'
import { PatchRow } from '../components/whatsnew/PatchRow'
import type { FeedItem } from './db'
import type { Locale } from './i18n'

/**
 * Островки ленты и патчей на /en — в первом кадре, как их отдаёт сервер.
 *
 * Заголовок и пересказ строки сюда приходят уже на языке страницы (rowOn
 * страницы /whatsnew, cardNews карточки игры), поэтому здесь — подписи
 * самих островков: ни одна не должна остаться русской. Название игры и
 * заголовок издателя в проверку не входят — это данные, и в фикстуре они
 * английские. Русская разметка тех же островков сторожится их прежними
 * тестами (lib/patchlink, lib/feedlinkui, lib/reducedhydration).
 */

const CYR = /[А-Яа-яЁё]/
const SINCE = 1_760_000_000

const on = (locale: Locale, el: ReactElement) =>
  createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, el)
const html = (el: ReactElement) => renderToStaticMarkup(on('en', el))

const row: FeedItem = {
  appid: 1245620,
  gid: '667248424192575311',
  title: 'ELDEN RING - Patch Notes Version 1.16',
  url: 'https://store.steampowered.com/news/app/1245620/view/667248424192575311',
  publishedAt: 1_754_000_000,
  kind: 'patch',
  scale: 'major',
  bodyHash: 'h',
  rank: 900_000,
  tldr: 'Rebalanced weapons and fixed crashes.',
  imageUrl: 'https://cdn.example/patch.jpg',
}

describe('строки ленты и карточки игры на /en', () => {
  test('PatchRow: подписи, срок и число правок — по-английски', () => {
    const out = html(
      createElement(PatchRow, { item: row, meta: { name: 'ELDEN RING', ccu: 12_345 }, nowSec: 1_754_100_000, changes: 12 }),
    )
    expect(out).toContain('aria-label="What changed: ELDEN RING, Patch Notes Version 1.16"')
    expect(out).toContain('12 changes')
    expect(out).toContain('12,345 in game')
    expect(out).toContain('yesterday')
    expect(out).not.toMatch(CYR)
  })

  test('PatchRow: полоска цены у чужой игры — «View game»', () => {
    const out = html(
      createElement(PatchRow, { item: row, meta: { name: 'ELDEN RING' }, nowSec: 1_754_100_000, changes: 0, discovery: true }),
    )
    expect(out).toContain('View game')
    expect(out).not.toContain('Открыть игру')
  })

  test('PatchRow без меты: запасное имя игры — «Game 1245620»', () => {
    const out = html(createElement(PatchRow, { item: row, nowSec: 1_754_100_000, changes: 0 }))
    expect(out).toContain('Game 1245620')
    expect(out).not.toMatch(CYR)
  })

  test('GameNews: дата, масштаб и имя кнопки', () => {
    const out = html(createElement(GameNews, { items: [row], name: 'ELDEN RING' }))
    expect(out).toContain('aria-label="What changed: Patch Notes Version 1.16"')
    expect(out).toContain('Major')
    expect(out).toContain('July 31, 2025')
    expect(out).not.toMatch(CYR)
  })

  test('Cover: надзаголовок, факты и кнопки', () => {
    const out = renderToString(
      on(
        'en',
        createElement(Cover, {
          item: row,
          meta: { name: 'ELDEN RING', ccu: 1000 },
          nowSec: 1_754_100_000,
          changes: 1,
          label: 'in popular games',
        }),
      ),
    )
    for (const s of ["What&#x27;s new", 'playing right now', 'change in this patch', 'Read the patch', 'What else changed', 'July 31']) {
      expect(out, s).toContain(s)
    }
    expect(out).not.toMatch(CYR)
  })

  test('NewsMeta: дата и масштаб; русская разметка — прежняя', () => {
    expect(renderToStaticMarkup(createElement(ScaleBadge, { scale: 'hotfix', locale: 'en' }))).toContain('>Hotfix<')
    expect(renderToStaticMarkup(createElement(ScaleBadge, { scale: 'major' }))).toContain('>Крупное<')
    expect(renderToStaticMarkup(createElement(NewsDate, { at: SINCE, locale: 'en' }))).toContain('>October 9, 2025<')
    expect(renderToStaticMarkup(createElement(NewsDate, { at: SINCE }))).toContain('>9 октября 2025 г.<')
  })

  test('changesLabel: форма числа своего языка', () => {
    expect(changesLabel(1, 'en')).toBe('1 change')
    expect(changesLabel(1234, 'en')).toBe('1,234 changes')
    expect(changesLabel(3)).toBe('3 правки')
    expect(changesLabel(1234)).toBe(`${(1234).toLocaleString('ru-RU')} правки`)
  })

  test('тело на /en: английское — как есть, вместо чужого — строка об оригинале', () => {
    const body = renderToStaticMarkup(
      createElement(NewsBody, { blocks: [{ kind: 'p', runs: [{ text: 'Fixed a crash.' }] }], locale: 'en' }),
    )
    expect(body).toContain('Fixed a crash.')
    expect(body).not.toContain('lang=')
    expect(renderToStaticMarkup(createElement(ForeignBody, { locale: 'en' }))).toContain(
      'We don&#x27;t have these patch notes in English',
    )
  })

  test('PatchShare: «Share»', () => {
    const out = html(createElement(PatchShare, { appid: 730, gid: '5123894512345', title: 'CS2' }))
    expect(out).toContain('Share')
    expect(out).not.toMatch(CYR)
  })
})

describe('FeedLink на /en', () => {
  const link = (since: number | null, verified = true) => html(createElement(FeedLink, { since, verified }))

  test('ссылки нет: заголовок, обещание и кнопка выпуска — по-английски', () => {
    const out = link(null)
    expect(out).toContain('RSS via a private link')
    expect(out).toContain('Get the link')
    expect(out).toContain('don&#x27;t post it')
    expect(out).not.toMatch(CYR)
  })

  test('ссылка есть: дата выпуска по-английски, перевыпуск, отключение и второй выключатель', () => {
    const out = link(SINCE)
    expect(out).toContain('Link issued on October 9, 2025. We can&#x27;t show it again')
    expect(out).toContain('Issue a new one')
    expect(out).toContain('Turn off')
    expect(out).toContain('“Sign out everywhere” turns it off too.')
    expect(out).not.toMatch(CYR)
  })

  test('демо: срок жизни ссылки и вход через Steam — с языком страницы', () => {
    for (const since of [null, SINCE]) {
      const out = link(since, false)
      expect(out, String(since)).toContain('as long as the demo profile does')
      expect(out, String(since)).toContain('href="/api/auth/steam?next=%2Fwhatsnew&amp;lang=en"')
      expect(out, String(since)).not.toMatch(CYR)
    }
    expect(link(null, false)).toContain('demo library')
  })

  test('живые строки стоят с первого кадра и на /en', () => {
    expect(link(SINCE).match(/role="status"/g)).toHaveLength(4)
  })
})
