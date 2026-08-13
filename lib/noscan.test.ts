import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Страховка от возврата полного скана каталога.
 *
 * Turso тарифицирует прочитанные строки, и один `SELECT * FROM games` без
 * WHERE/LIMIT на каталоге в сотню тысяч игр стоит дороже, чем весь остальной
 * запрос вместе взятый. Линтер такое не ловит, а класс ошибки повторяющийся:
 * достаточно одному рефакторингу «упростить» выборку — и бесплатный тариф
 * сгорает молча, без единого падения.
 */

const ROOT = path.join(__dirname, '..')
const SCAN_DIRS = ['app', 'lib', 'components']

function sourceFiles(dir: string): string[] {
  const full = path.join(ROOT, dir)
  if (!fs.existsSync(full)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(p))
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) out.push(p)
  }
  return out
}

const FILES = SCAN_DIRS.flatMap(sourceFiles)

describe('запрет полного скана каталога', () => {
  test('в исходниках есть что проверять', () => {
    expect(FILES.length).toBeGreaterThan(20)
  })

  test('никто не читает весь каталог целиком', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
      // `SELECT ... FROM games` без WHERE и без LIMIT в том же выражении
      const re = /SELECT[\s\S]{0,400}?FROM\s+games\b([\s\S]{0,200}?)(?=`|'|")/gi
      for (const m of text.matchAll(re)) {
        const tail = m[1] ?? ''
        if (!/\bWHERE\b/i.test(tail) && !/\bLIMIT\b/i.test(tail)) {
          offenders.push(`${file}: ${m[0].replace(/\s+/g, ' ').slice(0, 90)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('getAllGamesMeta не вернулась в код', () => {
    const offenders = FILES.filter((f) =>
      fs.readFileSync(path.join(ROOT, f), 'utf8').includes('getAllGamesMeta('),
    )
    expect(offenders).toEqual([])
  })
})
