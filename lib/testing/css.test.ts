import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { readAppCss, relPath, ROOT, stripComments } from './css'

describe('листы стилей для сторожей', () => {
  test('комментарии гаснут, а строки и смещения остаются на местах', () => {
    const css = '.a {\n  /* outline: none\n     вторая строка */ color: red;\n}\n'
    const out = stripComments(css)
    expect(out).not.toContain('outline')
    expect(out).toHaveLength(css.length)
    expect(out.split('\n')).toHaveLength(css.split('\n').length)
    expect(out.indexOf('color')).toBe(css.indexOf('color'))
  })

  test('обход видит и глобальный лист, и CSS-модули', () => {
    const sheets = readAppCss()
    const rels = sheets.map((s) => s.rel)
    expect(rels).toContain('app/globals.css')
    expect(rels, 'модуль слайдера — тот самый лист, мимо которого смотрел сторож размытия').toContain(
      'components/morph/MorphSlider.module.css',
    )
    expect(sheets.find((s) => s.rel === 'app/globals.css')?.module).toBe(false)
    expect(sheets.find((s) => s.rel.endsWith('MorphSlider.module.css'))?.module).toBe(true)
    for (const s of sheets) expect(s.css).toHaveLength(s.raw.length)
  })

  /**
   * Растяжка на разбиение globals.css.
   *
   * Больше десятка сторожей читают `app/globals.css` напрямую. Пока глобальный
   * лист один, а модули — редкость, это терпимо, и их переводят на readAppCss()
   * по мере касания. Но стоит порезать globals.css на части — и каждый такой
   * сторож молча перестанет видеть всё, что уехало в новые файлы: зелёный тест,
   * пустая проверка. Здесь это превращается в падение со списком, кого
   * переводить до разбиения.
   */
  test('глобальный лист один — или ни один сторож не читает globals.css напрямую', () => {
    const globals = readAppCss()
      .filter((s) => !s.module)
      .map((s) => s.rel)
    if (globals.length === 1 && globals[0] === 'app/globals.css') return

    const direct: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.name.endsWith('.test.ts')) {
          const src = fs.readFileSync(full, 'utf8')
          if (/readFileSync\([^)]*['"]globals\.css['"]/.test(src)) direct.push(relPath(full))
        }
      }
    }
    walk(path.join(ROOT, 'lib'))
    expect(
      direct,
      `глобальных листов теперь несколько (${globals.join(', ')}), а эти сторожа читают только ` +
        'app/globals.css — переведи их на readAppCss() из lib/testing/css.ts',
    ).toEqual([])
  })
})
