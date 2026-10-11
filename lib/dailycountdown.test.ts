import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { CountdownLine, untilNextDaily } from '@/components/DailyCountdown'
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
    // aria-disabled, а не disabled — сторож lib/disabledfocus.test.ts
    expect(html).not.toMatch(/\sdisabled/)
  })
})
