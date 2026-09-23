import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож LCP страницы игры.
 *
 * Пять тысяч карточек /game — весь органический вход сайта, и LCP у них —
 * картинка героя. Замер на /game/730 при 1024×768: последней записью
 * largest-contentful-paint была размытая подложка, а не обложка. Подложка
 * стояла на variant="hero" (library_hero, 248 КБ, а на ретине library_hero_2x
 * — 784 КБ) и грузилась лениво — то есть самый медленный кадр страницы был
 * кадром, от которого после blur(64px) и 30 % прозрачности не видно ни одной
 * детали.
 *
 * Правка держится на трёх строках разметки, и ни одна не ломает поведение,
 * если её тихо откатить: страница рисуется так же, просто медленнее. Поэтому
 * здесь текст, а не браузер.
 */

const ROOT = path.join(__dirname, '..')
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

/** Без блочных комментариев: в них правило объяснено теми же словами. */
const withoutComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '')

/** Конец открывающего тега — с учётом {} и строк внутри атрибутов. */
function tagEnd(src: string, i: number): number {
  let depth = 0
  let q: string | null = null
  for (let j = i; j < src.length; j++) {
    const c = src[j]
    if (q) {
      if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') q = c
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return j
  }
  return -1
}

function gameArts(src: string): string[] {
  return [...src.matchAll(/<GameArt\b/g)].map((m) => src.slice(m.index, tagEnd(src, m.index) + 1))
}

const sizesOf = (tag: string) => tag.match(/\bsizes="([^"]*)"/)?.[1]

describe('герой страницы игры', () => {
  const page = withoutComments(read('app', 'game', '[appid]', 'page.tsx'))
  const heroAt = page.indexOf('<section')
  const hero = page.slice(heroAt, page.indexOf('</section>', heroAt))
  const arts = gameArts(hero)
  const backdrop = arts.find((t) => t.includes('blur-3xl'))
  const cover = arts.find((t) => !t.includes('blur-3xl'))

  test('в герое две картинки — подложка и обложка', () => {
    expect(arts).toHaveLength(2)
    expect(backdrop, 'подложка героя не найдена').toBeDefined()
    expect(cover, 'обложка героя не найдена').toBeDefined()
  })

  test('подложка не тянет library_hero: размытию разрешение не нужно', () => {
    expect(backdrop).not.toMatch(/variant=/)
  })

  test('подложка берёт тот же файл, что обложка, — второй загрузки нет', () => {
    expect(sizesOf(backdrop!)).toBeDefined()
    expect(sizesOf(backdrop!)).toBe(sizesOf(cover!))
  })

  test('обе картинки героя грузятся сразу и с высоким приоритетом', () => {
    for (const [name, tag] of [
      ['подложка', backdrop!],
      ['обложка', cover!],
    ] as const) {
      expect(tag, `${name}: eager`).toMatch(/\beager\b/)
      expect(tag, `${name}: fetchPriority="high"`).toMatch(/fetchPriority="high"/)
    }
  })

  test('высокий приоритет — только у героя, иначе он ничего не значит', () => {
    expect(page.match(/fetchPriority="high"/g)).toHaveLength(2)
  })

  test('GameArt доносит приоритет до <img>', () => {
    expect(read('components', 'GameArt.tsx')).toMatch(/fetchPriority=\{fetchPriority\}/)
  })
})
