import fs from 'node:fs'
import path from 'node:path'

/**
 * Граф статических импортов — для сторожей веса первой загрузки.
 *
 * Жил внутри lib/smoothlazy.test.ts (gsap не едет в лэйаут). Понадобился
 * второму сторожу — поиск по каталогу обязан ехать чанком, а не в шапке
 * каждой страницы (lib/searchlazy.test.ts), — и вынесен сюда как есть, чтобы
 * копии не разъехались.
 *
 * Граф строится регуляркой по тексту, и это осознанное огрубление: `import
 * type` и динамический `import()` в бандл начальной загрузки не попадают и
 * пропускаются, всё остальное считается.
 *
 * Модуль только для тестов: продукт его не импортирует.
 */

export const ROOT = path.join(__dirname, '..', '..')

/** Код без комментариев: объяснение в докблоке не должно попадать под проверку. */
export function code(src: string): string {
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

/** Путь от корня репозитория с прямыми слешами */
export const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/')

/** Все файлы и пакеты, до которых модуль дотягивается статическими импортами. */
export function reach(entry: string): { files: Set<string>; packages: Map<string, string> } {
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
