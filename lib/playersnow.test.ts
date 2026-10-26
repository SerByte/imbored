import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { LocaleProvider } from '@/components/LocaleProvider'
import { PlayersNow } from '@/components/PlayersNow'
import { PlayersAtCheck, playersBand, PlayersNow as PlayersNowView } from '@/components/PlayersNowView'
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
   * /en/game/<appid> (страница тогда рисовала эту строку всегда давним
   * замером) печаталось «онлайн при замере: 0».
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
 * components/PlayersNowView — модуль с языком пропом, components/PlayersNow —
 * клиентская обёртка с языком из контекста для экранов вне кэша (герой /play
 * и /daily, колода). Разметка у них одна.
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
      [850_123, NOW - 3600, NOW],
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
  })
})

describe('playersBand: ступень ряда 1–2–5 строго ниже числа', () => {
  test('12 345 — «больше 10 000», 730 — «больше 500»', () => {
    expect(playersBand(12_345)).toBe(10_000)
    expect(playersBand(730)).toBe(500)
    expect(playersBand(850_123)).toBe(500_000)
    expect(playersBand(1_300_000)).toBe(1_000_000)
  })

  test('ровно на ступени — ступень ниже: «больше» обязано быть правдой', () => {
    expect([2, 5, 10, 20, 50, 100, 10_000].map(playersBand)).toEqual([1, 2, 5, 10, 20, 50, 5_000])
    expect([3, 6, 11, 21, 51, 101].map(playersBand)).toEqual([2, 5, 10, 20, 50, 100])
  })

  test('ноль и единица — без ступени: ниже них нечего назвать', () => {
    expect(playersBand(0)).toBeNull()
    expect(playersBand(1)).toBeNull()
    expect(playersBand(Number.NaN)).toBeNull()
  })
})

/*
 * Онлайн на карточке игры — PlayersAtCheck: страница живёт в недельном кэше,
 * а ccu переписывают без порога сверка каталога и догрев /api/prepare.
 * Точное число делало бы новой страницей почти каждую перегенерацию
 * совместной игры, ступень стоит неделями. Часов нет: «сейчас» из кэша
 * правдой не бывает.
 */
describe('PlayersAtCheck', () => {
  const at = (ccu: number | null, locale: (typeof LOCALES)[number] = 'ru') =>
    renderToStaticMarkup(createElement(PlayersAtCheck, { ccu, locale }))

  test('ступенью и про замер, на обоих языках', () => {
    expect(text(at(12_345))).toBe('онлайн при замере: больше 10 000')
    expect(text(at(730))).toBe('онлайн при замере: больше 500')
    expect(text(at(12_345, 'en'))).toBe('online at last check: more than 10,000')
    expect(text(at(730, 'en'))).toBe('online at last check: more than 500')
    expect(at(12_345, 'en')).toContain('title="Last known player count"')
    expect(at(12_345, 'en')).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('два недельных замера в одной ступени — одна и та же разметка', () => {
    expect(at(14_902)).toBe(at(12_345))
    expect(at(14_902, 'en')).toBe(at(12_345, 'en'))
    expect(at(20_001)).not.toBe(at(12_345))
  })

  test('ноль — та же строка, что у PlayersNow по давнему замеру; единица — как есть', () => {
    for (const locale of LOCALES) {
      expect(at(0, locale)).toBe(
        renderToStaticMarkup(createElement(PlayersNowView, { ccu: 0, ccuAt: NOW - 3 * 86_400, nowSec: NOW, locale })),
      )
    }
    expect(text(at(1))).toBe('онлайн при замере: 1')
    expect(text(at(1, 'en'))).toBe('online at last check: 1')
  })

  test('ни слова «сейчас» и ни пульсирующей точки; замера нет — строки нет', () => {
    for (const locale of LOCALES) {
      for (const ccu of [0, 1, 7, 12_345]) {
        expect(at(ccu, locale)).not.toMatch(/сейчас|playing now|online now|anim-pulse-dot/)
      }
    }
    expect(at(null)).toBe('')
  })
})
