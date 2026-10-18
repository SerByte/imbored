import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { GameNews } from '../components/GameNews'
import { NewsBody } from '../components/NewsBody'
import { NewsDate } from '../components/NewsMeta'
import type { FeedItem } from './db'

/**
 * Вёрстка патча в узкой колонке: строка «Что нового» на карточке игры и тело
 * раскрытого патча.
 *
 * Раскладки в тестах нет, поэтому здесь разметка — то, от чего раскладка
 * зависит: кто с кем делит строку и кому разрешено сжиматься. Замеры, с
 * которых всё началось, — в докблоках самих тестов; всё мерено на проде.
 */

/** Открывающие теги, которые не закрываются: в этой разметке их нет, но парсер не должен на них споткнуться */
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source'])

/**
 * Открывающий тег родителя элемента, который начинается в разметке с at.
 * Стек по тегам, а не регэксп по соседству: между датой и её родителем бывают
 * другие элементы, и «ближайший тег слева» был бы братом, а не родителем.
 */
function parentTag(html: string, at: number): string {
  const stack: string[] = []
  for (const m of html.slice(0, at).matchAll(/<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g)) {
    if (m[1]) stack.pop()
    else if (!m[3] && !VOID.has(m[2].toLowerCase())) stack.push(m[0])
  }
  return stack.at(-1) ?? ''
}

const classOf = (tag: string) => tag.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? []

const row = (over: Partial<FeedItem> = {}): FeedItem => ({
  appid: 730,
  gid: '1',
  title: 'Обновление Counter-Strike 2',
  url: 'https://store.steampowered.com/news/app/730/view/1',
  // 28 сентября: самое длинное название месяца с двузначным днём
  publishedAt: 1_759_017_600,
  kind: 'patch',
  scale: 'hotfix',
  bodyHash: 'h',
  rank: 900_000,
  tldr: 'Уменьшена перезарядка у части пистолетов, поправлены хитбоксы на двух картах и исправлен вылет при выходе из матча.',
  ...over,
})

/**
 * Строка патча на карточке игры, свёрнутая.
 *
 * Дата и пересказ стояли в одном flex-ряду, у <time> не было ни shrink-0, ни
 * nowrap, и пересказ с truncate сжимал дату до самого длинного слова. Замер
 * на проде, /game/730: на 1440 — 6 дат из 8 в две строки («28 сентября 2026 /
 * г.»), левый край пересказа гулял от 309 до 374 px; на 390 — те же даты в три
 * строки шириной 46–54 px, а пересказу оставалось 128–136 px, около двадцати
 * знаков из 113–167 («Уменьшена перезаря…»). Строку, которая и нужна, чтобы
 * решить, разворачивать ли, приходилось разворачивать, чтобы прочесть.
 *
 * Теперь как в ленте /whatsnew (PatchRow): дата своей строкой, пересказ под
 * ней в две строки с многоточием. Только shrink-0 у даты не спасал телефон —
 * пересказу в колонке 194 px оставалось бы 62–83 px, ещё меньше прежнего.
 */
describe('строка «Что нового» на карточке игры', () => {
  const html = renderToStaticMarkup(createElement(GameNews, { items: [row()], name: 'Counter-Strike 2' }))
  const timeAt = html.indexOf('<time')
  const tldrAt = html.indexOf('Уменьшена перезарядка')
  const tldrTagAt = html.lastIndexOf('<span', tldrAt)

  test('сторож видит дату и пересказ', () => {
    expect(timeAt).toBeGreaterThan(-1)
    expect(tldrAt).toBeGreaterThan(timeAt)
  })

  test('дата не рвётся: «2026 г.» не уезжает на свою строку', () => {
    const time = html.slice(timeAt, html.indexOf('>', timeAt) + 1)
    expect(classOf(time)).toContain('whitespace-nowrap')
  })

  test('дата и пересказ — каждый своей строкой, а не в одном ряду, где один сжимает другого', () => {
    const dateParent = parentTag(html, timeAt)
    const tldrParent = parentTag(html, tldrTagAt)
    // Общий родитель — колонка строки: ряда, в котором пересказ отъедал
    // ширину у даты, между ними больше нет
    expect(tldrParent).toBe(dateParent)
    expect(classOf(dateParent)).toContain('flex-col')
  })

  test('пересказ — две строки с многоточием, а не одна обрезанная', () => {
    const tldr = classOf(html.slice(tldrTagAt, html.indexOf('>', tldrTagAt) + 1))
    expect(tldr).toContain('line-clamp-2')
    expect(tldr).not.toContain('truncate')
  })
})

/**
 * Дата патча не рвётся нигде: это одна метка в ~115 px, а не фраза. Кроме
 * карточки игры её ставят шапка страницы патча и «Другие патчи» — там она
 * тоже стоит в ряду с соседями.
 */
test('NewsDate — неразрывная по умолчанию, и класс вызывающего это не отменяет', () => {
  const at = 1_759_017_600
  expect(classOf(renderToStaticMarkup(createElement(NewsDate, { at })))).toContain('whitespace-nowrap')
  expect(classOf(renderToStaticMarkup(createElement(NewsDate, { at, className: 'shrink-0' })))).toEqual(
    expect.arrayContaining(['whitespace-nowrap', 'shrink-0']),
  )
})

/**
 * Пункты списка в теле патча.
 *
 * Пункт — flex-ряд «точка + текст», и текст в нём — flex-элемент с min-width:
 * auto, то есть не уже своего min-content. break-words на корне тела этого не
 * меняет: overflow-wrap: break-word не уменьшает min-content, и неразрывный
 * кусок шире колонки растягивал span за край панели. Замер на проде, 375 px:
 * пункт Satisfactory «Fixed a crash … (UFGFAnimInstanceFactory::AudioEventCallback)»
 * лёг с 55 по 375 px при панели до 355 — идентификатор обрезан на
 * «…AudioEventCallba», и каждая строка пункта залезала на правую рамку. Так в
 * раскрытой строке /whatsnew и в «Что нового» карточки игры: обе панели уже
 * страницы патча.
 */
describe('пункт списка в теле патча', () => {
  const token = `(UFGFAnimInstanceFactory::AudioEventCallback_${'x'.repeat(40)})`
  const html = renderToStaticMarkup(
    createElement(NewsBody, {
      blocks: [
        {
          kind: 'ul',
          items: [
            [{ text: `Fixed a crash related to Audio when exiting the game ${token}` }],
            [{ text: 'Короткий пункт' }],
          ],
        },
      ],
    }),
  )
  const items = [...html.matchAll(/<li\b[^>]*>/g)]

  test('сторож видит пункты', () => {
    expect(items).toHaveLength(2)
  })

  test('текст пункта может сжаться уже своего самого длинного слова', () => {
    for (const li of items) {
      const after = html.slice(li.index! + li[0].length)
      // Первый ребёнок — точка (aria-hidden), второй — текст пункта
      const [, text] = [...after.matchAll(/<span\b[^>]*>/g)].map((m) => m[0])
      expect(text, 'текст пункта не найден — сторож ослеп').toBeDefined()
      expect(text).not.toContain('aria-hidden')
      expect(classOf(text)).toContain('min-w-0')
    }
  })
})
