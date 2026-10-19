import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { code, reach, rel, ROOT } from './testing/importgraph'

/**
 * Сторож веса: gsap едет только туда, где без него нельзя.
 *
 * Плавная прокрутка раньше стояла в app/layout.tsx, то есть на каждой
 * странице сайта. Пока components/SmoothScroll.tsx импортировал gsap
 * напрямую, ядро с ScrollTrigger и ScrollSmoother — около 57 КБ br — лежало в
 * начальном наборе скриптов даже у /privacy и /support. Потом смузер стал
 * отдельным чанком (SmoothScrollImpl), а теперь и вовсе живёт только на
 * главной: закреплённые сцены есть только там. Заголовки (SplitHeading) и
 * слайдер кадров (MorphSlider) обходятся без gsap — WAAPI и свой rAF.
 *
 * Ломается это одной строкой и незаметно: достаточно, чтобы любой модуль,
 * до которого страница дотягивается статическим импортом, сам импортировал
 * gsap — шапка, подвал, заголовок, что угодно. Сборка пройдёт, страницы
 * отрисуются, вес вернётся. Поэтому проверяется весь граф статических
 * импортов от лэйаута и от каждой страницы, а не один файл.
 *
 * Граф строится регуляркой по тексту (lib/testing/importgraph), и это
 * осознанное огрубление: `import type` и динамический `import()` в бандл
 * начальной загрузки не попадают и пропускаются, всё остальное считается.
 * Что обход вообще находит gsap, проверяет отдельный тест — иначе сторож мог
 * бы быть зелёным вхолостую.
 */

const isGsap = (spec: string) => spec === 'gsap' || spec.startsWith('gsap/') || spec.startsWith('@gsap/')

describe('gsap не в начальном наборе каждой страницы', () => {
  const layout = reach(path.join(ROOT, 'app', '[lang]', 'layout.tsx'))
  const landing = reach(path.join(ROOT, 'app', '[lang]', 'page.tsx'))

  test('обход графа доходит до входа плавной прокрутки — от главной', () => {
    // Без этого сторож ниже мог бы быть зелёным потому, что обход сломан
    expect([...landing.files].map(rel)).toContain('components/SmoothScroll.tsx')
  })

  /**
   * Смузер нужен только главной: закреплённые сцены есть только там. Из
   * лэйаута он догружал 129 КБ на каждой странице и вёл прокрутку программно
   * на таче, где закреплять было нечего.
   */
  test('плавная прокрутка не стоит в корневом лэйауте', () => {
    expect([...layout.files].map(rel)).not.toContain('components/SmoothScroll.tsx')
  })

  test('ни один статически достижимый из лэйаута модуль не импортирует gsap', () => {
    const offenders = [...layout.packages]
      .filter(([spec]) => isGsap(spec))
      .map(([spec, file]) => `${file} → ${spec}`)
    expect(
      offenders,
      'gsap снова въехал в корневой лэйаут, то есть в скрипты КАЖДОЙ страницы. Догружай его отдельным куском, как components/SmoothScroll.tsx (lazyIsland)',
    ).toEqual([])
  })

  test('сам смузер статически недостижим ни из лэйаута, ни из главной', () => {
    expect([...layout.files].map(rel)).not.toContain('components/SmoothScrollImpl.tsx')
    expect([...landing.files].map(rel)).not.toContain('components/SmoothScrollImpl.tsx')
  })

  /**
   * Главная — единственная страница со сценами на ScrollTrigger. Остальным
   * gsap не нужен: церемония матча в комнате догружается через next/dynamic.
   */
  test('ни одна страница, кроме главной, не тянет gsap статически', () => {
    const pages: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name === 'page.tsx' && p !== path.join(ROOT, 'app', '[lang]', 'page.tsx')) pages.push(p)
      }
    }
    walk(path.join(ROOT, 'app'))
    expect(pages.length, 'обход страниц ничего не нашёл — сторож ослеп').toBeGreaterThan(10)
    const offenders = pages.flatMap((page) =>
      [...reach(page).packages]
        .filter(([spec]) => isGsap(spec))
        .map(([spec, file]) => `${rel(page)}: ${file} → ${spec}`),
    )
    expect(offenders, 'gsap въехал в первую загрузку страницы — догружай его через import() или next/dynamic').toEqual(
      [],
    )
  })

  test('обход умеет находить gsap: смузер его импортирует', () => {
    const impl = reach(path.join(ROOT, 'components', 'SmoothScrollImpl.tsx'))
    expect([...impl.packages.keys()].filter(isGsap)).toEqual(
      expect.arrayContaining(['gsap', 'gsap/ScrollSmoother', 'gsap/ScrollTrigger']),
    )
  })

  /**
   * Отказ куска смузера не уводит главную в app/error.tsx.
   *
   * Смузер задуман необязательным: без него главная прокручивается нативно.
   * Но next/dynamic — это React.lazy без своей границы, и не пришедший кусок
   * (моргнула сеть на телефоне, деплой сменил хеши под старой вкладкой)
   * бросал в границу сегмента: вся главная, с единственной карточкой входа,
   * сменялась экраном «Что-то сломалось», где не помогали ни «Попробовать
   * снова», ни «На главную» — lazy помнит отказ. lazyIsland ловит отказ сам,
   * шлёт отчёт с тегом и рисует пустое место (lib/lazyisland.test.ts).
   */
  test('смузер грузится островком: отказ куска — нативная прокрутка, а не экран ошибки', () => {
    const shim = code(fs.readFileSync(path.join(ROOT, 'components', 'SmoothScroll.tsx'), 'utf8'))
    expect(shim, 'next/dynamic уводит отказ куска в app/error.tsx').not.toMatch(/from\s+['"]next\/dynamic['"]/)
    expect(shim).toMatch(/lazyIsland\(\s*\(\)\s*=>\s*import\('\.\/SmoothScrollImpl'\)/)
  })

  /**
   * Вторая половина сделки: при «уменьшить движение» чанк не запрашивается
   * вовсе. Проверка настройки обязана стоять в лёгком входе, до загрузки, — в
   * самом смузере она спрашивается уже после того, как код скачан.
   */
  test('лёгкий вход спрашивает «уменьшить движение» до загрузки смузера', () => {
    const shim = code(fs.readFileSync(path.join(ROOT, 'components', 'SmoothScroll.tsx'), 'utf8'))
    const asks = shim.indexOf('prefers-reduced-motion')
    const loads = shim.indexOf('setWanted(true)')
    expect(asks, 'вход не спрашивает «уменьшить движение»').toBeGreaterThan(-1)
    expect(loads, 'вход больше не решает, грузить ли смузер').toBeGreaterThan(-1)
    expect(asks, 'проверка настройки обязана стоять раньше решения грузить').toBeLessThan(loads)
  })
})
