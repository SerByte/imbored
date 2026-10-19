import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { LocaleProvider } from '@/components/LocaleProvider'
import { PlayersNow } from '@/components/PlayersNow'
import { PlayersNow as PlayersNowView } from '@/components/PlayersNowView'
import { LOCALES } from '@/lib/i18n'

/**
 * Строка онлайна (components/PlayersNow) — на карточке игры, в герое /play и
 * /daily, в колоде пати.
 *
 * Ноль показывается намеренно: по нему видно, почему мёртвый мультиплеер не
 * зовут «с друзьями». Но «0 играли» читалось как «в неё не играл никто» — на
 * /game/711810 рядом с «72% из 1 886 отзывов». Ноль говорит про сеть в
 * момент замера, и подпись обязана говорить то же.
 */

const NOW = 1_790_000_000
const render = (ccu: number | null, ccuAt?: number | null) =>
  renderToStaticMarkup(createElement(PlayersNow, { ccu, ccuAt, nowSec: NOW }))
/** То же на /en: язык — из контекста страницы, как его ставит корневой layout */
const renderEn = (ccu: number | null, ccuAt?: number | null) =>
  renderToStaticMarkup(
    createElement(
      LocaleProvider,
      { locale: 'en' } as ComponentProps<typeof LocaleProvider>,
      createElement(PlayersNow, { ccu, ccuAt, nowSec: NOW }),
    ),
  )
/** Текст без разметки, с обычными пробелами — так его читает человек */
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

describe('PlayersNow', () => {
  test('ноль по давнему замеру — «онлайн при замере: 0», а не «0 играли»', () => {
    for (const at of [NOW - 3 * 86_400, undefined]) {
      const html = render(0, at)
      expect(text(html)).toBe('онлайн при замере: 0')
      expect(text(html)).not.toMatch(/0\s*играли/)
      expect(html).not.toContain('anim-pulse-dot')
    }
  })

  test('ноль по свежему замеру — «сейчас онлайн: 0», и без зелёной точки', () => {
    const html = render(0, NOW - 60)
    expect(text(html)).toBe('сейчас онлайн: 0')
    expect(html).not.toContain('anim-pulse-dot')
  })

  test('люди в сети — как прежде: свежий замер с точкой, давний прошедшим временем', () => {
    const fresh = render(1234, NOW - 60)
    expect(text(fresh)).toBe('1 234 сейчас играют')
    expect(fresh).toContain('anim-pulse-dot')

    const stale = render(1234, NOW - 3 * 86_400)
    expect(text(stale)).toBe('1 234 играли')
    expect(stale).not.toContain('anim-pulse-dot')
  })

  test('замера нет — строки нет', () => {
    expect(render(null)).toBe('')
  })

  /*
   * Ветка нуля пришла из main уже после перевода строки и по-русски: на
   * /en/game/<appid> (страница рисует строку с часами-бесконечностью, то
   * есть всегда давним замером) печаталось «онлайн при замере: 0».
   */
  test('на /en — ни буквы по-русски ни в нуле, ни в людях, ни в подсказке', () => {
    const stale = renderEn(0, NOW - 3 * 86_400)
    expect(text(stale)).toBe('online at last check: 0')
    expect(stale).toContain('title="Last known player count"')
    expect(text(renderEn(0, NOW - 60))).toBe('online now: 0')
    expect(text(renderEn(1234, NOW - 60))).toBe('1,234 playing now')
    expect(text(renderEn(1234, NOW - 3 * 86_400))).toBe('1,234 were playing')
    for (const html of [stale, renderEn(0, NOW - 60), renderEn(1234), renderEn(0)]) {
      expect(html).not.toMatch(/[А-Яа-яЁё]/)
    }
  })

  /*
   * Малое число — ровно то, ради чего строка есть: мёртвый мультиплеер,
   * «New to you · …» героя /play. «1 were playing» — ошибка согласования;
   * по-русски «1 играли» согласовывать нечего, и вывод прежний.
   */
  test('на /en прошедшее время согласуется с числом: 1 — «was», больше — «were»', () => {
    expect(text(renderEn(1, NOW - 3 * 86_400))).toBe('1 was playing')
    expect(text(renderEn(1, undefined))).toBe('1 was playing')
    expect(text(renderEn(2, NOW - 3 * 86_400))).toBe('2 were playing')
    expect(text(renderEn(1, NOW - 60))).toBe('1 playing now')
    expect(text(render(1, NOW - 3 * 86_400))).toBe('1 играли')
  })
})

/*
 * Серверная страница игры рисует строку из components/PlayersNowView с
 * языком страницы пропом — так она снова рендерится на сервере и не едет в
 * клиентский бандл карточки. Клиентские экраны (герой /play и /daily, колода)
 * зовут обёртку components/PlayersNow с языком из контекста. Разметка у них
 * одна — включая часы-бесконечность карточки игры (всегда давний замер).
 */
describe('PlayersNow: серверная View с языком пропом = клиентская обёртка в контексте', () => {
  test.each(LOCALES)('%s: ноль, люди, свежий и давний замер, без замера', (locale) => {
    const cases: Array<[number | null, number | null | undefined, number]> = [
      [null, undefined, NOW],
      [0, NOW - 60, NOW],
      [0, NOW - 3 * 86_400, NOW],
      [0, undefined, NOW],
      [1, NOW - 60, NOW],
      [1, NOW - 3 * 86_400, NOW],
      [1234, NOW - 60, NOW],
      [1234, null, NOW],
      [850_123, NOW - 3600, Number.POSITIVE_INFINITY],
    ]
    for (const [ccu, ccuAt, nowSec] of cases) {
      const server = renderToStaticMarkup(createElement(PlayersNowView, { ccu, ccuAt, nowSec, className: 'x', locale }))
      const client = renderToStaticMarkup(
        createElement(
          LocaleProvider,
          { locale } as ComponentProps<typeof LocaleProvider>,
          createElement(PlayersNow, { ccu, ccuAt, nowSec, className: 'x' }),
        ),
      )
      expect(server, `${ccu} ${ccuAt} ${nowSec}`).toBe(client)
    }
    expect(text(renderToStaticMarkup(createElement(PlayersNowView, { ccu: 1234, ccuAt: NOW - 60, nowSec: Number.POSITIVE_INFINITY, locale })))).toBe(
      locale === 'en' ? '1,234 were playing' : '1 234 играли',
    )
  })
})
