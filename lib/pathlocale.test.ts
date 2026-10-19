import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { splitLocale } from './i18n'
import { pathLocale } from './pathlocale'

/**
 * pathLocale — копия одной ветки splitLocale ради аварийного экрана
 * (app/global-error.tsx), и копия обязана отвечать так же, как оригинал.
 */
describe('pathLocale', () => {
  test('язык адреса тот же, что у splitLocale', () => {
    for (const p of ['', '/', '/en', '/en/', '/en/play', '/enx', '/english', '/ru/play', '/ru', '/play', '/en/room/ABC234']) {
      expect(pathLocale(p), JSON.stringify(p)).toBe(splitLocale(p).locale)
    }
  })

  test('модуль не импортирует значений — только тип', () => {
    const src = fs.readFileSync(path.join(__dirname, 'pathlocale.ts'), 'utf8')
    const imports = [...src.matchAll(/^\s*import\s+(?!type\b)/gm)]
    expect(imports, 'импорт значения вернёт lib/i18n во вторую копию на каждом маршруте').toEqual([])
  })
})
