import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'

/**
 * Знак ожидания плитки (components/TilePending): что он рисует в покое и
 * пока ссылка ждёт, и что CSS ищет ровно его. Состояние ссылки подменяется:
 * настоящий useLinkStatus знает о нажатии только внутри живого роутера.
 */
const status = vi.hoisted(() => ({ pending: false }))
vi.mock('next/link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/link')>()),
  useLinkStatus: () => ({ pending: status.pending }),
}))

const { TilePending } = await import('@/components/TilePending')
const ROOT = path.join(__dirname, '..')

describe('TilePending', () => {
  test('в покое не рисует ничего: в HTML и RSC плиток ни лишнего узла', () => {
    status.pending = false
    expect(renderToStaticMarkup(createElement(TilePending))).toBe('')
  })

  test('пока ссылка ждёт — скрытый узел, который видит :has(), а раскладка нет', () => {
    status.pending = true
    expect(renderToStaticMarkup(createElement(TilePending))).toBe('<span hidden="" class="tile-pending"></span>')
  })

  test('CSS гасит обложку по этому узлу — с той же задержкой, что у подписей шапки', () => {
    const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')
    const at = css.indexOf('.game-card:has(.tile-pending) .card-thumb::after {')
    expect(at, 'правило ожидания плитки пропало — знак не виден').toBeGreaterThan(-1)
    const rule = css.slice(at, css.indexOf('}', at))
    // Задержка --dur-fast — как у .link-pending: быстрый переход не мигает
    expect(rule).toMatch(/tile-dim [^,]*var\(--dur-fast\) backwards/)
    expect(rule).toMatch(/tile-bar [^;]*var\(--dur-fast\) backwards/)
    // «Уменьшить движение»: хода нет, состояние после той же задержки остаётся
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^{}]*\.game-card:has\(\.tile-pending\) \.card-thumb::after \{\s*animation-duration: 0s;/,
    )
  })

  /*
   * «Похожие» на /game и полка /explore морфят обложку в героя: имя перехода
   * стоит на самой .card-thumb (components/Morph), а знак ожидания гаснет
   * только в коммите новой страницы. Без отмены на время перехода старый
   * снимок уносил бы погашенную обложку с полоской и растягивал её до героя.
   */
  test('на время перехода знак снят: морф уносит чистую обложку', () => {
    const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')
    const sel = ':root:active-view-transition .game-card:has(.tile-pending) .card-thumb::after {'
    const at = css.indexOf(sel)
    expect(at, 'отмены на время перехода нет — морф понесёт затемнение в героя').toBeGreaterThan(-1)
    const rule = css.slice(at + sel.length, css.indexOf('}', at))
    expect(rule).toMatch(/animation: none;/)
    expect(rule).toMatch(/background: none;/)
    // Ниже правила ожидания: при равном весе победил бы тот, кто ниже, — а
    // так отмена выигрывает и весом (:root и псевдокласс), и местом
    expect(at).toBeGreaterThan(css.indexOf('.game-card:has(.tile-pending) .card-thumb::after {'))
  })
})
