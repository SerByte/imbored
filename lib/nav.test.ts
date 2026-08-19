import { describe, expect, test } from 'vitest'
import { isNavActive } from './nav'

describe('isNavActive', () => {
  test('точное совпадение и вложенные пути', () => {
    expect(isNavActive('/whatsnew', '/whatsnew')).toBe(true)
    expect(isNavActive('/game/730', '/game')).toBe(true)
    expect(isNavActive('/rooms', '/room')).toBe(false)
  })

  test('корень не подсвечивает всё подряд', () => {
    // Любой путь начинается со слэша, поэтому startsWith тут был бы ловушкой.
    expect(isNavActive('/whatsnew', '/')).toBe(false)
    expect(isNavActive('/', '/')).toBe(true)
  })

  test('соседний путь с общим префиксом не считается своим', () => {
    expect(isNavActive('/playground', '/play')).toBe(false)
    expect(isNavActive('/play', '/play')).toBe(true)
    expect(isNavActive('/play/x', '/play')).toBe(true)
  })

  test('also подсвечивает пункт на страницах, куда он не ведёт', () => {
    // Выдача живёт на /play, а пункт зовётся «Подобрать игру» и ведёт на /quiz.
    expect(isNavActive('/play', '/quiz', ['/play'])).toBe(true)
    expect(isNavActive('/room/ABC123', '/rooms', ['/room'])).toBe(true)
    expect(isNavActive('/library', '/quiz', ['/play'])).toBe(false)
  })
})
