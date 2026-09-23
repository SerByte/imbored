import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож бесплатных игр на ценниках.
 *
 * У Counter-Strike 2 в каталоге одновременно is_free = 1 и price_final = 1499:
 * это цена Prime, а не игры, и хранится она осознанно (см. lib/catalog.test.ts).
 * Правильно её рисует только PriceTag, которому передали isFree, — он
 * проверяет бесплатность первой строкой. Страница игры, /play и /daily это
 * делали, а полка «на будущее» на /compat — нет, и показывала $14.99 за
 * бесплатную игру. Ошибка не видна ни на одном тестовом числе: у платной игры
 * всё верно и без признака.
 *
 * Поэтому правило простое и статическое: у каждого PriceTag есть isFree.
 * Где бесплатных не бывает в принципе, так и пишется — isFree={false}, чтобы
 * это было решение, а не пропуск.
 */

const ROOT = path.join(__dirname, '..')

function sourceFiles(): [string, string][] {
  const out: [string, string][] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx$/.test(e.name)) {
        out.push([path.relative(ROOT, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')])
      }
    }
  }
  for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))
  return out
}

describe('ценник и бесплатные игры', () => {
  test('каждый PriceTag знает, бесплатна ли игра', () => {
    const offenders: string[] = []
    let seen = 0
    for (const [file, src] of sourceFiles()) {
      for (const m of src.matchAll(/<PriceTag\b/g)) {
        seen++
        const end = src.indexOf('/>', m.index)
        const tag = src.slice(m.index, end)
        if (!/\bisFree=/.test(tag)) {
          offenders.push(`${file}:${src.slice(0, m.index).split('\n').length}`)
        }
      }
    }
    // Сторож, который ничего не нашёл, — сломанный сторож: PriceTag живёт
    // минимум на пяти экранах.
    expect(seen).toBeGreaterThan(4)
    expect(offenders, 'передай isFree в PriceTag').toEqual([])
  })
})
