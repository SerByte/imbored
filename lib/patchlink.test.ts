import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { GameNews } from '../components/GameNews'
import { PatchRow } from '../components/whatsnew/PatchRow'
import type { FeedItem } from './db'
import { newsPath } from './newspage'

/**
 * Ссылка на страницу патча — в серверной разметке, а не в раскрытой строке.
 *
 * Строки патчей на карточке игры и в ленте /whatsnew свёрнуты, а раскрывает
 * их клиент. Пока ссылка «Отдельной страницей» жила только в раскрытой части,
 * в HTML её не было: замер на проде — ноль ссылок /game/…/news/… на карточке
 * Elden Ring при патче в карте сайта. Поиск такую страницу знал только по
 * карте, а та держит девяносто дней.
 *
 * Здесь рендерим строки так же, как их отдаёт сервер, — всё свёрнуто, — и
 * ищем ссылку в заголовке. И проверяем, что раскрытие по-прежнему отдельная
 * кнопка с состоянием: ссылку внутрь <button> вложить нельзя, и шапка строки
 * перестала быть одной большой кнопкой именно ради неё.
 */

const ROOT = path.join(__dirname, '..')
/** Код без комментариев: докблоки цитируют то, что здесь ищется */
const code = (rel: string) =>
  fs
    .readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const ELDEN = 'ELDEN RING'

const row = (over: Partial<FeedItem> = {}): FeedItem => ({
  appid: 1245620,
  gid: '667248424192575311',
  title: 'ELDEN RING - Patch Notes Version 1.16',
  url: 'https://store.steampowered.com/news/app/1245620/view/667248424192575311',
  publishedAt: 1_754_000_000,
  kind: 'patch',
  scale: 'major',
  bodyHash: 'h',
  rank: 900_000,
  tldr: 'Поправили баланс оружия и починили вылеты.',
  ...over,
})

const PAGE = newsPath(1245620, '667248424192575311')

/** Хотфикс: пересказа нет, страница — копия поста Steam с noindex */
const HOTFIX = row({ gid: '667248424192575999', title: 'Hotfix 1.16.1', scale: 'hotfix', tldr: undefined })

const gameNews = (items: FeedItem[]) => renderToStaticMarkup(createElement(GameNews, { items, name: ELDEN }))

const patchRow = (item: FeedItem, discovery = false) =>
  renderToStaticMarkup(
    createElement(PatchRow, { item, meta: { name: ELDEN }, nowSec: 1_754_100_000, changes: 12, discovery }),
  )

/** Все <button>…</button> разметки: внутри них ссылок быть не может */
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0])

/** Ссылки на страницу патча с их подписью */
const patchLinks = (html: string) =>
  [...html.matchAll(/<a\b[^>]*href="(\/game\/\d+\/news\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1],
    text: m[2],
  }))

describe('карточка игры (GameNews)', () => {
  test('заголовок патча — ссылка на его страницу прямо в серверном HTML', () => {
    const html = gameNews([row()])
    expect(patchLinks(html)).toEqual([{ href: PAGE, text: 'Patch Notes Version 1.16' }])
    // Сервер отдаёт строку свёрнутой: ссылка не из раскрытой части
    expect(html).not.toContain('Отдельной страницей')
  })

  test('ссылка — не внутри кнопки, раскрытие — своя кнопка с состоянием и именем', () => {
    const html = gameNews([row()])
    const all = buttons(html)
    expect(all).toHaveLength(1)
    expect(all[0], 'ссылка внутри <button> — невалидная разметка').not.toMatch(/<a\b/)
    expect(all[0]).toMatch(/aria-expanded="false"/)
    // У кнопки остался только шеврон: имя ей нужно своё, иначе она немая
    expect(all[0]).toMatch(/aria-label="Что изменилось: Patch Notes Version 1\.16"/)
  })

  test('без пересказа и у игры вне каталога ссылки нет — только кнопка', () => {
    const html = gameNews([HOTFIX, row({ gid: '667248424192575000', rank: 0 })])
    expect(patchLinks(html)).toEqual([])
    expect(buttons(html)).toHaveLength(2)
    expect(html).toContain('Hotfix 1.16.1')
  })
})

describe('лента «Что нового» (PatchRow)', () => {
  test.each([false, true])('discovery=%s: заголовок — ссылка в серверном HTML, вне кнопки', (discovery) => {
    const html = patchRow(row(), discovery)
    expect(patchLinks(html)).toEqual([{ href: PAGE, text: 'Patch Notes Version 1.16' }])
    expect(html).not.toContain('Отдельной страницей')
    const all = buttons(html)
    expect(all).toHaveLength(1)
    expect(all[0]).not.toMatch(/<a\b/)
    expect(all[0]).toMatch(/aria-expanded="false"/)
    expect(all[0]).toMatch(/aria-label="Что изменилось: ELDEN RING, Patch Notes Version 1\.16"/)
  })

  test('без пересказа ссылки нет', () => {
    expect(patchLinks(patchRow(HOTFIX))).toEqual([])
  })
})

/*
 * Раскрытие не должно сжаться до шеврона. Нажатие куда угодно по шапке
 * раскрывало строку, пока шапка была кнопкой, — теперь это держит ::before
 * кнопки, растянутый на шапку. Ломается одним классом: tap или relative на
 * кнопке делают рамкой слоя её саму. А ссылка обязана стоять над слоем,
 * иначе по ней не попасть вовсе.
 */
describe('шапка строки раскрывается нажатием куда угодно, кроме ссылки', () => {
  const cls = (tag: string) => tag.match(/\sclass="([^"]*)"/)?.[1] ?? ''
  const has = (c: string, name: string) => c.split(/\s+/).includes(name)

  /** Открывающий тег родителя первого <button>: разбор по стеку тегов */
  const buttonParent = (html: string): string => {
    const stack: string[] = []
    for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/g)) {
      if (m[1]) stack.pop()
      else if (m[2] === 'button') return stack[stack.length - 1] ?? ''
      else if (!m[3] && m[2] !== 'img') stack.push(m[0])
    }
    return ''
  }

  test.each([
    ['GameNews', () => gameNews([row()])],
    ['PatchRow', () => patchRow(row())],
  ])('%s', (_, render) => {
    const html = render()
    const button = cls(buttons(html)[0])
    expect(has(button, 'before:absolute') && has(button, 'before:inset-0')).toBe(true)
    for (const bad of ['tap', 'relative', 'absolute']) {
      expect(has(button, bad), `${bad} на кнопке — рамкой слоя стала бы она сама`).toBe(false)
    }
    // рамка слоя — шапка, в которой стоит кнопка
    expect(has(cls(buttonParent(html)), 'relative')).toBe(true)
    const link = cls(html.match(/<a\s[^>]*href="\/game\/\d+\/news\/[^"]+"[^>]*>/)?.[0] ?? '')
    expect(has(link, 'relative') && has(link, 'z-10'), 'ссылка под слоем кнопки — по ней не попасть').toBe(true)
  })
})

/*
 * Ссылок стало до восьми на карточке и до тридцати в ленте, и все в кадре
 * сразу, а не по одной в раскрытой строке. С префетчем каждая будила бы
 * страницу патча на каждом просмотре; переходят же по одной.
 */
test.each(['components/GameNews.tsx', 'components/whatsnew/PatchRow.tsx'])(
  '%s: заголовок-ссылка без префетча',
  (file) => {
    expect(code(file)).toMatch(/<Link\s+href=\{href\}\s+prefetch=\{false\}/)
  },
)
