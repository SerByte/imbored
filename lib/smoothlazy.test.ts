import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож веса: gsap едет только туда, где без него нельзя.
 *
 * Плавная прокрутка раньше стояла в app/layout.tsx, то есть на каждой
 * странице сайта. Пока components/SmoothScroll.tsx импортировал gsap
 * напрямую, ядро с ScrollTrigger и ScrollSmoother — около 57 КБ br — лежало в
 * начальном наборе скриптов даже у /privacy и /support. Потом смузер стал
 * отдельным чанком (SmoothScrollImpl), а теперь и вовсе живёт только на
 * главной: закреплённые сцены есть только там. Заголовки (SplitHeading) и
 * слайдер кадров (MorphSlider) обходятся без gsap — WAAPI и свой rAF.
 *
 * Ломается это одной строкой и незаметно: достаточно, чтобы любой модуль,
 * до которого страница дотягивается статическим импортом, сам импортировал
 * gsap — шапка, подвал, заголовок, что угодно. Сборка пройдёт, страницы
 * отрисуются, вес вернётся. Поэтому проверяется весь граф статических
 * импортов от лэйаута и от каждой страницы, а не один файл.
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
  const landing = reach(path.join(ROOT, 'app', 'page.tsx'))

  test('обход графа доходит до входа плавной прокрутки — от главной', () => {
    // Без этого сторож ниже мог бы быть зелёным потому, что обход сломан
    expect([...landing.files].map(rel)).toContain('components/SmoothScroll.tsx')
  })

  /**
   * Смузер нужен только главной: закреплённые сцены есть только там. Из
   * лэйаута он догружал 129 КБ на каждой странице и вёл прокрутку программно
   * на таче, где закреплять было нечего.
   */
  test('плавная прокрутка не стоит в корневом лэйауте', () => {
    expect([...layout.files].map(rel)).not.toContain('components/SmoothScroll.tsx')
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

  test('сам смузер статически недостижим ни из лэйаута, ни из главной', () => {
    expect([...layout.files].map(rel)).not.toContain('components/SmoothScrollImpl.tsx')
    expect([...landing.files].map(rel)).not.toContain('components/SmoothScrollImpl.tsx')
  })

  /**
   * Главная — единственная страница со сценами на ScrollTrigger. Остальным
   * gsap не нужен: церемония матча в комнате догружается через next/dynamic.
   */
  test('ни одна страница, кроме главной, не тянет gsap статически', () => {
    const pages: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name === 'page.tsx' && p !== path.join(ROOT, 'app', 'page.tsx')) pages.push(p)
      }
    }
    walk(path.join(ROOT, 'app'))
    expect(pages.length, 'обход страниц ничего не нашёл — сторож ослеп').toBeGreaterThan(10)
    const offenders = pages.flatMap((page) =>
      [...reach(page).packages]
        .filter(([spec]) => isGsap(spec))
        .map(([spec, file]) => `${rel(page)}: ${file} → ${spec}`),
    )
    expect(offenders, 'gsap въехал в первую загрузку страницы — догружай его через import() или next/dynamic').toEqual(
      [],
    )
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
