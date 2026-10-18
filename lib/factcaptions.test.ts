import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { gamesCaption, hoursCaption, playedFact, unplayedCaption } from './factcaptions'

/**
 * Сторож согласования в трёх числах портрета.
 *
 * Проверка двойная и обе половины нужны. Первая — сами формы: подпись обязана
 * согласоваться с числом, а не быть верной на одном примере из демо-базы.
 * Вторая — что подписи не вернутся в разметку строками: связь между числом и
 * словом там существовать не может в принципе, потому что значение и подпись
 * приезжают в <Fact> разными пропами. Ровно так эта ошибка и появилась.
 */

const ROOT = path.join(__dirname, '..')

describe('подписи под числами портрета', () => {
  /** Разбор по последней цифре: 1 / 2–4 / 5–0, с ловушкой на 11–14. */
  const CASES: Array<[number, string, string, string]> = [
    [1, 'игра в библиотеке', 'час сыгран', 'почти не тронута'],
    [2, 'игры в библиотеке', 'часа сыграно', 'почти не тронуты'],
    [4, 'игры в библиотеке', 'часа сыграно', 'почти не тронуты'],
    [5, 'игр в библиотеке', 'часов сыграно', 'почти не тронуты'],
    [11, 'игр в библиотеке', 'часов сыграно', 'почти не тронуты'],
    [14, 'игр в библиотеке', 'часов сыграно', 'почти не тронуты'],
    [21, 'игра в библиотеке', 'час сыгран', 'почти не тронута'],
    [22, 'игры в библиотеке', 'часа сыграно', 'почти не тронуты'],
    [25, 'игр в библиотеке', 'часов сыграно', 'почти не тронуты'],
    [101, 'игра в библиотеке', 'час сыгран', 'почти не тронута'],
    [111, 'игр в библиотеке', 'часов сыграно', 'почти не тронуты'],
    [4404, 'игры в библиотеке', 'часа сыграно', 'почти не тронуты'],
    [0, 'игр в библиотеке', 'часов сыграно', 'почти не тронуты'],
  ]

  for (const [n, games, hours, unplayed] of CASES) {
    test(`${n}`, () => {
      expect(gamesCaption(n)).toBe(games)
      expect(hoursCaption(n)).toBe(hours)
      expect(unplayedCaption(n)).toBe(unplayed)
    })
  }

  /**
   * Портрет — единственная страница, сделанная ради пересылки, и те же три
   * подписи стоят в карточке для мессенджеров. Неверное окончание уезжает
   * туда картинкой, которую уже не отозвать, поэтому источник обязан быть
   * общим — иначе однажды поправят только одну из двух.
   */
  test('страница и карточка берут подписи из одного места', () => {
    for (const rel of [
      'app/[lang]/portrait/[steamid]/page.tsx',
      'app/[lang]/portrait/[steamid]/share-card.tsx',
      'app/[lang]/compat/[steamid]/share-card.tsx',
    ]) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      expect(src, `${rel} не подключает lib/factcaptions`).toContain('@/lib/factcaptions')
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
      for (const frozen of ['"игр в библиотеке"', '"часов сыграно"', '"почти не тронуты"']) {
        expect(code, `${rel}: подпись снова вписана строкой — ${frozen}`).not.toContain(frozen)
      }
    }
  })
})

/**
 * Герой портрета говорил «0 часов сыграно» над «Куда ушло время», где та же
 * игра подписана «20 мин»: часы округлялись раньше, чем решали подпись.
 */
describe('сколько сыграно — playedFact', () => {
  test('меньше получаса — минуты, и подпись согласована с ними', () => {
    expect(playedFact(20)).toEqual({ value: 20, caption: 'минут сыграно' })
    expect(playedFact(1)).toEqual({ value: 1, caption: 'минута сыграна' })
    expect(playedFact(22)).toEqual({ value: 22, caption: 'минуты сыграно' })
  })

  test('от получаса — часы, та же подпись, что у hoursCaption', () => {
    expect(playedFact(30)).toEqual({ value: 1, caption: 'час сыгран' })
    expect(playedFact(450 * 60)).toEqual({ value: 450, caption: hoursCaption(450) })
  })

  test('ноль — «0 часов»: в библиотеке ничего не запускали', () => {
    expect(playedFact(0)).toEqual({ value: 0, caption: 'часов сыграно' })
  })

  test('герой и карточка считают часы из минут через неё', () => {
    for (const rel of ['app/[lang]/portrait/[steamid]/page.tsx', 'app/[lang]/portrait/[steamid]/share-card.tsx']) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      expect(src, `${rel}: часы снова готовыми — «0 часов» у библиотеки на 20 минут`).toMatch(
        // вторым аргументом может стоять язык страницы: playedFact(minutes, locale)
        /playedFact\((wrapped|data)\.totalMinutes(?:,\s*\w+)?\)/,
      )
      expect(src, rel).not.toContain('totalHours')
    }
  })
})

/**
 * Английские подписи: одна единица — единственное число, всё прочее, включая
 * ноль, — множественное. Причастие не согласуется: «played» при любом числе.
 */
describe('подписи по-английски', () => {
  const CYRILLIC = /[А-Яа-яЁё]/

  test('игры, часы и бэклог', () => {
    expect(gamesCaption(1, 'en')).toBe('game in library')
    expect(gamesCaption(22, 'en')).toBe('games in library')
    expect(gamesCaption(0, 'en')).toBe('games in library')
    expect(hoursCaption(1, 'en')).toBe('hour played')
    expect(hoursCaption(21, 'en')).toBe('hours played')
    expect(unplayedCaption(1, 'en')).toBe('barely touched')
    expect(unplayedCaption(22, 'en')).toBe('barely touched')
  })

  test('playedFact: минуты меньше получаса, дальше часы', () => {
    expect(playedFact(1, 'en')).toEqual({ value: 1, caption: 'minute played' })
    expect(playedFact(20, 'en')).toEqual({ value: 20, caption: 'minutes played' })
    expect(playedFact(30, 'en')).toEqual({ value: 1, caption: 'hour played' })
    expect(playedFact(450 * 60, 'en')).toEqual({ value: 450, caption: 'hours played' })
    expect(playedFact(0, 'en')).toEqual({ value: 0, caption: 'hours played' })
  })

  test('ни одной русской буквы; явный ru — то же, что без языка', () => {
    for (const n of [0, 1, 2, 5, 11, 21, 101, 4404]) {
      for (const caption of [gamesCaption(n, 'en'), hoursCaption(n, 'en'), unplayedCaption(n, 'en')]) {
        expect(caption, String(n)).not.toMatch(CYRILLIC)
      }
      expect(playedFact(n, 'en').caption, String(n)).not.toMatch(CYRILLIC)
      expect(gamesCaption(n, 'ru')).toBe(gamesCaption(n))
      expect(hoursCaption(n, 'ru')).toBe(hoursCaption(n))
      expect(unplayedCaption(n, 'ru')).toBe(unplayedCaption(n))
      expect(playedFact(n, 'ru')).toEqual(playedFact(n))
    }
  })
})
