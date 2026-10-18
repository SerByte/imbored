import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { code, reach, rel, ROOT } from './testing/importgraph'

/**
 * Сторож веса «Найти игру»: в первую загрузку едет кнопка, и только она.
 *
 * Кнопка поиска стоит в шапке (app/layout.tsx), то есть на КАЖДОЙ странице,
 * а /play и /room/[id] стоят у самого потолка bundle-budget.json — запаса у
 * них один-три килобайта. Окно поиска (components/CatalogSearch: поле,
 * список, клавиатура, свёртка, раскладка) их бы через потолок перевело. Поэтому
 * оно едет чанком по import(), а индекс каталога — ещё позже, когда окно
 * открыли (components/SearchLauncher, lib/catalogindex).
 *
 * Ломается это одной строкой: статический импорт окна или его модулей в
 * кнопку — и сборка пройдёт, поиск будет работать, а вес молча въедет в
 * каждую страницу. Граф — тот же, что у сторожа gsap (lib/testing/importgraph).
 */

const LAUNCHER = path.join(ROOT, 'components', 'SearchLauncher.tsx')

/** Модули окна: им место в чанке, а не в первой загрузке */
const WINDOW = ['components/CatalogSearch.tsx', 'lib/catalogsearch.ts', 'lib/catalogindex.ts', 'lib/foldtitle.ts']

describe('поиск по каталогу — чанком, а не в каждой странице', () => {
  test('обход доходит до кнопки от корневого лэйаута', () => {
    // Без этого сторожа ниже могли бы быть зелёными потому, что обход сломан
    expect([...reach(path.join(ROOT, 'app', '[lang]', 'layout.tsx')).files].map(rel)).toContain(
      'components/SearchLauncher.tsx',
    )
  })

  /*
   * Из лэйаута и кнопки, но не из app/not-found.tsx, хотя и она — первая
   * загрузка каждой страницы (граница not-found): она серверная и тянет
   * lib/forgotten ради ключа дня, а граф регуляркой серверное от клиентского
   * не отличает. Клиентское у неё — эта же кнопка, и она проверена.
   */
  test('окно и его модули статически недостижимы ни из кнопки, ни из лэйаута', () => {
    for (const entry of [LAUNCHER, path.join(ROOT, 'app', '[lang]', 'layout.tsx')]) {
      const files = [...reach(entry).files].map(rel)
      expect(
        files.filter((f) => WINDOW.includes(f)),
        `${rel(entry)}: окно поиска въехало в первую загрузку — догружай его через import(), как components/SearchLauncher.tsx`,
      ).toEqual([])
    }
  })

  /*
   * Кнопка — это кнопка: React и значок, которые и так есть в шапке
   * (переключатель темы). Любой новый статический импорт сюда — вес на
   * каждой странице; если он правда нужен, его место — в окне.
   *
   * Исключение одно и бесплатное: отчёт об отказе чанка (lib/clienterr и его
   * маски lib/errlog). Оба и так в первой загрузке каждой страницы — их везёт
   * instrumentation-client, — а без отчёта 404 куска после деплоя жил бы
   * невидимым (докблок SearchLauncher). Модуль островка (components/lazyIsland)
   * сюда не идёт: в первой загрузке он есть, только пока его везут оболочки
   * лэйаута (закулисье и записка), и вес кнопки от них зависеть не должен.
   */
  test('кнопка тянет только React, значок и отчёт об отказе', () => {
    const { files, packages } = reach(LAUNCHER)
    expect([...files].map(rel).sort()).toEqual([
      'components/Icon.tsx',
      'components/SearchLauncher.tsx',
      'lib/clienterr.ts',
      'lib/errlog.ts',
    ])
    expect([...packages.keys()]).toEqual(['react'])
    // «бесплатное» — только пока их правда везёт instrumentation-client
    const boot = [...reach(path.join(ROOT, 'instrumentation-client.ts')).files].map(rel)
    expect(boot).toEqual(expect.arrayContaining(['lib/clienterr.ts', 'lib/errlog.ts']))
  })


  test('окно кнопка всё-таки грузит — динамическим import()', () => {
    const src = code(fs.readFileSync(LAUNCHER, 'utf8'))
    expect(src).toMatch(/import\(\s*'\.\/CatalogSearch'\s*\)/)
  })

  /*
   * Окно едет в браузер — и всё, до чего оно дотянется, тоже. lib/forgotten
   * (там свёртка жила раньше) тянет движок подбора, lib/db и lib/server —
   * сервер целиком.
   */
  test('окно не тянет в браузер серверные модули и движок подбора', () => {
    const files = [...reach(path.join(ROOT, 'components', 'CatalogSearch.tsx')).files].map(rel)
    for (const server of ['lib/db.ts', 'lib/server.ts', 'lib/recommend.ts', 'lib/forgotten.ts']) {
      expect(files, server).not.toContain(server)
    }
    // а сам обход видит модули окна — иначе проверка выше пуста
    expect(files).toEqual(expect.arrayContaining(['lib/catalogsearch.ts', 'lib/foldtitle.ts']))
  })
})
