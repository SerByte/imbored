import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Отметка продления входа — одна на вкладку, общая для главной и
 * SessionKeeper (lib/sessiontouch). Главная зовёт touch сама и ставит
 * отметку; SessionKeeper, приехавший чанком закулисья позже, обязан её
 * увидеть и второй раз не звать — а в остальном держать прежний шаг в 12
 * часов и повтор после сбоя.
 */

const HOUR = 60 * 60 * 1000

async function fresh() {
  vi.resetModules()
  return import('./sessiontouch')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('отметка продления входа', () => {
  test('первое продление вкладки — сразу, второе — не раньше чем через 12 часов', async () => {
    const m = await fresh()
    expect(m.claimSessionTouch()).toBe(true)
    expect(m.claimSessionTouch(), 'второй вызов подряд ушёл бы дублем').toBe(false)
    vi.advanceTimersByTime(12 * HOUR - 1)
    expect(m.claimSessionTouch()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(m.claimSessionTouch()).toBe(true)
  })

  test('главная отметила своё продление — SessionKeeper не дублирует его', async () => {
    const m = await fresh()
    m.markSessionTouched()
    expect(m.claimSessionTouch()).toBe(false)
    vi.advanceTimersByTime(12 * HOUR)
    expect(m.claimSessionTouch()).toBe(true)
  })

  test('сбой снимает отметку — следующая попытка состоится', async () => {
    const m = await fresh()
    expect(m.claimSessionTouch()).toBe(true)
    m.forgetSessionTouch()
    expect(m.claimSessionTouch()).toBe(true)
  })
})
