import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { COZY_TAGS, LEANS, NEUTRAL_MOOD, parseLean, parseMood, VIBE_TAGS } from './mood'

describe('parseLean', () => {
  test('каждое известное значение проходит как есть', () => {
    for (const lean of LEANS) expect(parseLean(lean)).toBe(lean)
  })

  /**
   * Неверный lean молча игнорируется, а не даёт 400: у /api/recommend каждый
   * код ошибки обязан иметь экран на /play (lib/failscreens.test.ts), и
   * опечатка в адресе не стоит отдельного экрана — подбор идёт без оси.
   */
  test('мусор, другой регистр, массив и пустота дают null', () => {
    expect(parseLean('Familiar')).toBeNull()
    expect(parseLean('nostalgia')).toBeNull()
    expect(parseLean(['fresh'])).toBeNull()
    expect(parseLean(1)).toBeNull()
    expect(parseLean('')).toBeNull()
    expect(parseLean(undefined)).toBeNull()
    expect(parseLean(null)).toBeNull()
  })
})

describe('parseMood', () => {
  test('ось состояния в настроение не просачивается', () => {
    expect(parseMood({ ...NEUTRAL_MOOD, lean: 'familiar' })).toEqual(NEUTRAL_MOOD)
  })
})

describe('COZY_TAGS', () => {
  test('это спокойная ось движка без Atmospheric — и только без неё', () => {
    expect(COZY_TAGS.length).toBeGreaterThan(0)
    for (const t of COZY_TAGS) expect(VIBE_TAGS.chill, t).toContain(t)
    expect(VIBE_TAGS.chill.filter((t) => !COZY_TAGS.includes(t))).toEqual(['Atmospheric'])
    for (const t of COZY_TAGS) expect(VIBE_TAGS.engaged, t).not.toContain(t)
  })

  /**
   * Сторож копий: «уютное» жило своим списком в app/play/page.tsx и уже
   * отличалось от оси движка. Три тега спокойной оси подряд где-то, кроме
   * lib/mood, — это она же, выписанная заново.
   */
  test('теги спокойной оси выписаны только в lib/mood.ts', () => {
    const ROOT = path.join(__dirname, '..')
    const HOME = 'lib/mood.ts'
    const files: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`
        if (e.isDirectory()) walk(p)
        else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p)
      }
    }
    for (const dir of ['app', 'lib', 'components']) walk(dir)
    const chill = VIBE_TAGS.chill
    const runs = chill
      .slice(2)
      .map((c, i) => new RegExp(`'${chill[i]}'\\s*,\\s*'${chill[i + 1]}'\\s*,\\s*'${c}'`))
    const src = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
    expect(runs.some((re) => re.test(src(HOME)))).toBe(true)
    const copies = files.filter((f) => f !== HOME && runs.some((re) => re.test(src(f))))
    expect(copies, 'теги «уютного» выписаны заново — бери COZY_TAGS из lib/mood').toEqual([])
  })
})
