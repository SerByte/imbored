import { describe, expect, test } from 'vitest'
import { tierFrom } from './tier'

/**
 * Уровень исполнения. Понижение обязано быть предсказуемым и односторонним:
 * ошибка в сторону 'lean' стоит немного блеска, ошибка в сторону 'full' —
 * дёрганый квиз на слабой машине.
 */

describe('tierFrom', () => {
  test('обычная машина получает полный уровень', () => {
    expect(tierFrom({ cores: 8, memory: 8, longFrames: 0, sampled: 0 })).toBe('full')
  })

  test('два ядра — понижение', () => {
    expect(tierFrom({ cores: 2, memory: 8, longFrames: 0, sampled: 0 })).toBe('lean')
  })

  test('два гигабайта — понижение', () => {
    expect(tierFrom({ cores: 8, memory: 2, longFrames: 0, sampled: 0 })).toBe('lean')
  })

  test('молчание браузера — НЕ повод понижать', () => {
    // Safari и Firefox не отдают deviceMemory. Понижать там всех значило бы
    // наказать половину аудитории за то, что браузер не разговаривает.
    expect(tierFrom({ longFrames: 0, sampled: 0 })).toBe('full')
  })

  test('провальные кадры на показательной выборке — понижение', () => {
    expect(tierFrom({ cores: 8, memory: 8, longFrames: 20, sampled: 90 })).toBe('lean')
  })

  test('редкие провалы уровень не роняют', () => {
    expect(tierFrom({ cores: 8, memory: 8, longFrames: 5, sampled: 90 })).toBe('full')
  })

  test('короткая выборка не считается показательной', () => {
    // 20 из 30 — доля катастрофическая, но окно слишком мало: так выглядит
    // обычная гидрация, а не слабое железо.
    expect(tierFrom({ cores: 8, memory: 8, longFrames: 20, sampled: 30 })).toBe('full')
  })

  test('порог доли — строгий, ровно на границе уровень держится', () => {
    expect(tierFrom({ cores: 8, memory: 8, longFrames: 15, sampled: 100 })).toBe('full')
    expect(tierFrom({ cores: 8, memory: 8, longFrames: 16, sampled: 100 })).toBe('lean')
  })

  test('одного слабого сигнала достаточно', () => {
    expect(tierFrom({ cores: 1, memory: 16, longFrames: 0, sampled: 500 })).toBe('lean')
  })
})
