import { describe, expect, test } from 'vitest'
import { SOURCE_BADGE } from './sources'
import { CANDIDATE_SOURCES } from './types'

describe('SOURCE_BADGE', () => {
  // Тест, который поймает пятый источник через год: типы заставят добавить
  // ключ, но не заставят написать в него что-то осмысленное
  test('у каждого источника есть непустая подпись', () => {
    for (const source of CANDIDATE_SOURCES) {
      expect(SOURCE_BADGE[source]?.trim().length).toBeGreaterThan(0)
    }
  })

  test('подписи не повторяются: иначе источники сливаются для читателя', () => {
    const values = CANDIDATE_SOURCES.map((s) => SOURCE_BADGE[s])
    expect(new Set(values).size).toBe(values.length)
  })
})
