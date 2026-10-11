import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  FOCUS_RING,
  focusBand,
  HEADER_CLEARANCE,
  NAV_GAP,
  needsReveal,
  overlaps,
  takeFocus,
  withFocusRing,
  type FocusTarget,
} from './skiplink'

/**
 * Сторож «К содержанию» и фокуса под панелями.
 *
 * Ссылка «К содержанию» — единственный механизм обхода блоков на сайте
 * (WCAG 2.4.1, уровень A). Под смузером её клик перехватывался ради плавной
 * прокрутки, и фокус оставался на ссылке: замер через CDP, 1280×800 — Tab →
 * «К содержанию», Enter, следующий Tab уходил на «imbored» в шапке. Страница
 * при этом честно уезжала к <main>, то есть глазом поломка не видна вовсе.
 *
 * Вторая половина — WCAG 2.4.11 (Focus Not Obscured): на телефоне элемент в
 * фокусе прятался под нижней панелью целиком, потому что смузер считает
 * видимым всё, что задело экран хоть пикселем.
 *
 * Сторож держит обе половины: чистые решения — тестами, их подключение —
 * чтением исходников. Браузерный замер повторять в тестах нечем, а
 * поломка возвращается одной строкой: достаточно убрать tabIndex у <main> или
 * вызов takeFocus из обработчика якорей.
 */

const ROOT = path.join(__dirname, '..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** Код без комментариев: докблоки цитируют то, что здесь ищется. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '')

/** Цель якоря: ведёт себя как DOM-элемент ровно в тех местах, что нужны takeFocus. */
function fakeTarget(tabIndex: number, attr: string | null = null) {
  const attrs = new Map<string, string>()
  if (attr !== null) attrs.set('tabindex', attr)
  const calls: Array<{ preventScroll?: boolean } | undefined> = []
  const el: FocusTarget & { attrs: Map<string, string>; calls: typeof calls } = {
    tabIndex,
    attrs,
    calls,
    hasAttribute: (n) => attrs.has(n),
    setAttribute: (n, v) => void attrs.set(n, v),
    focus: (o) => void calls.push(o),
  }
  return el
}

describe('перенос фокуса на цель якоря', () => {
  test('обычный блок получает tabindex="-1" и фокус без прокрутки', () => {
    const main = fakeTarget(-1)
    takeFocus(main)
    expect(main.attrs.get('tabindex')).toBe('-1')
    expect(main.calls).toEqual([{ preventScroll: true }])
  })

  /**
   * Ссылка и кнопка фокусируются сами, и tabIndex у них 0 без всякого
   * атрибута. Отрицательный вынул бы их из обхода по Tab — ровно обратное
   * тому, ради чего фокус переносят.
   */
  test('фокусируемый сам элемент атрибута не получает', () => {
    const link = fakeTarget(0)
    takeFocus(link)
    expect(link.attrs.has('tabindex')).toBe(false)
    expect(link.calls).toHaveLength(1)
  })

  test('свой tabindex у цели не переписывается', () => {
    const custom = fakeTarget(-1, '-1')
    takeFocus(custom)
    expect(custom.attrs.get('tabindex')).toBe('-1')
    const positive = fakeTarget(2, '2')
    takeFocus(positive)
    expect(positive.attrs.get('tabindex')).toBe('2')
  })
})

describe('видимая полоса экрана', () => {
  test('на десктопе панели нет: низ полосы — низ окна', () => {
    // md:hidden отдаёт нулевой прямоугольник, а не null
    expect(focusBand(800, { top: 0, bottom: 0, height: 0 })).toEqual({ top: HEADER_CLEARANCE, bottom: 800 })
    expect(focusBand(800, null)).toEqual({ top: HEADER_CLEARANCE, bottom: 800 })
  })

  test('на телефоне низ полосы — верх панели с зазором под кольцо', () => {
    expect(focusBand(844, { top: 792, bottom: 844, height: 52 })).toEqual({
      top: HEADER_CLEARANCE,
      bottom: 792 - NAV_GAP,
    })
  })
})

describe('когда досматривать элемент в фокусе', () => {
  const phone = focusBand(844, { top: 792, bottom: 844, height: 52 })

  /** Ровно замер с /play: ссылка задела экран, но стоит под панелью. */
  test('ссылка под нижней панелью — досматривать', () => {
    expect(needsReveal({ top: 826, bottom: 846, height: 20 }, phone)).toBe(true)
  })

  test('частично под панелью — тоже', () => {
    // /library: плитки на 748–869 закрыты панелью наполовину
    expect(needsReveal({ top: 748, bottom: 869, height: 121 }, phone)).toBe(true)
  })

  test('под шапкой — досматривать', () => {
    expect(needsReveal({ top: 40, bottom: 60, height: 20 }, phone)).toBe(true)
  })

  test('целиком в полосе — не трогать', () => {
    expect(needsReveal({ top: 300, bottom: 340, height: 40 }, phone)).toBe(false)
    expect(needsReveal({ top: HEADER_CLEARANCE, bottom: phone.bottom, height: phone.bottom - HEADER_CLEARANCE }, phone)).toBe(false)
  })

  /**
   * <main> после «К содержанию» или длинная секция в полосу не помещаются
   * никак. Центрирование таких уводило бы страницу туда, где человек не
   * просил, — решение остаётся за правилом смузера.
   */
  test('то, что в полосу не помещается, не досматривается', () => {
    expect(needsReveal({ top: 0, bottom: 3000, height: 3000 }, phone)).toBe(false)
  })
})

describe('подключение', () => {
  const impl = code(read('components/SmoothScrollImpl.tsx'))
  const layout = read('app/layout.tsx')
  const css = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

  test('обработчик якорей переносит фокус', () => {
    const at = impl.indexOf("closest?.('a[href^=\"#\"]')")
    expect(at, 'перехват кликов по якорям не найден').toBeGreaterThan(-1)
    const handler = impl.slice(at, impl.indexOf('document.addEventListener', at))
    expect(handler, 'без переноса фокуса «К содержанию» ведёт обратно в шапку').toContain('takeFocus(target)')
  })

  test('смузер досматривает фокус своим правилом', () => {
    const at = impl.indexOf('ScrollSmoother.create(')
    const opts = impl.slice(at, impl.indexOf('})', at))
    expect(opts, 'без onFocusIn элемент под нижней панелью считается видимым').toMatch(/\bonFocusIn\b/)
    expect(impl).toContain('needsReveal(')
  })

  test('<main> принимает фокус и не встаёт в обход по Tab', () => {
    const at = layout.indexOf('<main id="main"')
    expect(at, '<main id="main"> не найден').toBeGreaterThan(-1)
    const tag = layout.slice(at, layout.indexOf('>', at))
    expect(tag).toContain('tabIndex={-1}')
  })

  test('отступ сверху в CSS и у смузера — одно число', () => {
    const m = css.match(/html\s*\{\s*scroll-padding-top:\s*(\d+(?:\.\d+)?)rem/)
    expect(m, 'scroll-padding-top у html не найден').not.toBeNull()
    expect(Number(m?.[1]) * 16).toBe(HEADER_CLEARANCE)
  })

  test('нативная прокрутка к фокусу оставляет место под нижней панелью', () => {
    const at = css.indexOf('@media (max-width: 767px) {\n  html {')
    expect(at, 'правило для html под нижнюю панель не найдено').toBeGreaterThan(-1)
    const block = css.slice(at, css.indexOf('}', at))
    expect(block).toMatch(/scroll-padding-bottom:\s*calc\(52px \+ env\(safe-area-inset-bottom\)/)
  })
})

/**
 * Записка «Режим просмотра» не прячет фокус — WCAG 2.4.11.
 *
 * После входа по ссылке на профиль (главный путь гостя) записка стоит fixed
 * на top: 80px — ровно на линии scroll-padding-top, куда браузер ставит
 * элемент, прокрученный к фокусу. Shift+Tab вверх по кнопкам /play прятал
 * каждый новый фокус целиком под панелью высотой ~130 px. Убрать её было
 * можно только «Понятно» — последней остановкой Tab после всего подвала
 * (портал в конце body), а после нажатия фокус падал в body.
 *
 * Теперь: Escape закрывает её, не двигая фокус (исключение самого критерия
 * для содержимого, которое убирается без переноса фокуса); фокус, вставший
 * под неё, её убирает; «Понятно» отдаёт фокус <main>, а не body.
 *
 * Убирает только фокус с клавиатуры (:focus-visible). Первая версия уходила
 * от любого: на /quiz ответ кликом переводит фокус на заголовок следующего
 * вопроса прямо под запиской, и одноразовая записка пропадала после первого
 * же ответа у человека, который её не закрывал и кольца не видел. И
 * сравнивается рамка с кольцом: кнопка вплотную под запиской по голой рамке
 * «не перекрыта», а верх её кольца — под ней.
 */
describe('записка «Режим просмотра» не прячет фокус', () => {
  const box = (top: number, bottom: number, left = 0, right = 100) => ({ top, bottom, left, right })

  test('перекрытие — общая площадь, касание краем не в счёт', () => {
    expect(overlaps(box(80, 210), box(100, 140))).toBe(true)
    expect(overlaps(box(80, 210), box(60, 90))).toBe(true)
    expect(overlaps(box(80, 210), box(210, 250))).toBe(false)
    expect(overlaps(box(80, 210), box(20, 80))).toBe(false)
    expect(overlaps(box(80, 210, 400, 1000), box(100, 140, 0, 400))).toBe(false)
  })

  test('кольцо фокуса считается: кнопка вплотную под запиской перекрыта', () => {
    const note = box(80, 210)
    const flush = box(210, 250)
    expect(overlaps(flush, note), 'голая рамка кольца не знает').toBe(false)
    expect(overlaps(withFocusRing(flush), note)).toBe(true)
    // Кольцо целиком ниже записки — повода уходить нет
    expect(overlaps(withFocusRing(box(210 + FOCUS_RING, 250)), note)).toBe(false)
    expect(withFocusRing(box(100, 140, 10, 50))).toEqual({
      top: 100 - FOCUS_RING,
      bottom: 140 + FOCUS_RING,
      left: 10 - FOCUS_RING,
      right: 50 + FOCUS_RING,
    })
  })

  /**
   * Подложка кольца — box-shadow от рамки элемента, а не от линии outline:
   * она лежит в тех же пикселях, что отступ и линия. Прежний докблок NAV_GAP
   * складывал их в 8 px «вокруг элемента», и эта ошибка ушла бы в замер
   * записки. Константа обязана совпадать с самим правилом.
   */
  test('FOCUS_RING — ровно то, на сколько кольцо :focus-visible выходит за рамку', () => {
    const css = read('app/globals.css')
    const block = css.match(/^:focus-visible \{([^}]*)\}/m)?.[1] ?? ''
    const width = Number(block.match(/outline:\s*(\d+)px/)?.[1] ?? NaN)
    const offset = Number(block.match(/outline-offset:\s*(\d+)px/)?.[1] ?? NaN)
    const spread = Number(block.match(/box-shadow:\s*0 0 0 (\d+)px/)?.[1] ?? NaN)
    expect([width, offset, spread].every(Number.isFinite), 'правило :focus-visible не разобрано').toBe(true)
    expect(FOCUS_RING).toBe(Math.max(offset + width, spread))
    expect(NAV_GAP, 'зазор над панелью меньше самого кольца').toBeGreaterThanOrEqual(FOCUS_RING)
  })

  const note = code(read('components/ReadOnlyNote.tsx'))

  test('Escape закрывает записку', () => {
    expect(note).toMatch(/addEventListener\('keydown'/)
    expect(note).toMatch(/e\.key === 'Escape'/)
    expect(note).toMatch(/removeEventListener\('keydown'/)
  })

  test('фокус, вставший под записку, её убирает', () => {
    expect(note).toMatch(/addEventListener\('focusin'/)
    expect(note).toMatch(/overlaps\(withFocusRing\(at\.getBoundingClientRect\(\)\)/)
    expect(note).toMatch(/removeEventListener\('focusin'/)
  })

  test('уходит только от фокуса с клавиатуры', () => {
    expect(note, 'фокус от клика на /quiz прятал записку после первого ответа').toMatch(
      /if \(!at\.matches\(':focus-visible'\)\) return/,
    )
    expect(note.indexOf(":focus-visible')")).toBeLessThan(note.indexOf('overlaps('))
  })

  test('«Понятно» отдаёт фокус <main>, а не body', () => {
    expect(note).toMatch(/focusAdrift\(document, box\.current\)/)
    expect(note).toMatch(/takeFocus\(/)
    expect(note).toMatch(/getElementById\('main'\)/)
    expect(note).toMatch(/onClick=\{dismiss\}/)
  })
})
