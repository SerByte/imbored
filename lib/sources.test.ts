import { describe, expect, test } from 'vitest'
import { SOURCE_BADGE, SOURCE_BADGE_SHORT } from './sources'
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

describe('SOURCE_BADGE_SHORT', () => {
  // Те же два правила: короткая карта живёт в плитках выдачи, и пустая или
  // повторяющаяся подпись там так же молча сливает источники.
  test('у каждого источника есть непустая короткая подпись', () => {
    for (const source of CANDIDATE_SOURCES) {
      expect(SOURCE_BADGE_SHORT[source]?.trim().length).toBeGreaterThan(0)
    }
  })

  test('короткие подписи не повторяются', () => {
    const values = CANDIDATE_SOURCES.map((s) => SOURCE_BADGE_SHORT[s])
    expect(new Set(values).size).toBe(values.length)
  })

  // Смысл карты — влезть в плитку в 134px: короткая форма длиннее полной
  // была бы уже не короткой.
  test('короткая форма не длиннее полной', () => {
    for (const source of CANDIDATE_SOURCES) {
      expect(SOURCE_BADGE_SHORT[source].length).toBeLessThanOrEqual(SOURCE_BADGE[source].length)
    }
  })
})
