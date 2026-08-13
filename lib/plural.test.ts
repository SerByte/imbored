import { describe, expect, test } from 'vitest'
import { plural } from './plural'

describe('plural', () => {
  const games = (n: number) => plural(n, 'игра', 'игры', 'игр')

  test('единственное число', () => {
    expect(games(1)).toBe('игра')
    expect(games(21)).toBe('игра')
    expect(games(101)).toBe('игра')
  })

  test('от двух до четырёх', () => {
    expect(games(2)).toBe('игры')
    expect(games(4)).toBe('игры')
    expect(games(22)).toBe('игры')
    expect(games(104)).toBe('игры')
  })

  test('множественное', () => {
    expect(games(5)).toBe('игр')
    expect(games(0)).toBe('игр')
    expect(games(100)).toBe('игр')
  })

  test('подростковые числа — исключение из правила', () => {
    expect(games(11)).toBe('игр')
    expect(games(12)).toBe('игр')
    expect(games(14)).toBe('игр')
    expect(games(111)).toBe('игр')
  })
})
