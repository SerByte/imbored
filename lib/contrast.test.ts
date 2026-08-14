import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож контраста.
 *
 * Числа палитры живут в app/globals.css, а не здесь: тест их ЧИТАЕТ и
 * пересчитывает. Смысл именно в этом — правка токена без пересчёта контраста
 * должна ронять прогон, а не проходить незамеченной до следующего аудита.
 *
 * Так уже было: --ember в роли текста давал 2.85:1 при пороге 4.5, и то же
 * значение стояло текстом на главной кнопке продукта. Никакой инструмент этого
 * не ловил, потому что формально всё было «в токенах».
 */

const CSS = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8')

/** Значения токенов внутри конкретного селектора. */
function block(selector: string): Record<string, string> {
  const i = CSS.indexOf(selector)
  if (i < 0) throw new Error(`не найден блок ${selector}`)
  const body = CSS.slice(i, CSS.indexOf('\n}', i))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) out[m[1]] = m[2].trim()
  return out
}

/** Разворачивает var(--x) по цепочке внутри того же блока. */
function resolve(tokens: Record<string, string>, name: string, depth = 0): string {
  const raw = tokens[name]
  if (raw === undefined) throw new Error(`нет токена ${name}`)
  const m = raw.match(/^var\((--[\w-]+)\)$/)
  if (m && depth < 5) return resolve(tokens, m[1], depth + 1)
  return raw
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').trim()
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`не hex-цвет: ${hex}`)
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance(c: [number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(rgb(a)), luminance(rgb(b))]
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** WCAG 2.2 AA для обычного текста. */
const AA = 4.5

const THEMES = [
  { name: 'тёмная', selector: ':root {' },
  { name: 'светлая', selector: ':root[data-theme="light"]' },
  { name: 'кино-зона', selector: '.media-dark {' },
  { name: '«Что нового»', selector: '.whatsnew {' },
]

describe('контраст палитры', () => {
  for (const theme of THEMES) {
    describe(theme.name, () => {
      const t = block(theme.selector)

      test('вторичный текст читается', () => {
        expect(contrast(resolve(t, '--dim'), resolve(t, '--bg'))).toBeGreaterThanOrEqual(AA)
      })

      test('приглушённый текст читается — он заменил text-dim/60, а тот давал 2.5', () => {
        expect(contrast(resolve(t, '--faint'), resolve(t, '--bg'))).toBeGreaterThanOrEqual(AA)
      })

      test('акцент в роли текста читается', () => {
        expect(contrast(resolve(t, '--ember-text'), resolve(t, '--bg'))).toBeGreaterThanOrEqual(AA)
      })

      /** Главная кнопка продукта. Ровно здесь и было 2.85:1. */
      test('текст на заливке акцента читается', () => {
        expect(contrast(resolve(t, '--on-ember'), resolve(t, '--ember'))).toBeGreaterThanOrEqual(AA)
      })

      test('статусные цвета читаются', () => {
        for (const name of ['--ok', '--info', '--danger']) {
          expect(
            contrast(resolve(t, name), resolve(t, '--bg')),
            `${name} в теме «${theme.name}»`,
          ).toBeGreaterThanOrEqual(AA)
        }
      })

      test('основной текст держит запас втрое выше порога', () => {
        expect(contrast(resolve(t, '--ink'), resolve(t, '--bg'))).toBeGreaterThanOrEqual(7)
      })
    })
  }

  test('зоны переопределяют ВСЕ ролевые токены, а не только базовые', () => {
    // Иначе у человека на светлой теме внутри тёмной зоны роли остаются
    // светлыми: тёмный текст на тёмном фоне. Так уже случилось с шапкой.
    const roles = ['--ember-text', '--on-ember', '--faint', '--surface', '--track', '--ok', '--info', '--danger']
    for (const selector of ['.media-dark {', '.whatsnew {']) {
      const t = block(selector)
      for (const role of roles) {
        expect(Object.keys(t), `${role} в ${selector}`).toContain(role)
      }
    }
  })

  test('светлая тема определяет все роли, что и тёмная', () => {
    const dark = Object.keys(block(':root {')).filter((k) => !k.startsWith('--dur') && !k.startsWith('--ease') && !k.startsWith('--blur'))
    const light = Object.keys(block(':root[data-theme="light"]'))
    for (const token of dark) {
      expect(light, `${token} не переопределён в светлой теме`).toContain(token)
    }
  })
})
