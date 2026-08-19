import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож размытия подложки.
 *
 * Стекло — базовый строительный блок интерфейса: `.glass` носят панели, шапка,
 * карточка подключения, карточки квиза и колоды. Докблок описывает его как
 * материал с размытой подложкой. Так вот, размытия НЕ БЫЛО. Ни в одном
 * Chromium-браузере, то есть у большинства аудитории, всё время.
 *
 * Механика, и она не очевидна ни на глаз, ни при чтении исходника.
 *
 * В стилях у каждого объявления был рукописный вендорный префикс:
 *
 *     backdrop-filter: blur(20px);
 *     -webkit-backdrop-filter: blur(20px);
 *
 * Минификатор (Lightning CSS в составе Tailwind v4) сам расставляет префиксы по
 * browserslist. Увидев рядом стандартное свойство и рукописный префикс, он счёл
 * их дубликатом и оставил ОДИН — префиксный. В прод уезжало:
 *
 *     .glass{background:var(--glass-bg);-webkit-backdrop-filter:blur(20px);…}
 *
 * А Chrome префиксной формы не поддерживает вовсе:
 * `CSS.supports('-webkit-backdrop-filter', 'blur(1px)')` отдаёт **false**.
 * Значит объявление не применялось, и `getComputedStyle(...).backdropFilter`
 * честно возвращал `none` — что и было замерено на живом проде.
 *
 * Стоит убрать рукописный префикс — и минификатор выдаёт ОБЕ формы:
 * префиксную для Safari и стандартную для всех остальных. Проверено сборкой.
 *
 * Заметить это глазом почти невозможно: стекло и без размытия выглядит
 * пристойно — заливка, рамка, тень на месте. Поэтому сторож, а не комментарий.
 */

const ROOT = path.join(__dirname, '..')
const RAW = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')

/**
 * Без комментариев — иначе сторож ловит объяснение, зачем его завели: докблок
 * над объявлениями цитирует и само свойство, и префиксную форму. Тот же приём
 * уже применён в lib/labels.test.ts и lib/landingdoor.test.ts.
 *
 * Комментарии заменяются пробелами той же длины, чтобы номера строк в жалобе
 * остались настоящими.
 */
const stripComments = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
const CSS = stripComments(RAW)

/**
 * Не только globals.css: тот же минификатор проходит и по CSS-модулям. У
 * MorphSlider.module.css префикс стоял после стандартного свойства, и в
 * собранном листе у подписи и кнопок слайдера оставался один
 * `-webkit-backdrop-filter` — тот же дефект, найденный сравнением исходника с
 * собранным CSS уже после того, как globals.css был вычищен.
 */
function cssFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return cssFiles(full)
    return e.name.endsWith('.css') ? [full] : []
  })
}
const SHEETS = [...cssFiles(path.join(ROOT, 'app')), ...cssFiles(path.join(ROOT, 'components'))]

describe('размытие подложки', () => {
  test('вендорный префикс не пишется руками — его ставит минификатор', () => {
    expect(SHEETS.length, 'листы стилей не найдены').toBeGreaterThan(1)
    const offenders: string[] = []
    for (const file of SHEETS) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      stripComments(fs.readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          if (line.includes('-webkit-backdrop-filter')) offenders.push(`${rel}:${i + 1}`)
        })
    }
    expect(
      offenders,
      'рукописный -webkit-префикс заставляет минификатор выбросить стандартное свойство, и размытие умирает в Chrome',
    ).toEqual([])
  })

  /**
   * Обратная половина сделки: если однажды все объявления просто удалят, тест
   * выше останется зелёным, а материал исчезнет. Здесь проверяется, что
   * стекло вообще заявляет размытие.
   */
  test('стекло по-прежнему заявляет размытие', () => {
    const at = CSS.indexOf('.glass {')
    expect(at, 'класс .glass не найден').toBeGreaterThan(-1)
    const block = CSS.slice(at, CSS.indexOf('}', at))
    expect(block, '.glass без backdrop-filter — это уже не стекло').toMatch(
      /backdrop-filter:\s*blur\(/,
    )
  })
})
