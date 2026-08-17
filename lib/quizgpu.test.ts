import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Бюджет композиции квиза — третий брат lib/motion.test.ts и lib/contrast.test.ts.
 *
 * Все три читают app/globals.css как ДАННЫЕ. Здесь это нужно потому, что
 * ограничения производительности квиза до сих пор жили только в прозе
 * докблоков: «ни одного backdrop-filter», «слои — порядок разметки, не
 * z-index», «размытие не меняется на наведении». Проза не краснеет.
 *
 * Каждое утверждение ниже — ранее принятое решение, у которого была цена.
 */

const RAW = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8')

/**
 * Комментарии срезаются ДО разбора, и это принципиально: без этого докблок
 * перед правилом приезжает в захват селектора, и любое упоминание свойства в
 * прозе становится нарушением. Сосед lib/motion.test.ts намеренно читает сырой
 * текст — там это цена простоты регулярки по одному токену; здесь разбираются
 * целые правила, и мусор в селекторе ломает всё.
 */
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, ' ')

type Rule = { selector: string; body: string }

/**
 * Внутренние блоки объявлений. Регулярка ловит только те, у которых внутри нет
 * фигурных скобок, поэтому обёртки @media/@supports сами по себе не попадают, а
 * их содержимое попадает — ровно то, что нужно.
 */
function rules(): Rule[] {
  const out: Rule[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(CSS))) {
    out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] })
  }
  return out
}

const ALL = rules()

/** Правила, относящиеся к квизу, по любому из трёх его пространств имён. */
function quizRules(): Rule[] {
  return ALL.filter(
    (r) =>
      r.selector.includes('.quiz-') ||
      r.selector.includes('[data-quiz') ||
      r.selector.includes('[data-answer'),
  )
}

describe('бюджет композиции квиза', () => {
  test('ни одного backdrop-filter в правилах квиза — никогда, ни на каком уровне', () => {
    // Решение из докблока материала панели: пять слоёв .blur-band на каждой из
    // трёх панелей — это 15 живых фильтров на экран. Отвергнуто по стоимости
    // один раз; тест закрывает вопрос навсегда.
    const guilty = quizRules().filter((r) => /backdrop-filter\s*:/.test(r.body))
    expect(guilty.map((r) => r.selector)).toEqual([])
  })

  test('обходной путь Chromium для маскированного рельса на месте', () => {
    // mask-image на предке + backdrop-filter на потомке = потомок не
    // рендерится вовсе. Режим отказа — НЕВИДИМЫЙ КОНТЕНТ, а не ошибка в
    // консоли, и маска активна только ниже 768px: регрессия выглядит идеально
    // на десктопе разработчика и сломана на каждом телефоне.
    const fix = ALL.find(
      (r) => r.selector === '.chip-rail .glass' && /backdrop-filter\s*:\s*none/.test(r.body),
    )
    expect(fix, 'правило .chip-rail .glass { backdrop-filter: none } удалено').toBeTruthy()
  })

  test('две копии обложки делят один transform, и никто больше его не трогает', () => {
    // Разъехавшиеся трансформы дают двоение по краю панели: .quiz-melt
    // размыта сильнее и её кайма вылезает из-под .quiz-art.
    const shared = ALL.filter(
      (r) =>
        /\.quiz-art\b/.test(r.selector) &&
        /\.quiz-melt\b/.test(r.selector) &&
        /transform\s*:\s*scale\(1\.15\)/.test(r.body),
    )
    expect(shared).toHaveLength(1)

    const others = ALL.filter(
      (r) =>
        (/\.quiz-art\b/.test(r.selector) || /\.quiz-melt\b/.test(r.selector)) &&
        /(^|[;\s])transform\s*:/.test(r.body) &&
        !/transform\s*:\s*scale\(1\.15\)/.test(r.body),
    )
    expect(others.map((r) => r.selector)).toEqual([])
  })

  test('в квизе нет z-index: слои — это порядок разметки', () => {
    // Правило проекта, задокументированное в четырёх местах. Однажды z-index: 1
    // на .blur-band размыл заголовок, который этот слой существовал защищать.
    const guilty = quizRules().filter((r) => /(^|[;\s])z-index\s*:/.test(r.body))
    expect(guilty.map((r) => r.selector)).toEqual([])
  })

  test('will-change живёт только в правилах [data-warm]', () => {
    // Разложенный по компонентам will-change остаётся навсегда и превращается
    // в утечку текстур. Ставит и снимает его lib/gpu.ts.
    const guilty = ALL.filter(
      (r) => /will-change\s*:/.test(r.body) && !r.selector.startsWith('[data-warm'),
    )
    expect(guilty.map((r) => r.selector)).toEqual([])
  })

  test('несепарабельных режимов наложения нет во всём файле', () => {
    // color / hue / saturation / luminosity требуют поканального RGB→HSL против
    // подложки и не имеют быстрого пути в Skia вовсе. soft-light, screen,
    // overlay — сепарабельные, с GPU-путём, и разрешены.
    expect(CSS).not.toMatch(/mix-blend-mode\s*:\s*(color|hue|saturation|luminosity)\b/)
  })

  test('SVG-фильтров нет', () => {
    // filter: url(#…) растрируется на CPU. Анимированный примитив пересчитывает
    // всю цепочку покадрово, а flood-color как презентационный атрибут SVG не
    // резолвит var() вообще — эффект молча заливается чёрным.
    expect(CSS).not.toMatch(/filter\s*:\s*url\(/)
  })
})
