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

/**
 * Обложка /whatsnew и её размытая заливка — один файл, а не два.
 *
 * Заливка (components/whatsnew/Stage) начинается с арта обложки и рисовала
 * его одним src, то есть library_hero, а обложка по srcSet на ретине брала
 * library_hero_2x. Замер на проде, 1440×900 при DPR 2: 1 265 702 + 396 673
 * байт за одну картинку, причём вторая — под blur-3xl, прозрачностью 0.34 и
 * скримом bg/55. С тем же srcSet и тем же sizes браузер выбирает того же
 * кандидата и берёт его из кэша. Откат снова ничего не ломает на экране —
 * отсюда сторож по тексту, как и выше.
 */
describe('обложка /whatsnew', () => {
  const page = withoutComments(read('app', 'whatsnew', 'page.tsx'))
  const stage = withoutComments(read('components', 'whatsnew', 'Stage.tsx'))
  const cover = gameArts(withoutComments(read('components', 'whatsnew', 'Cover.tsx')))

  test('заливка получает арт и srcSet обложки из одного источника', () => {
    expect(page).toMatch(/initialWash=\{artCandidates\(heroArt, 'hero'\)\[0\]\}/)
    expect(page).toMatch(/initialWashSrcSet=\{artSrcSet\(heroArt, 'hero'\)\}/)
  })

  test('заливка с артом обложки выбирает по тем же sizes, что герой GameArt', () => {
    expect(stage).toMatch(/srcSet=\{coverWash \? initialWashSrcSet : undefined\}/)
    expect(stage).toMatch(/sizes=\{coverWash \? HERO_SIZES : undefined\}/)
    expect(read('components', 'GameArt.tsx')).toMatch(/variant === 'hero' \? HERO_SIZES/)
  })

  test('обложка — герой со своим sizes по умолчанию и высоким приоритетом', () => {
    expect(cover).toHaveLength(1)
    expect(cover[0]).toMatch(/variant="hero"/)
    // свой sizes у обложки развёл бы её с заливкой
    expect(sizesOf(cover[0]!)).toBeUndefined()
    expect(cover[0]).toMatch(/fetchPriority="high"/)
  })
})
