import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { LocaleProvider } from '@/components/LocaleProvider'
import { PlayersNow } from '@/components/PlayersNow'

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
})
