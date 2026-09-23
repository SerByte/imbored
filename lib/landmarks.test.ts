import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож ориентиров и боковых полей под вырез.
 *
 * ОРИЕНТИРЫ. В дереве стояли три <nav> без имени сразу: шапка, нижняя панель
 * и подвал. Скринридер, открыв список ориентиров на телефоне, видел три
 * «навигации» — и первой из них была кнопка темы: пункты шапки там уезжают в
 * нижнюю панель, а тема оставалась внутри <nav> одна. Теперь у каждого <nav>
 * есть имя, тема стоит рядом с меню, а не в нём, и два «Раздела» (шапка и
 * панель) никогда не видны вместе: одно меню на двух ширинах.
 *
 * ВЫРЕЗ. viewportFit: 'cover' пускает страницу под вырез iPhone. Низ учтён
 * давно, бока — не были: в ландшафте заголовок игры на /play начинался с
 * x = 20 под сенсорным блоком (снимок 844×390). Поле .px-safe — max(1.25rem,
 * env(safe-area-inset-*)), и сторож держит его там, где текст стоит у края:
 * шапка, подвал, контейнеры /play и /daily, плавающие плашки.
 *
 * Проверка статическая, по разметке: ориентиры и поля видны в исходнике
 * целиком, а воспроизводить в браузере iPhone в ландшафте тестам нечем.
 */

const ROOT = path.join(__dirname, '..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** Код без комментариев: докблоки цитируют то, что здесь ищется. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '')

function tsxFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.tsx')) out.push(p)
    }
  }
  for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))
  return out
}

/** Открывающие теги <nav …> с файлом: только разметка, без комментариев. */
function navTags(): Array<{ file: string; tag: string }> {
  const out: Array<{ file: string; tag: string }> = []
  for (const file of tsxFiles()) {
    const src = code(fs.readFileSync(file, 'utf8'))
    for (const m of src.matchAll(/<nav\b/g)) {
      const at = m.index ?? 0
      out.push({
        file: path.relative(ROOT, file).split(path.sep).join('/'),
        tag: src.slice(at, src.indexOf('>', at) + 1),
      })
    }
  }
  return out
}

const nameOf = (tag: string) => tag.match(/aria-label="([^"]+)"/)?.[1] ?? null

describe('навигационные ориентиры', () => {
  const navs = navTags()

  test('обход вообще находит навигации', () => {
    // иначе сторож ниже зеленел бы вхолостую
    expect(navs.length).toBeGreaterThanOrEqual(3)
  })

  test('у каждого <nav> есть имя', () => {
    const unnamed = navs.filter((n) => !/aria-label(?:ledby)?=/.test(n.tag)).map((n) => n.file)
    expect(unnamed, 'безымянная «навигация» в списке ориентиров — это перебор вслепую').toEqual([])
  })

  /**
   * Одно имя — одно меню. Повтор разрешён ровно одному: «Разделы» в шапке и в
   * нижней панели. Это одно меню на двух ширинах, и на экране всегда ровно
   * одно из двух — проверено классами ниже.
   */
  test('имена не повторяются, кроме одного меню на двух ширинах', () => {
    const byName = new Map<string, string[]>()
    for (const n of navs) {
      const name = nameOf(n.tag)
      if (!name) continue
      byName.set(name, [...(byName.get(name) ?? []), n.file])
    }
    const repeated = [...byName].filter(([, files]) => files.length > 1)
    expect(repeated).toEqual([['Разделы', ['app/layout.tsx', 'components/MobileNav.tsx']]])
  })

  test('два «Раздела» не видны одновременно', () => {
    const header = navs.find((n) => n.file === 'app/layout.tsx' && nameOf(n.tag) === 'Разделы')
    const panel = navs.find((n) => n.file === 'components/MobileNav.tsx')
    expect(header?.tag, 'меню в шапке прячется на телефоне целиком, а не только пункты внутри').toMatch(
      /className="hidden md:flex\b/,
    )
    expect(panel?.tag, 'нижняя панель прячется на десктопе').toMatch(/className="md:hidden\b/)
  })

  test('кнопка темы — не часть меню разделов', () => {
    const layout = code(read('app/layout.tsx'))
    const at = layout.indexOf('<nav aria-label="Разделы"')
    expect(at).toBeGreaterThan(-1)
    const body = layout.slice(at, layout.indexOf('</nav>', at))
    expect(body, 'внутри <nav> тема делает из шапки на телефоне «навигацию» из одной кнопки').not.toContain(
      '<ThemeToggle',
    )
    expect(layout).toContain('<ThemeToggle />')
  })
})

describe('боковые поля под вырез', () => {
  const css = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

  test('поле объявлено и берёт вырез с обеих сторон', () => {
    const at = css.indexOf('@utility px-safe {')
    expect(at, 'утилита px-safe не найдена в globals.css').toBeGreaterThan(-1)
    const block = css.slice(at, css.indexOf('}', at))
    expect(block).toMatch(/padding-left:\s*max\(1\.25rem,\s*env\(safe-area-inset-left\)\)/)
    expect(block).toMatch(/padding-right:\s*max\(1\.25rem,\s*env\(safe-area-inset-right\)\)/)
  })

  /** Без cover вырез и так не заходит на страницу — и правило было бы лишним. */
  test('страница по-прежнему заходит под вырез', () => {
    expect(read('app/layout.tsx')).toMatch(/viewportFit:\s*'cover'/)
  })

  /**
   * Где текст стоит у самого края экрана. Список — не «все контейнеры сайта»,
   * а места, замеренные или стоящие на каждой странице; остальные страницы
   * переходят на px-safe по мере касания.
   */
  const USES: Array<{ file: string; marker: string }> = [
    { file: 'app/layout.tsx', marker: 'relative mx-auto max-w-6xl px-safe py-4' },
    { file: 'components/Footer.tsx', marker: 'mx-auto max-w-6xl px-safe py-6' },
    { file: 'components/StopAsk.tsx', marker: 'flex justify-center px-safe' },
    { file: 'components/WarmStrip.tsx', marker: 'flex justify-center px-safe' },
    { file: 'app/play/page.tsx', marker: 'max-w-6xl px-safe pb-12 pt-40' },
    { file: 'app/daily/page.tsx', marker: 'max-w-6xl px-safe pb-16 pt-40' },
  ]

  test.each(USES)('$file стоит на px-safe', ({ file, marker }) => {
    expect(read(file)).toContain(marker)
  })

  test('на /play и /daily ни один контейнер страницы не остался на px-5', () => {
    for (const file of ['app/play/page.tsx', 'app/daily/page.tsx']) {
      expect(read(file), `${file}: контейнер max-w-6xl на px-5 уводит текст под вырез`).not.toMatch(
        /max-w-6xl px-5\b/,
      )
    }
  })

  /**
   * Широкий вариант поля перебил бы px-safe: варианты Tailwind стоят в листе
   * позже базовых утилит, а iPhone в ландшафте шире md — то есть ровно там,
   * где вырез есть, поле снова стало бы фиксированным.
   */
  test('px-safe не перебивается широким вариантом поля', () => {
    const offenders: string[] = []
    for (const file of tsxFiles()) {
      const src = code(fs.readFileSync(file, 'utf8'))
      for (const m of src.matchAll(/className=(?:"[^"]*"|\{`[^`]*`\})/g)) {
        if (/\bpx-safe\b/.test(m[0]) && /\b(?:sm|md|lg|xl):(?:px|pl|pr)-/.test(m[0])) {
          offenders.push(`${path.relative(ROOT, file)}: ${m[0]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
