import { describe, expect, test } from 'vitest'
import { ANSWER_VALUES, answerLabel, moodCaption, STEPS } from './quiz'
import type { Mood } from './types'

describe('STEPS', () => {
  test('три оси в порядке time → vibe → social', () => {
    expect(STEPS.map((s) => s.key)).toEqual(['time', 'vibe', 'social'])
  })

  test('у каждой оси есть короткая подпись и вопрос', () => {
    for (const step of STEPS) {
      expect(step.axis).toBeTruthy()
      expect(step.question).toBeTruthy()
      // подпись рельса должна быть заметно короче вопроса — иначе не влезет
      expect(step.axis.length).toBeLessThan(step.question.length)
    }
  })

  test('значения ответов не пересекаются между осями', () => {
    // на этом держится плоская карта подписей и подбор обложек по значению
    expect(new Set(ANSWER_VALUES).size).toBe(ANSWER_VALUES.length)
  })

  test('семь ответов: 3 + 2 + 2', () => {
    expect(STEPS.map((s) => s.options.length)).toEqual([3, 2, 2])
    expect(ANSWER_VALUES).toHaveLength(7)
  })
})

describe('answerLabel', () => {
  test('знает все семь значений', () => {
    for (const value of ANSWER_VALUES) expect(answerLabel(value)).toBeTruthy()
  })

  test('неизвестное значение даёт null, а не само значение', () => {
    // ?time=banana приезжает из адресной строки и не должен попасть в подпись
    expect(answerLabel('banana')).toBeNull()
    expect(answerLabel('')).toBeNull()
  })
})

describe('moodCaption', () => {
  test('собирает три подписи через разделитель', () => {
    const mood: Mood = { time: 'medium', vibe: 'chill', social: 'solo' }
    expect(moodCaption(mood)).toBe('Пара часов · Расслабиться · Один')
  })

  test('порядок всегда время → вайб → компания', () => {
    const mood: Mood = { time: 'long', vibe: 'engaged', social: 'friends' }
    expect(moodCaption(mood)).toBe('Весь вечер · Напрячься · С друзьями')
  })

  test('битые значения выпадают, остальное остаётся', () => {
    const mood = { time: 'banana', vibe: 'chill', social: 'solo' } as unknown as Mood
    expect(moodCaption(mood)).toBe('Расслабиться · Один')
  })

  test('полностью битое настроение даёт пустую строку, а не мусор', () => {
    const mood = { time: 'a', vibe: 'b', social: 'c' } as unknown as Mood
    expect(moodCaption(mood)).toBe('')
  })
})
