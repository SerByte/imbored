import { describe, expect, test } from 'vitest'
import { LEANS, NEUTRAL_MOOD, parseLean, parseMood } from './mood'

describe('parseLean', () => {
  test('каждое известное значение проходит как есть', () => {
    for (const lean of LEANS) expect(parseLean(lean)).toBe(lean)
  })

  /**
   * Неверный lean молча игнорируется, а не даёт 400: у /api/recommend каждый
   * код ошибки обязан иметь экран на /play (lib/failscreens.test.ts), и
   * опечатка в адресе не стоит отдельного экрана — подбор идёт без оси.
   */
  test('мусор, другой регистр, массив и пустота дают null', () => {
    expect(parseLean('Familiar')).toBeNull()
    expect(parseLean('nostalgia')).toBeNull()
    expect(parseLean(['fresh'])).toBeNull()
    expect(parseLean(1)).toBeNull()
    expect(parseLean('')).toBeNull()
    expect(parseLean(undefined)).toBeNull()
    expect(parseLean(null)).toBeNull()
  })
})

describe('parseMood', () => {
  test('ось состояния в настроение не просачивается', () => {
    expect(parseMood({ ...NEUTRAL_MOOD, lean: 'familiar' })).toEqual(NEUTRAL_MOOD)
  })
})
