import { describe, expect, test } from 'vitest'
import { joinTagDictionaries, normalizePairs, renderTagsRuModule } from './tagsrugen'

describe('генератор русских подписей тегов', () => {
  test('словари склеиваются по tagid, а не по порядку', () => {
    const en = new Map([
      [1716, 'Roguelike'],
      [19, 'Action'],
      [7, 'Без перевода'],
    ])
    const ru = new Map([
      [19, 'Экшен'],
      [1716, 'Рогалик'],
    ])
    expect(joinTagDictionaries(en, ru)).toEqual([
      ['Roguelike', 'Рогалик'],
      ['Action', 'Экшен'],
    ])
  })

  test('пробелы по краям срезаются, пустые и повторы выпадают, порядок устойчив', () => {
    const pairs = normalizePairs([
      ['Dystopian ', 'Антиутопия'],
      ['Dinosaurs', 'Динозавры '],
      ['Empty', '  '],
      ['Action', 'Экшен'],
      ['Action', 'Дубль'],
    ])
    expect(pairs).toEqual([
      ['Action', 'Экшен'],
      ['Dinosaurs', 'Динозавры'],
      ['Dystopian', 'Антиутопия'],
    ])
  })

  test('файл — валидный модуль: апостроф и обратная косая не ломают строку', () => {
    const text = renderTagsRuModule(
      [
        ["Shoot 'Em Up", "Shoot 'em up"],
        ['A\\B', 'А\\Б'],
        ['Action', 'Экшен'],
      ],
      'тест',
    )
    const body = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
    const obj = new Function(`return ${body}`)() as Record<string, string>
    expect(obj).toEqual({ "Shoot 'Em Up": "Shoot 'em up", 'A\\B': 'А\\Б', Action: 'Экшен' })
    expect(text).toContain('Пар: 3.')
    expect(text).toContain('руками не править')
  })
})
