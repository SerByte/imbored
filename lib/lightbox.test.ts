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

/**
 * Оверлей висит в портале, в <body>, и тем самым вне любой зоны — токены он
 * берёт у того, что сам на себе объявит. Композицию (счётчик и кнопки на
 * затемнении) считает lib/contrast.test.ts; здесь — подключение.
 */
describe('лайтбокс тёмный в обеих темах и не лезет под вырез', () => {
  const src = code('components/Lightbox.tsx')
  const at = src.indexOf('ref={overlayRef}')
  const root = src.slice(at).match(/className="([^"]*)"/)?.[1] ?? ''

  test('корень — тёмная поверхность, но не кино-зона', () => {
    expect(at, 'корень оверлея не найден — сторож ослеп').toBeGreaterThan(-1)
    expect(root, 'без тёмных токенов в светлой теме счётчик даёт 1.9:1').toMatch(/\bmedia-card\b/)
    expect(root, '.media-dark перекрасил бы шапку при открытии кадра').not.toMatch(/\bmedia-dark\b/)
    // .media-card красит фон вне слоёв: без !important утилита проиграет,
    // и сплошной --bg закроет затемнение с размытием
    expect(root).toMatch(/(?:^|\s)!bg-transparent\b/)
  })

  /**
   * Каждый отступ от края у абсолютного элемента — через max(…, env(…)) со
   * СВОЕЙ стороной. top-1/2 — центровка по высоте, а не отступ от края.
   */
  test('отступы от краёв берут вырез', () => {
    const offenders: string[] = []
    let seen = 0
    for (const m of src.matchAll(/className="([^"]*)"/g)) {
      const cls = m[1].split(/\s+/)
      if (!cls.includes('absolute') || cls.includes('inset-0')) continue
      for (const c of cls) {
        const side = c.match(/^(top|right|bottom|left)-(.+)$/)
        if (!side || c === 'top-1/2') continue
        seen++
        const safe = new RegExp(String.raw`^\[max\([\d.]+rem,env\(safe-area-inset-${side[1]}\)\)\]$`)
        if (!safe.test(side[2])) offenders.push(c)
      }
    }
    // крестик (сверху и справа), две стрелки, счётчик
    expect(seen, 'отступы не найдены — разбор ослеп').toBeGreaterThanOrEqual(5)
    expect(offenders, 'в ландшафте iPhone этот край уходит под вырез').toEqual([])
  })

  test('смена кадра озвучивается строкой, а «2/6» от скринридера спрятан', () => {
    expect(src).toMatch(/<StatusLine text=\{`Кадр \$\{index \+ 1\} из \$\{images\.length\}`\}/)
    expect(src, 'видимый счётчик голосом звучит дробью').toMatch(
      /<span\s+aria-hidden\s+className="[^"]*"\s*>\s*\{index \+ 1\}\/\{images\.length\}/,
    )
  })
})
