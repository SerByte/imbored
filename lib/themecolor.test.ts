import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { syncThemeColor, THEME_COLOR } from './themecolor'

/**
 * Цвет обвязки браузера — вслед за шапкой.
 *
 * DOM в тестах нет, поэтому документ и чтение стиля — заглушки: шапка с
 * заданным --bg и meta с тем, что сейчас в разметке.
 */

function page(headerBg: string | null, meta = true) {
  const tag = { content: THEME_COLOR }
  const header = {}
  const doc = {
    querySelector: (sel: string) => {
      if (sel === 'body > header') return headerBg === null ? null : header
      if (sel === 'meta[name="theme-color"]') return meta ? tag : null
      return null
    },
  } as unknown as Pick<Document, 'querySelector'>
  const styleOf = (el: Element) => {
    expect(el, 'стиль читается у шапки, а не у страницы').toBe(header)
    return { getPropertyValue: (name: string) => (name === '--bg' ? ` ${headerBg ?? ''}` : '') }
  }
  return { doc, styleOf, tag }
}

describe('syncThemeColor', () => {
  test('светлая тема над контентом — молочная полоса', () => {
    const { doc, styleOf, tag } = page('#f5f5f7')
    syncThemeColor(doc, styleOf)
    expect(tag.content).toBe('#f5f5f7')
  })

  /** Тот же человек на светлой, но шапка над героем: правило шапки дало ей --bg зоны */
  test('над кино-зоной — тёмная, в какой бы теме ни был сайт', () => {
    const { doc, styleOf, tag } = page('#050505')
    tag.content = '#f5f5f7'
    syncThemeColor(doc, styleOf)
    expect(tag.content).toBe('#050505')
  })

  test('«Что нового» — свой фон зоны, а не общий тёмный', () => {
    const { doc, styleOf, tag } = page('#050507')
    syncThemeColor(doc, styleOf)
    expect(tag.content).toBe('#050507')
  })

  test('нет шапки, meta или значения — цвет не трогаем', () => {
    for (const p of [page(null), page(''), page('#f5f5f7', false)]) {
      expect(() => syncThemeColor(p.doc, p.styleOf)).not.toThrow()
      expect(p.tag.content).toBe(THEME_COLOR)
    }
  })
})

const ROOT = path.join(__dirname, '..')
/** Код без комментариев: они цитируют то, что здесь ищется */
const code = (p: string) =>
  fs
    .readFileSync(path.join(ROOT, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*/gm, '')

/**
 * Два места, где меняется то, что стоит под шапкой, — и оба обязаны
 * перекрасить обвязку ПОСЛЕ своей правки: --bg шапки читается уже с новым
 * атрибутом.
 */
describe('обвязку перекрашивают те, кто меняет шапку', () => {
  test('ChromeZone — на каждом решении наблюдателя, после data-chrome', () => {
    const src = code('components/ChromeZone.tsx')
    const at = src.indexOf('new IntersectionObserver(')
    expect(at, 'наблюдатель не найден — сторож ослеп').toBeGreaterThan(-1)
    const callback = src.slice(at, src.indexOf('{ rootMargin', at))
    const attr = callback.lastIndexOf('root.dataset.chrome')
    const sync = callback.indexOf('syncThemeColor()')
    expect(sync, 'наблюдатель меняет шапку, а адресная строка остаётся прежней').toBeGreaterThan(-1)
    expect(sync, 'перекрашивать после data-chrome, иначе прочитается старый --bg').toBeGreaterThan(attr)
  })

  test('ThemeToggle — после data-theme', () => {
    const src = code('components/ThemeToggle.tsx')
    const at = src.indexOf('function toggle()')
    expect(at, 'toggle не найден — сторож ослеп').toBeGreaterThan(-1)
    const body = src.slice(at, src.indexOf('\n  }\n', at))
    const attr = body.lastIndexOf('dataset.theme')
    const sync = body.indexOf('syncThemeColor()')
    expect(sync, 'тема сменилась, а адресная строка осталась прежней').toBeGreaterThan(-1)
    expect(sync).toBeGreaterThan(attr)
  })
})
