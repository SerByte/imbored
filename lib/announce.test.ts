import { describe, expect, test } from 'vitest'
import { freshLine, playLine, type PlayEvent } from './announce'

describe('playLine', () => {
  test('каждая смена героя называет игру, которая теперь на экране', () => {
    const events: PlayEvent[] = [
      { kind: 'reveal', name: 'Balatro' },
      { kind: 'restore', name: 'Balatro' },
      { kind: 'next', name: 'Balatro' },
      { kind: 'pick', name: 'Balatro' },
      { kind: 'reshape', name: 'Balatro' },
      { kind: 'refresh', name: 'Balatro' },
    ]
    for (const e of events) expect(playLine(e), e.kind).toContain('«Balatro»')
    // и строки разные: по звуку надо отличить «дальше» от «пересобрал»
    expect(new Set(events.map(playLine)).size).toBe(events.length)
  })

  test('бан говорит и что ушло, и что пришло на его место', () => {
    const line = playLine({ kind: 'ban', name: 'Dota 2', done: false, next: 'Terraria' })
    expect(line).toContain('«Dota 2» больше не покажу')
    expect(line).toContain('Следующая игра: «Terraria»')
  })

  test('«Уже прошёл» — не «больше не покажу»: игра кончилась, а не разонравилась', () => {
    const line = playLine({ kind: 'ban', name: 'Portal 2', done: true, next: 'Hades' })
    expect(line).toContain('«Portal 2» отмечена пройденной')
    expect(line).not.toContain('больше не покажу')
  })

  test('вопрос о причине говорит, что ответ необязателен', () => {
    expect(playLine({ kind: 'ask' })).toBe('Почему не то? Выбери причину или пропусти')
  })
})

describe('freshLine', () => {
  test('новая строка идёт как есть', () => {
    expect(freshLine('Следующая игра: «A»', 'Следующая игра: «B»')).toBe('Следующая игра: «B»')
    expect(freshLine('', 'Подобрал игру: «A»')).toBe('Подобрал игру: «A»')
  })

  test('повтор подряд меняет узел, не меняя слов', () => {
    const line = 'Следующая игра: «A»'
    const second = freshLine(line, line)
    expect(second).not.toBe(line)
    expect(second.trim()).toBe(line)
    // третий повтор снова отличается от второго — и так сколько угодно раз
    expect(freshLine(second, line)).toBe(line)
  })
})
