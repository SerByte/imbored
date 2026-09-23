import { describe, expect, test } from 'vitest'
import { createDb } from './db'
import { CYRILLIC_GLOB, CYRILLIC_LETTERS, hasCyrillic } from './cyrillic'

describe('hasCyrillic', () => {
  test('одной русской буквы достаточно, латиница и пустое — нет', () => {
    expect(hasCyrillic('Станьте вором в VR!')).toBe(true)
    expect(hasCyrillic('A game about Москва')).toBe(true)
    expect(hasCyrillic('ёж')).toBe(true)
    expect(hasCyrillic('Rise, Tarnished')).toBe(false)
    expect(hasCyrillic('')).toBe(false)
    expect(hasCyrillic(null)).toBe(false)
    expect(hasCyrillic(undefined)).toBe(false)
  })

  test('в классе все 66 букв, включая ё и Ё', () => {
    expect(new Set(CYRILLIC_LETTERS).size).toBe(66)
    expect(CYRILLIC_LETTERS).toContain('ё')
    expect(CYRILLIC_LETTERS).toContain('Ё')
  })

  test('SQL-шаблон отвечает на тех же строках то же, что JS', async () => {
    // Правило живёт в двух языках сразу: апсерт и заливка проверяют его в
    // SQL, mergeMeta — в JS. Разъехаться они не должны ни на одной букве.
    const db = await createDb(':memory:')
    const samples = ['Ёлка', 'ёлка', 'щука', 'Rise', '', 'Mixed Щ', '123', 'Ω omega']
    for (const text of samples) {
      const r = await db.execute({ sql: `SELECT ? GLOB ${CYRILLIC_GLOB} AS hit`, args: [text] })
      expect(Boolean(Number(r.rows[0].hit)), text).toBe(hasCyrillic(text))
    }
  })
})
