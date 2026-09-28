import { describe, expect, test } from 'vitest'
import { splitWords } from './splitwords'

describe('splitWords', () => {
  test('режет по пробелам, лишние пробелы не дают пустых слов', () => {
    expect(splitWords('Демо-игрок × Демо-друг')).toEqual(['Демо-игрок', '×', 'Демо-друг'])
    expect(splitWords('  Hollow   Knight\n ')).toEqual(['Hollow', 'Knight'])
  })

  test('неразрывный пробел остаётся внутри слова', () => {
    expect(splitWords('Mass\u00a0Effect 2')).toEqual(['Mass\u00a0Effect', '2'])
  })

  test('пустая строка — ни одного слова', () => {
    expect(splitWords('')).toEqual([])
  })
})
