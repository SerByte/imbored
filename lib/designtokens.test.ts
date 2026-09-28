import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Радиусы — три ступени на весь продукт (--radius-panel 22, --radius-card 12,
 * --radius-control 11 в app/globals.css). После «Премьеры» в разметке ещё
 * жили литералы 20px и 14px — трейлер и слайдер кадров стояли на одной
 * странице с разными скруглениями. Крупный радиус литералом — это и есть
 * такое расхождение, поэтому от 13 px и выше — только токены.
 *
 * Мелкие литералы (4–10 px у каркасов и бейджей) не трогаем: это не рамки
 * компонентов. Лендинг живёт своей режиссурой и в сторож не входит.
 */
const ROOT = path.join(__dirname, '..')

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) {
      if (p.includes(`${path.sep}landing`)) continue
      walk(p, out)
    } else if (name.endsWith('.tsx')) out.push(p)
  }
}

describe('радиусы из токенов', () => {
  const files: string[] = []
  for (const dir of ['app', 'components']) walk(path.join(ROOT, dir), files)

  test('сторож видит разметку', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  test('крупный радиус литералом не набран нигде', () => {
    const offenders: string[] = []
    for (const f of files) {
      // без комментариев: в них литерал — история правки, а не разметка
      const code = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      for (const m of code.matchAll(/rounded(?:-[a-z]+)?-\[(1[3-9]|[2-9]\d)px\]/g)) {
        offenders.push(`${path.relative(ROOT, f)}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
