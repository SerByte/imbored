import { afterEach, describe, expect, test } from 'vitest'
import { sessionCookieOptions, sessionSecret } from './server'

/**
 * Два предохранителя окружения. Оба про один и тот же класс ошибки: молчаливую
 * подстановку небезопасного значения по умолчанию там, где отсутствие
 * переменной обязано быть отказом.
 */

const ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ENV }
})

describe('sessionSecret', () => {
  test('в проде без переменной — отказ, а не заглушка', () => {
    process.env = { ...ENV, NODE_ENV: 'production' }
    delete process.env.SESSION_SECRET
    expect(() => sessionSecret()).toThrow(/SESSION_SECRET/)
  })

  test('на Vercel без переменной — тоже отказ, даже если NODE_ENV не production', () => {
    process.env = { ...ENV, VERCEL: '1', NODE_ENV: 'development' }
    delete process.env.SESSION_SECRET
    expect(() => sessionSecret()).toThrow(/SESSION_SECRET/)
  })

  test('заданный секрет побеждает везде', () => {
    process.env = { ...ENV, NODE_ENV: 'production', SESSION_SECRET: 'достаточно-длинный-секрет' }
    expect(sessionSecret()).toBe('достаточно-длинный-секрет')
  })

  test('локально работает без секрета — иначе разработку не начать', () => {
    process.env = { ...ENV, NODE_ENV: 'development' }
    delete process.env.SESSION_SECRET
    delete process.env.VERCEL
    expect(sessionSecret()).toBeTruthy()
  })
})

describe('кука сессии', () => {
  test('httpOnly и sameSite стоят всегда', () => {
    const o = sessionCookieOptions()
    expect(o.httpOnly).toBe(true)
    expect(o.sameSite).toBe('lax')
  })

  test('secure в проде', () => {
    process.env = { ...ENV, NODE_ENV: 'production' }
    expect(sessionCookieOptions().secure).toBe(true)
  })

  test('secure выключен локально: на http://localhost браузер такую куку не примет', () => {
    process.env = { ...ENV, NODE_ENV: 'development' }
    expect(sessionCookieOptions().secure).toBe(false)
  })
})
