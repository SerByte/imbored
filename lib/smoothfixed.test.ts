import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож фиксированных слоёв под плавной прокруткой.
 *
 * ScrollSmoother двигает содержимое страницы ТРАНСФОРМОМ, а трансформ создаёт
 * новый containing block. Следствие ровно одно и оно жёсткое: любой
 * `position: fixed` ВНУТРИ `#smooth-content` перестаёт быть привязанным к
 * экрану и цепляется к содержимому — то есть уезжает вместе с прокруткой.
 *
 * Ломается это молча и не там, где правили. Оверлей на странице игры,
 * плавающая плашка прогрева и тост ленты патчей живут на четырёх разных
 * маршрутах; человек, добавивший пятый такой слой, увидит поломку только если
 * догадается прокрутить страницу с открытым оверлеем. Поэтому правило
 * проверяется статически, по всей разметке сразу.
 *
 * ПРАВИЛО. Файл, у которого в классах есть `fixed`, обязан либо лежать в
 * списке OUTSIDE (его разметка рендерится снаружи обёртки), либо уводить свой
 * слой в `createPortal(node, document.body)`.
 *
 * Проверка смотрит на ФАЙЛ, а не на конкретный элемент, и это осознанное
 * огрубление: компонент, который уже умеет портал, почти наверняка вынес туда
 * все свои фиксированные слои, а точный разбор дерева JSX регуляркой — способ
 * получить ложные срабатывания вместо гарантии.
 */

const ROOT = path.join(__dirname, '..')

/**
 * Файлы, чья разметка рендерится СНАРУЖИ обёртки смузера. У каждого причина:
 * без неё через полгода не отличить исключение от пропуска.
 */
const OUTSIDE: Array<{ file: string; why: string }> = [
  {
    file: 'app/layout.tsx',
    why: 'шапка, нижняя панель и ссылка «к содержанию» — прямые дети <body>, обёртка начинается ниже',
  },
  {
    file: 'components/MobileNav.tsx',
    why: 'нижняя панель рендерится лэйаутом снаружи обёртки',
  },
  {
    file: 'components/ShareLink.tsx',
    why: 'поле-однодневка для копирования создаётся руками и добавляется прямо в document.body',
  },
]

/** Признак фиксированного слоя: утилита `fixed`, в том числе с вариантом. */
const FIXED = /\bclassName=(?:"[^"]*"|\{`[^`]*`\}|\{[^}]*\})/g
const HAS_FIXED = /(?:^|[\s:"'`])fixed(?:[\s"'`]|$)/

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

/** Код без комментариев: объяснение правки не должно попадать под проверку. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

type Hit = { file: string; portal: boolean }

function scan(): Hit[] {
  const hits: Hit[] = []
  for (const file of tsxFiles()) {
    const raw = fs.readFileSync(file, 'utf8')
    const src = code(raw)
    let fixed = false
    for (const m of src.matchAll(FIXED)) {
      if (HAS_FIXED.test(m[0])) {
        fixed = true
        break
      }
    }
    // Инлайновый стиль тоже считается: position:fixed в cssText — тот же слой.
    if (!fixed && /position:\s*fixed/.test(src)) fixed = true
    if (!fixed) continue
    hits.push({
      file: path.relative(ROOT, file).split(path.sep).join('/'),
      // Портал считается и напрямую, и через общую обёртку components/Portal.tsx:
      // потребителю важно, что слой уехал в body, а не каким именно вызовом.
      portal: /createPortal|<Portal[\s>]/.test(src),
    })
  }
  return hits
}

describe('фиксированные слои под плавной прокруткой', () => {
  const hits = scan()
  const outside = new Set(OUTSIDE.map((x) => x.file))

  test('каждый фиксированный слой либо снаружи обёртки, либо в портале', () => {
    const broken = hits
      .filter((h) => !outside.has(h.file) && !h.portal)
      .map((h) => h.file)
    expect(
      broken,
      'трансформ смузера утащит этот слой вместе с прокруткой — уведи его в createPortal(node, document.body)',
    ).toEqual([])
  })

  /**
   * Обратная сторона: исключение, которое перестало существовать, — это
   * молчаливый комментарий про несуществующий код.
   */
  test('в списке OUTSIDE нет протухших строк', () => {
    const stale = OUTSIDE.filter((x) => !hits.some((h) => h.file === x.file)).map((x) => x.file)
    expect(stale, 'у этих файлов больше нет фиксированных слоёв — вычеркни их из OUTSIDE').toEqual(
      [],
    )
  })

  /**
   * Само правило живёт в разметке лэйаута. Если обёртку однажды уберут, тест
   * выше останется зелёным и будет охранять несуществующее ограничение.
   */
  test('обёртка смузера на месте', () => {
    const layout = fs.readFileSync(path.join(ROOT, 'app', 'layout.tsx'), 'utf8')
    expect(layout, 'без #smooth-wrapper ScrollSmoother не заводится').toContain('id="smooth-wrapper"')
    expect(layout, 'без #smooth-content двигать нечего').toContain('id="smooth-content"')
  })

  /**
   * Уровень наложения стоит на ОБЁРТКЕ, а не на её содержимом.
   *
   * Это стоило дефекта, который трудно увидеть и легко вернуть. ScrollSmoother
   * делает обёртку `position: fixed`, а fixed создаёт КОНТЕКСТ НАЛОЖЕНИЯ со
   * своим уровнем auto. Любой z-index, поставленный внутри — например на
   * #smooth-content, — заперт в этом контексте и с соседями обёртки не
   * соревнуется. Лента же лежит прямым соседом обёртки в <body>, потому что
   * портал добавляет её в конец документа.
   *
   * Пока уровень стоял внутри, лента лежала ПОВЕРХ всей страницы. Заметить это
   * было трудно ровно потому, что её слои полупрозрачные: страница не
   * пропадала, а выцветала — жалоба звучала как «всё какое-то полупрозрачное».
   */
  test('обёртка поднята над лентой, а не её содержимое', () => {
    const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')

    const block = (selector: string): string => {
      const at = css.indexOf(`${selector} {`)
      if (at === -1) return ''
      return css.slice(at, css.indexOf('}', at))
    }
    const zOf = (selector: string): number | null => {
      const m = block(selector).match(/z-index:\s*(-?\d+)/)
      return m ? Number(m[1]) : null
    }

    const wrapper = zOf('#smooth-wrapper')
    const ribbon = zOf('.ribbon')

    expect(
      wrapper,
      'у #smooth-wrapper нет своего z-index — единственного места, где сравнение с лентой вообще происходит',
    ).not.toBeNull()
    expect(ribbon, 'у .ribbon нет z-index — уровень станет случайным').not.toBeNull()
    expect(
      wrapper as number,
      'лента снова окажется поверх содержимого, и страница выцветет вместо того, чтобы сломаться заметно',
    ).toBeGreaterThan(ribbon as number)

    expect(
      zOf('#smooth-content'),
      'z-index на #smooth-content бесполезен: он заперт внутри контекста наложения обёртки. Поднимать надо обёртку',
    ).toBeNull()
  })
})
