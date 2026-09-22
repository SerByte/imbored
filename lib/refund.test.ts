import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { REFUND_NOTE, REFUND_NOTE_NEUTRAL, REFUND_URL, refundEligible, releaseStartSec } from './refund'

/** 23 сентября 2026, полдень UTC */
const NOW = Date.UTC(2026, 8, 23, 12) / 1000
const DAY = 86_400

const paid = { priceFinal: 1999, releaseDate: '2020-05-01' }

describe('refundEligible', () => {
  test('платная вышедшая игра Steam — да', () => {
    expect(refundEligible(paid, NOW)).toBe(true)
  })

  test('другой магазин — нет: его правила возврата не наши обещать', () => {
    expect(refundEligible({ ...paid, store: 'epic' }, NOW)).toBe(false)
  })

  test('бесплатной и игре без цены возвращать нечего', () => {
    expect(refundEligible({ ...paid, isFree: true }, NOW)).toBe(false)
    expect(refundEligible({ ...paid, priceFinal: 0 }, NOW)).toBe(false)
    expect(refundEligible({ releaseDate: '2020-05-01' }, NOW)).toBe(false)
  })

  test('предзаказ — нет, вышедшая сегодня — да', () => {
    expect(refundEligible({ ...paid, releaseDate: '2026-10-01' }, NOW)).toBe(false)
    expect(refundEligible({ ...paid, releaseDate: '2026-09-23' }, NOW)).toBe(true)
  })

  test('дата, которую не разобрать, считается прошедшей', () => {
    expect(refundEligible({ ...paid, releaseDate: 'Скоро' }, NOW)).toBe(true)
    expect(refundEligible({ ...paid, releaseDate: 'To be announced' }, NOW)).toBe(true)
    expect(refundEligible({ ...paid, releaseDate: undefined }, NOW)).toBe(true)
  })

  test('будущее, названное годом или кварталом, — тоже предзаказ', () => {
    expect(refundEligible({ ...paid, releaseDate: '2027' }, NOW)).toBe(false)
    expect(refundEligible({ ...paid, releaseDate: 'Q4 2026' }, NOW)).toBe(false)
    expect(refundEligible({ ...paid, releaseDate: '4 кв. 2026 г.' }, NOW)).toBe(false)
  })
})

describe('releaseStartSec', () => {
  test('ISO из GetItems — день в день', () => {
    expect(releaseStartSec('2025-06-16')).toBe(Date.UTC(2025, 5, 16) / 1000)
  })

  test('локаль appdetails: русская и английская', () => {
    expect(releaseStartSec('18 апр. 2011 г.')).toBe(Date.UTC(2011, 3, 18) / 1000)
    expect(releaseStartSec('Apr 18, 2011')).toBe(Date.UTC(2011, 3, 18) / 1000)
    expect(releaseStartSec('1 мая 2027 г.')).toBe(Date.UTC(2027, 4, 1) / 1000)
    expect(releaseStartSec('25 сен. 2026 г.')! > NOW).toBe(true)
  })

  test('неполная дата — нижняя граница периода', () => {
    expect(releaseStartSec('Sep 2026')).toBe(Date.UTC(2026, 8, 1) / 1000)
    expect(releaseStartSec('Q2 2027')).toBe(Date.UTC(2027, 3, 1) / 1000)
    expect(releaseStartSec('2027')).toBe(Date.UTC(2027, 0, 1) / 1000)
  })

  test('без года даты нет — Date.parse нашёл бы её и в «hello»', () => {
    expect(releaseStartSec('Скоро')).toBeNull()
    expect(releaseStartSec('Coming soon')).toBeNull()
    expect(releaseStartSec('')).toBeNull()
    expect(releaseStartSec(undefined)).toBeNull()
  })

  test('вышедшая месяц назад — в прошлом', () => {
    const lastMonth = new Date((NOW - 30 * DAY) * 1000).toISOString().slice(0, 10)
    expect(releaseStartSec(lastMonth)! < NOW).toBe(true)
  })
})

describe('текст', () => {
  test('называет оба условия Steam и ведёт на их правила', () => {
    for (const note of [REFUND_NOTE, REFUND_NOTE_NEUTRAL]) {
      expect(note).toContain('14 дней')
      expect(note).toContain('2 ч')
    }
    expect(REFUND_URL).toBe('https://store.steampowered.com/steam_refunds/')
  })

  /**
   * Возврат — факт интерфейса, а не довод причины. Модель, которой дали о нём
   * знать, начнёт продавать «купи и верни»; поэтому ни промпт, ни шаблоны
   * эвристики о нём не говорят.
   */
  test('в промпт и шаблоны причин возврат не попадает', () => {
    const llm = fs.readFileSync(path.join(__dirname, 'llm.ts'), 'utf8')
    expect(llm).not.toMatch(/refund|возврат|вернёт деньги/i)
  })
})
