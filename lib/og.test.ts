import { describe, expect, test } from 'vitest'
import { ogNum } from './og'

/** Неразрывный пробел: им Intl в ru-RU разбивает разряды */
const NB = String.fromCharCode(0xa0)

/**
 * Число на карточке — с разрядами её языка: русские пробелы посреди
 * английской фразы читались бы как два числа.
 */
describe('ogNum', () => {
  test('без языка — по-русски, как было', () => {
    expect(ogNum(4404)).toBe(`4${NB}404`)
    expect(ogNum(12)).toBe('12')
    expect(ogNum(4404, 'ru')).toBe(ogNum(4404))
  })

  test('по-английски — запятая в разрядах', () => {
    expect(ogNum(4404, 'en')).toBe('4,404')
    expect(ogNum(1_234_567, 'en')).toBe('1,234,567')
    expect(ogNum(0, 'en')).toBe('0')
  })
})
