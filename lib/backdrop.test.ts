import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { readAppCss } from './testing/css'

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

/**
 * Все листы, а не только globals.css: тот же минификатор проходит и по
 * CSS-модулям. У MorphSlider.module.css префикс стоял после стандартного
 * свойства, и в собранном листе у подписи и кнопок слайдера оставался один
 * `-webkit-backdrop-filter` — тот же дефект, найденный сравнением исходника с
 * собранным CSS уже после того, как globals.css был вычищен.
 *
 * Комментарии погашены (см. lib/testing/css.ts): докблок над объявлениями
 * цитирует и само свойство, и префиксную форму, и без этого сторож ловил бы
 * собственное объяснение.
 */
const SHEETS = readAppCss()
const GLOBALS = SHEETS.find((s) => s.rel === 'app/globals.css')?.css ?? ''

describe('размытие подложки', () => {
  test('вендорный префикс не пишется руками — его ставит минификатор', () => {
    expect(SHEETS.length, 'листы стилей не найдены').toBeGreaterThan(1)
    const offenders: string[] = []
    for (const { rel, css } of SHEETS) {
      css.split('\n').forEach((line, i) => {
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
    const at = GLOBALS.indexOf('.glass {')
    expect(at, 'класс .glass не найден').toBeGreaterThan(-1)
    const block = GLOBALS.slice(at, GLOBALS.indexOf('}', at))
    expect(block, '.glass без backdrop-filter — это уже не стекло').toMatch(
      /backdrop-filter:\s*blur\(/,
    )
  })
})

/**
 * Стекло шапки не сидит внутри элемента с постоянным именем перехода.
 *
 * В Chromium элемент с view-transition-name — Backdrop Root: backdrop-filter
 * его потомков видит только то, что нарисовано внутри него, а не страницу
 * позади. <header> носил имя site-header постоянно, инлайном, и размытие
 * .site-chrome-bar и .site-chrome-fade умерло: под шапкой резко читались
 * строки страницы, оставался один тон. Замер полосами под шапкой на /support
 * (1280×800, data-chrome="page"): с именем полосы видны сквозь стекло, с
 * header.style.viewTransitionName = 'none' — размыты.
 *
 * Имя нужно только на время перехода — чтобы шапка не ехала вместе со
 * страницей. Поэтому оно стоит под :active-view-transition: есть с вызова
 * startViewTransition (снимок старого состояния его уже видит), нет в покое.
 */
describe('стекло шапки видит страницу', () => {
  const ROOT = path.join(__dirname, '..')
  const layout = fs
    .readFileSync(path.join(ROOT, 'app', 'layout.tsx'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

  test('у <header> нет постоянного имени перехода', () => {
    const header = layout.match(/<header\b[^>]*>/)?.[0]
    expect(header, '<header> в app/layout.tsx не найден').toBeTruthy()
    expect(header, 'постоянное имя делает шапку Backdrop Root, и стекло перестаёт размывать страницу').not.toMatch(
      /viewTransitionName/,
    )
  })

  test('имя site-header ставится только на время перехода', () => {
    const decls = [...GLOBALS.matchAll(/([^{}]+)\{[^{}]*view-transition-name:\s*site-header\b/g)].map((m) =>
      m[1].trim(),
    )
    expect(decls.length, 'без имени шапка уедет вместе со страницей при переходе').toBeGreaterThan(0)
    for (const sel of decls) {
      expect(sel, 'имя вне перехода снова убьёт размытие стекла').toMatch(/:active-view-transition\b/)
    }
  })
})
