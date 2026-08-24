import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож трёх подписей.
 *
 * Подпись раздела — это указатель: человек переходит с /game на /play и на
 * /rooms и должен УЗНАВАТЬ одно и то же указание. Пока форма менялась от
 * файла к файлу, узнавать было нечего.
 *
 * Разъехалось это не сразу и не по злому умыслу: каждый экран писался
 * отдельно, и каждый раз подпись набиралась заново «примерно так же». К
 * моменту, когда её собрали в компоненты, у надзаголовка было СЕМЬ значений
 * трекинга (0.12, 0.14, 0.18, 0.2, 0.28, 0.3, 0.42) и два кегля, а тег <h2>
 * рисовался тремя несвязанными способами. Ровно поэтому здесь тест, а не
 * договорённость: договорённость это уже проигрывала.
 */

const ROOT = path.join(__dirname, '..')
const LABELS = path.join('components', 'Labels.tsx')

function appFiles(): [string, string][] {
  const out: [string, string][] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.tsx')) out.push([path.relative(ROOT, p), fs.readFileSync(p, 'utf8')])
    }
  }
  for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))
  return out
}

/** Исходник без комментариев: иначе сторож ловит объяснение, зачем его завели. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('подписи разделов', () => {
  /**
   * Верхний регистр с разрядкой — голос САМОГО сервиса. Проверка ниже искала
   * только произвольную разрядку `tracking-[Nem]` и пропускала шкальную
   * `tracking-wide`. Через эту щель заголовки чужих патчноутов говорили нашим
   * голосом: «ОРУЖИЕ» от Valve выглядело ровно как наши «ЗАПЕЧАТАННОЕ» и
   * «ЧИСТИЛИЩЕ».
   *
   * Исключение одно и осознанное: заливная плашка «ИГРА ДНЯ». Пилюля с
   * заливкой акцента — другое устройство (печать, а не подпись), и верхний
   * регистр там часть печати.
   */
  test('шкальная разрядка с верхним регистром — только у заливной плашки', () => {
    const offenders: string[] = []
    for (const [file, src] of appFiles()) {
      if (file === LABELS) continue
      for (const m of withoutComments(src).matchAll(/className="([^"]*)"/g)) {
        const cls = m[1]
        if (!cls.includes('uppercase')) continue
        if (!/tracking-(?:wide|wider|widest)/.test(cls)) continue
        if (cls.includes('bg-ember')) continue
        offenders.push(`${file}: ${cls.slice(0, 70)}`)
      }
    }
    expect(offenders, 'верхний регистр с разрядкой — голос сервиса, используй Eyebrow').toEqual([])
  })

  test('надзаголовок нигде не набран руками — только компонентом', () => {
    const offenders: string[] = []
    for (const [file, src] of appFiles()) {
      if (file === LABELS) continue
      for (const m of src.matchAll(/uppercase[^"'`]*tracking-\[[\d.]+em\]/g)) {
        offenders.push(`${file}: ${m[0]}`)
      }
      // и обратный порядок классов тоже
      for (const m of src.matchAll(/tracking-\[[\d.]+em\][^"'`]*uppercase/g)) {
        offenders.push(`${file}: ${m[0]}`)
      }
    }
    expect(offenders, 'вместо этого Eyebrow или MetaLine из components/Labels').toEqual([])
  })

  test('тихая подпись раздела нигде не набрана руками', () => {
    const offenders: string[] = []
    for (const [file, src] of appFiles()) {
      if (file === LABELS) continue
      for (const m of src.matchAll(/text-sm font-(?:medium|semibold) text-(?:dim|faint|ember-text)/g)) {
        offenders.push(`${file}: ${m[0]}`)
      }
    }
    expect(offenders, 'вместо этого SectionLabel из components/Labels').toEqual([])
  })

  /**
   * Различие трекинга между надзаголовком и строкой фактов содержательное, а
   * не декоративное: у надзаголовка одно слово, которому разрядка идёт на
   * пользу, а в строке фактов несколько значений через разделитель, и на
   * 0.3em они перестают читаться как отдельные. Если однажды числа сравняются,
   * пропадёт и различие между двумя ролями — тест это заметит.
   */
  test('у надзаголовка и строки фактов разный трекинг, и оба заданы один раз', () => {
    /*
     * Числа переехали из этого компонента в токены app/globals.css, и сторож
     * поехал за ними. Причина переезда — в докблоке lib/tracking.test.ts:
     * форма подписей была закреплена только в TSX, а кино-главная писала свои
     * надзаголовки прямо в CSS, мимо компонента, и разнобой завёлся заново.
     *
     * Смысл проверки не изменился ни на слово: ролей две, значения обязаны
     * различаться, и надзаголовок обязан быть заметно шире строки фактов.
     * Изменилось только то, ГДЕ лежит единственный источник этих чисел.
     */
    const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')
    const value = (token: string): number => {
      const m = css.match(new RegExp(`${token}:\\s*([\\d.]+)em;`))
      expect(m, `токен ${token} не найден в globals.css`).toBeTruthy()
      return Number(m![1])
    }
    const eyebrow = value('--track-eyebrow')
    const meta = value('--track-meta')
    expect(new Set([eyebrow, meta]).size, 'разрядки обязаны различаться').toBe(2)
    expect(eyebrow, 'надзаголовок обязан быть заметно шире строки фактов').toBeGreaterThan(
      meta * 1.5,
    )

    const src = fs.readFileSync(path.join(ROOT, LABELS), 'utf8')
    expect(
      [...src.matchAll(/tracking-\[[\d.]+em\]/g)],
      'литеральный трекинг вернулся в компонент — источник снова стал вторым',
    ).toHaveLength(0)
  })

  test('тон называется по токену палитры, а не по настроению', () => {
    const src = fs.readFileSync(path.join(ROOT, LABELS), 'utf8')
    for (const token of ['text-ember-text', 'text-dim', 'text-faint']) {
      expect(src).toContain(token)
    }
  })
})
