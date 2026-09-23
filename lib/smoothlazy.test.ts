import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож веса корневого лэйаута: gsap в него статически не въезжает.
 *
 * Плавная прокрутка стоит в app/layout.tsx, то есть на каждой странице сайта.
 * Пока components/SmoothScroll.tsx импортировал gsap напрямую, ядро с
 * ScrollTrigger и ScrollSmoother — около 57 КБ br — лежало в начальном наборе
 * скриптов даже у /privacy и /support и качалось даже при «уменьшить
 * движение». Теперь смузер грузится отдельным чанком (SmoothScrollImpl) и
 * только когда движение разрешено.
 *
 * Ломается это одной строкой и незаметно: достаточно, чтобы любой модуль,
 * до которого лэйаут дотягивается статическим импортом, сам импортировал gsap —
 * шапка, подвал, нижняя панель, что угодно. Сборка пройдёт, страницы
 * отрисуются, вес вернётся на все маршруты сразу. Поэтому проверяется весь
 * граф статических импортов от лэйаута, а не один файл.
 *
 * Граф строится регуляркой по тексту, и это осознанное огрубление: `import
 * type` и динамический `import()` в бандл начальной загрузки не попадают и
 * пропускаются, всё остальное считается. Что обход вообще находит gsap,
 * проверяет отдельный тест — иначе сторож мог бы быть зелёным вхолостую.
 */

const ROOT = path.join(__dirname, '..')

/** Код без комментариев: объяснение в докблоке не должно попадать под проверку. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '')
}

/**
 * Статические импорты и реэкспорты модуля, кроме `import type`/`export type`.
 * `[^'"]*?` намеренно тянется через переводы строк — многострочные импорты с
 * фигурными скобками так и выглядят.
 */
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\bfrom\s*)?['"]([^'"]+)['"]/gm

function resolveLocal(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec)
  else return null
  for (const ext of ['', '.tsx', '.ts', '/index.tsx', '/index.ts']) {
    const p = base + ext
    if (/\.tsx?$/.test(p) && fs.existsSync(p) && fs.statSync(p).isFile()) return p
  }
  return null
}

/** Все пакеты, до которых модуль дотягивается статическими импортами. */
function reach(entry: string): { files: Set<string>; packages: Map<string, string> } {
  const files = new Set<string>()
  // пакет → первый файл, который его импортирует: чтобы сообщение называло виновника
  const packages = new Map<string, string>()
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop() as string
    if (files.has(file)) continue
    files.add(file)
    const src = code(fs.readFileSync(file, 'utf8'))
    for (const m of src.matchAll(STATIC_IMPORT)) {
      const spec = m[1]
      if (spec.startsWith('@/') || spec.startsWith('.')) {
        const local = resolveLocal(file, spec)
        if (local) queue.push(local)
        continue
      }
      if (!packages.has(spec)) packages.set(spec, rel(file))
    }
  }
  return { files, packages }
}

const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/')
const isGsap = (spec: string) => spec === 'gsap' || spec.startsWith('gsap/') || spec.startsWith('@gsap/')

describe('gsap не в начальном наборе каждой страницы', () => {
  const layout = reach(path.join(ROOT, 'app', 'layout.tsx'))

  test('обход графа от лэйаута доходит до входа плавной прокрутки', () => {
    // Без этого сторож ниже мог бы быть зелёным потому, что обход сломан
    expect([...layout.files].map(rel)).toContain('components/SmoothScroll.tsx')
  })

  test('ни один статически достижимый из лэйаута модуль не импортирует gsap', () => {
    const offenders = [...layout.packages]
      .filter(([spec]) => isGsap(spec))
      .map(([spec, file]) => `${file} → ${spec}`)
    expect(
      offenders,
      'gsap снова въехал в корневой лэйаут, то есть в скрипты КАЖДОЙ страницы. Догружай его через import() или next/dynamic, как components/SmoothScroll.tsx',
    ).toEqual([])
  })

  test('сам смузер статически из лэйаута недостижим', () => {
    expect([...layout.files].map(rel)).not.toContain('components/SmoothScrollImpl.tsx')
  })

  test('обход умеет находить gsap: смузер его импортирует', () => {
    const impl = reach(path.join(ROOT, 'components', 'SmoothScrollImpl.tsx'))
    expect([...impl.packages.keys()].filter(isGsap)).toEqual(
      expect.arrayContaining(['gsap', 'gsap/ScrollSmoother', 'gsap/ScrollTrigger']),
    )
  })

  /**
   * Вторая половина сделки: при «уменьшить движение» чанк не запрашивается
   * вовсе. Проверка настройки обязана стоять в лёгком входе, до загрузки, — в
   * самом смузере она спрашивается уже после того, как код скачан.
   */
  test('лёгкий вход спрашивает «уменьшить движение» до загрузки смузера', () => {
    const shim = code(fs.readFileSync(path.join(ROOT, 'components', 'SmoothScroll.tsx'), 'utf8'))
    const asks = shim.indexOf('prefers-reduced-motion')
    const loads = shim.indexOf('setWanted(true)')
    expect(asks, 'вход не спрашивает «уменьшить движение»').toBeGreaterThan(-1)
    expect(loads, 'вход больше не решает, грузить ли смузер').toBeGreaterThan(-1)
    expect(asks, 'проверка настройки обязана стоять раньше решения грузить').toBeLessThan(loads)
  })
})
