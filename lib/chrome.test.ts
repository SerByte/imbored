import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож обвязки: перекрасил текст — отвечай и за фон под ним.
 *
 * Шапка и подвал живут ВНЕ <main>, поэтому зона страницы (.media-dark,
 * .whatsnew) до них не достаёт: её токены объявлены на внутреннем div, а
 * обвязка красится от :root. Чтобы обвязка не спорила с зоной, в globals.css
 * есть правила вида `:root:has(.зона) body > header` — они переносят токены
 * зоны на обвязку вручную.
 *
 * И ровно здесь прячется ошибка, которую не видит ни один сторож палитры:
 * правило меняет --ink, но НЕ ФОН. Оба токена по отдельности верны, пара
 * «--ink на --bg» проходит проверку, а на экране почти белый текст лежит на
 * молочном фоне <body>, потому что подложка берётся не из этого блока.
 *
 * Так и было: подвал на /whatsnew в светлой теме давал 1.02:1 у знака и
 * 2.81 у ссылок — то есть его физически не было видно. В тёмной теме
 * незаметно, а тёмная здесь по умолчанию.
 *
 * Правило: если блок обвязки объявляет --ink, у этого селектора обязана быть
 * подложка. Либо своя заливка (`background`), либо собственный слой —
 * у шапки это растворяющийся градиент .site-chrome-fade на --header-fade,
 * и заливку ей задавать как раз НЕЛЬЗЯ: полоса поверх героя убила бы весь
 * смысл градиента.
 */

const ROOT = path.join(__dirname, '..')

const CSS = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')

/** Убираем комментарии: в них те же селекторы разбираются словами. */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

type Rule = { selector: string; body: string }

/** Все правила верхнего уровня: селектор и его тело. */
function rules(): Rule[] {
  const out: Rule[] = []
  for (const m of CODE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].replace(/\s+/g, ' ').trim(), body: m[2] })
  }
  return out
}

/** Селекторы, целящие в обвязку — то есть в `body > header` / `body > footer`. */
function chromeTargets(selector: string): string[] {
  return selector
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /body\s*>\s*(header|footer)\b/.test(s))
}

describe('обвязка над зонами', () => {
  const all = rules()

  /**
   * Шапка красится градиентом .site-chrome-fade, у которого свой токен.
   * Всё остальное обязано иметь заливку.
   */
  const HAS_OWN_LAYER = /body\s*>\s*header\b/

  test('перекрашенная обвязка получает и подложку, а не только --ink', () => {
    const offenders: string[] = []
    for (const rule of all) {
      const targets = chromeTargets(rule.selector)
      if (!targets.length) continue
      if (!/--ink\s*:/.test(rule.body)) continue
      for (const target of targets) {
        if (HAS_OWN_LAYER.test(target)) continue
        // фон либо в этом же блоке, либо в отдельном правиле на тот же селектор
        const painted = all.some(
          (r) =>
            r.selector.split(',').some((s) => s.trim() === target) &&
            /(^|;|\s)background(-color)?\s*:/.test(r.body),
        )
        if (!painted) offenders.push(target)
      }
    }
    expect(
      offenders,
      'текст перекрашен, а фон под ним — от <body>: в светлой теме это белое по молочному',
    ).toEqual([])
  })

  /**
   * Обратная сторона: подложка обязана браться из токенов того же блока, а не
   * быть вписанной цветом. Иначе она разъедется с --ink при следующей правке
   * палитры — ровно так же, как разъезжались зоны до разводки ролей.
   */
  test('подложка обвязки задана токеном, а не литеральным цветом', () => {
    const offenders: string[] = []
    for (const rule of all) {
      const targets = chromeTargets(rule.selector)
      if (!targets.length) continue
      const bg = rule.body.match(/(?:^|;|\s)background(?:-color)?\s*:\s*([^;]+)/)
      if (!bg) continue
      if (!/var\(--/.test(bg[1])) offenders.push(`${rule.selector} → ${bg[1].trim()}`)
    }
    expect(offenders, 'заливка обвязки должна ссылаться на токен зоны').toEqual([])
  })

  /**
   * И сам разбор: если селекторы обвязки в файле кончатся, тест начнёт
   * молча проходить на пустом множестве. Проверка на то, что он вообще
   * что-то видит.
   */
  test('правила обвязки в файле находятся', () => {
    const found = all.filter((r) => chromeTargets(r.selector).length > 0)
    expect(found.length, 'разбор globals.css сломался — селекторы обвязки не найдены').toBeGreaterThanOrEqual(2)
  })

  /**
   * Метка .media-full говорит одно: «эта кино-зона — вся страница, подвалу
   * под ней светлым быть нельзя». Она осмысленна только вместе с .media-dark,
   * потому что подвал под ней красится тёмными токенами зоны. Метка без зоны —
   * тёмный подвал под светлой страницей, то есть та же ошибка наизнанку.
   */
  test('.media-full не ходит без .media-dark', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.tsx')) {
          const src = fs.readFileSync(p, 'utf8')
          for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
            const cls = m[1] ?? m[2] ?? ''
            if (!/\bmedia-full\b/.test(cls)) continue
            if (/\bmedia-dark\b/.test(cls)) continue
            const line = src.slice(0, m.index).split('\n').length
            offenders.push(`${path.relative(ROOT, p).split(path.sep).join('/')}:${line}`)
          }
        }
      }
    }
    for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))
    expect(offenders, 'подвал станет тёмным под светлой страницей').toEqual([])
  })

  /** Метка, на которую никто не реагирует, — мусор в разметке. */
  test('на .media-full есть правило подвала', () => {
    expect(CODE).toMatch(/:root:has\(\.media-full\)\s+body\s*>\s*footer/)
  })

})
