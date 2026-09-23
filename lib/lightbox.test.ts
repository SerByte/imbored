import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { stepIndex, SWIPE_MIN, swipeStep } from './lightbox'

/**
 * Лайтбокс: листание и модальность.
 *
 * Чистая часть — шаг от свайпа и индекс по кругу. Остальное — подключение,
 * и оно проверяется чтением исходника: браузера в тестах нет, а каждая
 * половина модальности снимается одной строкой и глазом не видна. Замер,
 * с которого всё началось (/game/730, 1280×800): при открытом кадре колесо
 * сдвинуло страницу с 0 на 363, фон под затемнением оставался доступен, а
 * листать кадр можно было только стрелками клавиатуры.
 */

describe('свайп', () => {
  test('влево — следующий кадр, вправо — предыдущий', () => {
    expect(swipeStep(-SWIPE_MIN, 0)).toBe(1)
    expect(swipeStep(SWIPE_MIN + 10, 5)).toBe(-1)
  })

  test('короткое движение — нажатие, а не свайп', () => {
    expect(swipeStep(SWIPE_MIN - 1, 0)).toBe(0)
    expect(swipeStep(0, 0)).toBe(0)
  })

  test('вертикальное движение не листает', () => {
    expect(swipeStep(-60, 80)).toBe(0)
    expect(swipeStep(60, -60)).toBe(0)
  })
})

describe('индекс по кругу', () => {
  test('с последнего вперёд — на первый, с первого назад — на последний', () => {
    expect(stepIndex(5, 1, 6)).toBe(0)
    expect(stepIndex(0, -1, 6)).toBe(5)
    expect(stepIndex(2, 1, 6)).toBe(3)
  })

  test('пустой список не даёт NaN', () => {
    expect(stepIndex(0, 1, 0)).toBe(0)
  })
})

const ROOT = path.join(__dirname, '..')
/** Код без комментариев: докблоки цитируют то, что здесь ищется. */
const code = (p: string) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*/gm, '')

describe('лайтбокс модальный на деле', () => {
  const src = code('components/Lightbox.tsx')

  test('фон инертен, прокрутка удержана', () => {
    expect(src, 'без inert фон под затемнением читается скринридером').toMatch(/makeInert\(backdropOf\(/)
    expect(src, 'без паузы смузера колесо уводит страницу под кадром').toContain('holdScroll()')
  })

  /**
   * Порядок в очистке: в инертный узел фокус не встаёт, и возврат до снятия
   * inert уронил бы его в <body>.
   */
  test('при закрытии сначала снимается фон, потом возвращается фокус', () => {
    const inert = src.indexOf('releaseInert()')
    const scroll = src.indexOf('releaseScroll()')
    const focus = src.indexOf('previously.focus(')
    expect(inert).toBeGreaterThan(-1)
    expect(scroll).toBeGreaterThan(-1)
    expect(focus).toBeGreaterThan(inert)
    expect(src, 'фокус возвращается только в узел, который ещё в документе').toMatch(
      /previously\?\.isConnected\)\s*previously\.focus\(/,
    )
  })

  test('кадр листается кнопками и свайпом', () => {
    expect(src).toContain('aria-label="Предыдущий кадр"')
    expect(src).toContain('aria-label="Следующий кадр"')
    expect(src).toMatch(/onPointerUp=/)
    expect(src).toContain('swipeStep(')
  })

  test('смузер приносит лайтбоксу свою паузу', () => {
    const impl = code('components/SmoothScrollImpl.tsx')
    expect(impl).toMatch(/registerScrollPauser\(\(paused\) => live\.paused\(paused\)\)/)
    expect(impl, 'убитый смузер обязан отписаться').toContain('unregister?.()')
  })
})
