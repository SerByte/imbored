import { describe, expect, test } from 'vitest'
import { easeByName } from '@/components/morph/tween'

/**
 * Кривые твина слайдера совпадают с кривыми gsap, которые он заменил:
 * страницы по-прежнему передают ease именами gsap (HeroShots — power1.inOut).
 */
describe('easeByName', () => {
  test('концы всегда 0 и 1', () => {
    for (const name of ['power1.inOut', 'power2.out', 'power3.in', 'sine.inOut', 'expo.out', 'none', 'что-то']) {
      const f = easeByName(name)
      expect(f(0), name).toBeCloseTo(0, 6)
      expect(f(1), name).toBeCloseTo(1, 6)
    }
  })

  test('power2.out — кубическая, как у gsap', () => {
    expect(easeByName('power2.out')(0.5)).toBeCloseTo(1 - 0.5 ** 3, 6)
  })

  test('inOut симметрична: середина — ровно половина', () => {
    for (const name of ['power1.inOut', 'power3.inOut', 'sine.inOut', 'expo.inOut']) {
      expect(easeByName(name)(0.5), name).toBeCloseTo(0.5, 6)
    }
  })

  test('незнакомое имя — power2.out', () => {
    expect(easeByName('bounce.out')(0.3)).toBeCloseTo(easeByName('power2.out')(0.3), 6)
  })
})
