import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { CountdownLine, untilNextDaily } from '@/components/DailyCountdown'
import { LocaleProvider } from '@/components/LocaleProvider'
import { dayStartSec } from './daily'

/** 23:40 по Москве — за двадцать минут до смены игры дня */
const DAY = dayStartSec(1_780_000_000)
const LATE = DAY + 23 * 3600 + 40 * 60

describe('отсчёт до следующей игры дня', () => {
  test('считается от часов сервера до полуночи по Москве', () => {
    expect(untilNextDaily(LATE, LATE)).toBe(20 * 60)
    expect(untilNextDaily(LATE, LATE + 19 * 60 + 30)).toBe(30)
  })

  test('после полуночи — ноль, а не отрицательное и не «следующие сутки»', () => {
    // nowSec пришёл в ответе /api/daily вчера и сам не меняется: отсчёт
    // упирается в ноль, сколько бы вкладка ни висела открытой
    expect(untilNextDaily(LATE, DAY + 86_400)).toBe(0)
    expect(untilNextDaily(LATE, DAY + 86_400 + 5 * 3600)).toBe(0)
  })

  test('пока не сменилась — «Следующая через …»', () => {
    const html = renderToStaticMarkup(createElement(CountdownLine, { rest: 20 * 60 }))
    expect(html).toContain('Следующая через')
    expect(html).toContain('20 мин')
    expect(renderToStaticMarkup(createElement(CountdownLine, { rest: 30 }))).toContain('меньше минуты')
  })

  /*
   * Раньше после полуночи строка навсегда застывала на «Следующая через
   * меньше минуты», а герой, дата в пилюле и «Вчера была» оставались
   * вчерашними: страница читает /api/daily один раз, при монтировании.
   */
  test('сменилась — так и сказано, и есть кнопка показать новую', () => {
    const html = renderToStaticMarkup(createElement(CountdownLine, { rest: 0 }))
    expect(html).not.toContain('меньше минуты')
    expect(html).not.toContain('Следующая через')
    expect(html).toContain('Игра дня сменилась')
    expect(html).toMatch(/<button type="button"[^>]*>Показать<\/button>/)
    // без disabled: кнопка рабочая всегда, а disabled ловит сторож
    // lib/disabledfocus.test.ts
    expect(html).not.toMatch(/\sdisabled/)
  })
})

/*
 * /en/daily: та же строка словами глоссария — «Next one in …» и «New game of
 * the day». Язык — из контекста страницы (LocaleProvider), пропса нет.
 */
describe('отсчёт по-английски', () => {
  const en = (rest: number) =>
    renderToStaticMarkup(createElement(LocaleProvider, { locale: 'en' } as ComponentProps<typeof LocaleProvider>, createElement(CountdownLine, { rest })))

  test('пока не сменилась — «Next one in …», без кириллицы', () => {
    expect(en(5 * 3600 + 12 * 60)).toContain('Next one in')
    expect(en(5 * 3600 + 12 * 60)).toContain('5 h 12 min')
    expect(en(20 * 60)).toContain('20 min')
    expect(en(30)).toContain('under a minute')
    for (const rest of [30, 20 * 60, 5 * 3600]) expect(en(rest)).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('сменилась — «New game of the day» и кнопка «Show»', () => {
    const html = en(0)
    expect(html).toContain('New game of the day')
    expect(html).toMatch(/<button type="button"[^>]*>Show<\/button>/)
    expect(html).not.toMatch(/[А-Яа-яЁё]/)
  })
})
