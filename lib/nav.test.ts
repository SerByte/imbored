import { describe, expect, test } from 'vitest'
import { isNavActive, navPrefetch } from './nav'

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

  test('язык в адресе не в счёт: /en/… и внутренний /ru/… — тот же раздел', () => {
    expect(isNavActive('/en/whatsnew', '/whatsnew')).toBe(true)
    expect(isNavActive('/en/play', '/quiz', ['/play'])).toBe(true)
    expect(isNavActive('/en/room/ABC123', '/rooms', ['/room'])).toBe(true)
    expect(isNavActive('/ru/daily', '/daily')).toBe(true)
    // главная — точно и на английском
    expect(isNavActive('/en', '/')).toBe(true)
    expect(isNavActive('/en/', '/')).toBe(true)
    expect(isNavActive('/en/quiz', '/')).toBe(false)
    expect(isNavActive('/enx', '/')).toBe(false)
  })
})

describe('navPrefetch на английском', () => {
  test('динамический раздел — без префетча и под /en', () => {
    expect(navPrefetch('/en/library')).toBe(false)
    expect(navPrefetch('/en/compat/76561198000000000')).toBe(false)
    expect(navPrefetch('/en/daily')).toBeUndefined()
    expect(navPrefetch('/en')).toBeUndefined()
  })
})
