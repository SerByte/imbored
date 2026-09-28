import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож LazyMotion (components/motion/MotionLazy.tsx).
 *
 * Сайт рисует анимации компонентами m.*, а сами анимации и жесты догружает
 * чанком после гидрации. Три способа сломать это молча:
 *
 * 1. Импортировать motion.* — вес всех фич, включая layout и drag, снова
 *    едет в первую загрузку. То же делает любой импорт из пакета motion
 *    (motion/react): он сам обращается к motion.* (см. MotionLazy.tsx).
 *    ESLint (no-restricted-imports) ловит то же, но линт можно не запустить,
 *    а тесты идут в CI всегда.
 * 2. Отрисовать m.* без провайдера. Ошибки нет: элемент просто стоит на
 *    месте, без появления, без выхода, без нажатия.
 * 3. Поставить layout, layoutId или drag компоненту, который не обёрнут в
 *    MotionMax. Под одним domAnimation такой проп ничего не делает: строки
 *    перестают плавно съезжать, карту нельзя утащить пальцем.
 *
 * И обратное: провайдер в корневом лэйауте тянет 33 КБ motion-dom на каждую
 * страницу (почему — в MotionLazy.tsx), так что туда его не пускаем.
 *
 * Проверка текстовая: граф статических импортов — регуляркой, пропсы — по
 * строкам (в проекте каждый проп m.* стоит на своей строке).
 */

const ROOT = path.join(__dirname, '..')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...sources(p))
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const FILES = [...sources(path.join(ROOT, 'app')), ...sources(path.join(ROOT, 'components'))]
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/')
const code = (p: string) =>
  fs
    .readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*/gm, '')

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

/** Все локальные модули, до которых файл дотягивается статическими импортами */
function reach(entry: string): Set<string> {
  const files = new Set<string>()
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop() as string
    if (files.has(file)) continue
    files.add(file)
    for (const m of code(file).matchAll(STATIC_IMPORT)) {
      const local = resolveLocal(file, m[1])
      if (local) queue.push(local)
    }
  }
  return files
}

const usesM = (f: string) => /<m\.\w/.test(code(f))
const provides = (f: string) => /<Motion(Lazy|Max)>/.test(code(f))

/** Лэйауты над страницей, от её папки вверх до app/ (корневой — не в счёт) */
function layoutsAbove(page: string): string[] {
  const out: string[] = []
  for (let dir = path.dirname(page); dir !== path.join(ROOT, 'app'); dir = path.dirname(dir)) {
    const l = path.join(dir, 'layout.tsx')
    if (fs.existsSync(l)) out.push(l)
  }
  return out
}

/**
 * Где проп нужен, но обёртка стоит выше по дереву. Лайтбокс получает
 * layoutId только от сетки Screenshots, а она обёрнута сама; у слайдера
 * layoutId нет.
 */
const WRAPPED_BY_PARENT: Record<string, string> = {
  'components/Lightbox.tsx': 'components/Screenshots.tsx',
}

describe('LazyMotion', () => {
  test('motion.* не импортируется нигде — только m, и только из framer-motion', () => {
    const offenders = FILES.filter((f) => {
      const src = code(f)
      return (
        /import\s*\{[^}]*\bmotion\b[^}]*\}\s*from\s*'framer-motion'/.test(src) ||
        /from\s*'(framer-motion\/client|motion|motion\/[^']*)'/.test(src)
      )
    }).map(rel)
    expect(offenders).toEqual([])
    // Сторож не ослеп: импорты из framer-motion вообще находятся
    expect(FILES.filter((f) => /from\s*'framer-motion'/.test(code(f))).length).toBeGreaterThan(10)
  })

  test('layout, layoutId и drag — только под MotionMax', () => {
    const users = FILES.filter((f) => /^\s+(layout|layoutId|drag)(=|$)/m.test(code(f))).map(rel)
    expect(users.length, 'ни одного layout/drag не найдено — сторож ослеп').toBeGreaterThan(0)
    const bare = users.filter((f) => {
      const owner = WRAPPED_BY_PARENT[f] ?? f
      return !/<MotionMax>/.test(code(path.join(ROOT, owner)))
    })
    expect(bare, 'layout и drag без domMax молча не работают — оберни в <MotionMax>').toEqual([])
  })

  test('провайдер грузит фичи лениво и строго', () => {
    for (const [file, loader] of [
      ['MotionLazy.tsx', 'domAnimation'],
      ['MotionMax.tsx', 'domMax'],
    ]) {
      const src = code(path.join(ROOT, 'components', 'motion', file))
      expect(src, file).toMatch(/<LazyMotion features=\{load\w+\} strict>/)
      expect(src, file).toContain(`import('./${loader}')`)
    }
  })

  test('корневой лэйаут не тянет провайдер', () => {
    const root = [...reach(path.join(ROOT, 'app', 'layout.tsx'))].map(rel)
    expect(root.length, 'обход графа ничего не нашёл — сторож ослеп').toBeGreaterThan(5)
    expect(root.filter((f) => f.startsWith('components/motion/'))).toEqual([])
    // И сам корень ничего m.* не рисует: провайдера над ним нет
    expect(root.filter((f) => usesM(path.join(ROOT, f)))).toEqual([])
  })

  test('каждый m.* на каждой странице стоит под провайдером', () => {
    const pages = FILES.filter((f) => path.basename(f) === 'page.tsx')
    expect(pages.length).toBeGreaterThan(10)
    const bare: string[] = []
    let checked = 0
    for (const page of pages) {
      const covered = layoutsAbove(page).some(provides)
      const users = [...reach(page)].filter(usesM)
      checked += users.length
      if (covered) continue
      for (const f of users) if (!provides(f)) bare.push(`${rel(page)}: ${rel(f)}`)
    }
    expect(checked, 'ни одного m.* не найдено — сторож ослеп').toBeGreaterThan(5)
    expect(bare, 'm.* без MotionLazy рисуется мёртвым — поставь провайдер в лэйаут раздела или в компонент').toEqual([])
  })
})
