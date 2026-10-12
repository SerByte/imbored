import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { lazyIsland } from '@/components/lazyIsland'
import { reach, rel, ROOT } from './testing/importgraph'

/**
 * Сторож лёгких расщеплений первой загрузки.
 *
 * Двенадцать возможностей второй волны перевели шесть маршрутов через
 * потолок bundle-budget.json, и большая часть веса была не новыми кнопками, а
 * модулями, приехавшими ради одного имени: тексты лендинга — в записку
 * лэйаута, весь разбор выдачи /play — в квиз и в кнопку «Выйти», пул игр
 * других магазинов — в обложку, правило комнаты — в метки магазинов, рантайм
 * next/dynamic — ради одной кнопки. Каждое расщепление ломается одной строкой
 * импорта, а сборка проходит зелёной; поэтому — граф статических импортов
 * (lib/testing/importgraph), как у сторожей gsap и поиска.
 */

const files = (entry: string) => [...reach(path.join(ROOT, entry)).files].map(rel)

describe('модули не едут в первую загрузку ради одного имени', () => {
  /*
   * Адрес входа (lib/destination, steamLoginFor) читает записка «Режим
   * просмотра». Раньше — прямо из корневого лэйаута, теперь — из своего тела,
   * которое едет чанком (components/ReadOnlyNoteBox): в лэйауте нет ни
   * адресов, ни тем более текстов лендинга (lib/sharedchunk.test.ts). Тексты
   * не должны въехать и в тело: это 1.8 КБ кириллицы ради одного имени.
   */
  test('записка проверяет адрес входа, но не везёт тексты лендинга', () => {
    const note = files('components/ReadOnlyNoteBox.tsx')
    // без этого сторож ниже мог бы быть зелёным вхолостую
    expect(note).toContain('lib/destination.ts')
    expect(note, 'тексты лендинга — 1.8 КБ кириллицы в чанке записки').not.toContain('lib/destinationtext.ts')
    expect(files('app/layout.tsx'), 'тексты лендинга — в каждой странице').not.toContain('lib/destinationtext.ts')
  })

  test('квиз читает метку прогрева, но не разбор сохранённой выдачи', () => {
    const quiz = files('app/quiz/page.tsx')
    expect(quiz).toContain('lib/warmmark.ts')
    for (const heavy of ['lib/playcache.ts', 'lib/playflow.ts', 'lib/eveningplan.ts']) {
      expect(quiz, `${heavy} снова в первой загрузке /quiz`).not.toContain(heavy)
    }
  })

  test('«Выйти» стирает выдачу, не разбирая её', () => {
    const signOut = files('components/SignOut.tsx')
    expect(signOut).toContain('lib/playforget.ts')
    for (const heavy of ['lib/playcache.ts', 'lib/playflow.ts', 'lib/eveningplan.ts']) {
      expect(signOut, `${heavy} снова в первой загрузке /library`).not.toContain(heavy)
    }
  })

  /*
   * План на вечер, закрытый не на /play, вычёркивается из записи выдачи
   * (lib/planforget) — со страницы игры, из «Твоих вечеров» и с «Игры дня».
   * Разбор выдачи ради этого им не нужен, а прогрев (lib/warmup, его везёт
   * lib/playforget) странице игры и «Твоим вечерам» — тем более.
   */
  test('план, закрытый вне /play, правит выдачу, не разбирая её', () => {
    expect(files('lib/planforget.ts'), 'у правки записи нет зависимостей').toEqual(['lib/planforget.ts'])
    for (const island of ['components/OwnedLaunch.tsx', 'components/Evenings.tsx']) {
      const got = files(island)
      expect(got, island).toContain('lib/planforget.ts')
      for (const heavy of ['lib/playcache.ts', 'lib/playflow.ts', 'lib/playforget.ts', 'lib/warmup.ts']) {
        expect(got, `${heavy} снова в ${island}`).not.toContain(heavy)
      }
    }
    const daily = files('app/daily/page.tsx')
    expect(daily).toContain('lib/planforget.ts')
    expect(daily, 'lib/playcache.ts в первой загрузке /daily').not.toContain('lib/playcache.ts')
  })

  test('обложка знает магазин игры, не таща пул игр других магазинов', () => {
    const cover = files('components/TypeCover.tsx')
    expect(cover).toContain('lib/storecover.ts')
    expect(cover).not.toContain('lib/otherstores.ts')
  })

  test('правило «где взять игру» — только у комнаты', () => {
    expect(files('app/room/[id]/page.tsx')).toContain('lib/storelink.ts')
    for (const page of ['app/play/page.tsx', 'app/daily/page.tsx', 'app/library/page.tsx']) {
      expect(files(page), page).not.toContain('lib/storelink.ts')
    }
  })

  /*
   * Островки этих страниц — components/lazyIsland. Рантайм next/dynamic —
   * ~4 КБ к первой загрузке, и на них его больше ничто не везёт: один
   * dynamic() в любом статически достижимом модуле вернул бы его целиком.
   */
  test('next/dynamic не в первой загрузке /play, /daily и /library', () => {
    for (const page of ['app/play/page.tsx', 'app/daily/page.tsx', 'app/library/page.tsx']) {
      const { packages } = reach(path.join(ROOT, page))
      expect(packages.get('next/dynamic'), `${page}: next/dynamic вернулся`).toBeUndefined()
    }
  })
})

describe('островок — как next/dynamic с ssr: false', () => {
  test('на сервере — пусто, и загрузчик не зовётся', () => {
    function Bold() {
      return createElement('b', null, 'островок')
    }
    const load = vi.fn(async () => Bold)
    const Island = lazyIsland(load, 'test')
    expect(renderToStaticMarkup(createElement('p', null, createElement(Island)))).toBe('<p></p>')
    expect(load).not.toHaveBeenCalled()
  })
})

describe('выход без загруженного модуля выдачи', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  function fakeStorage(seed: Record<string, string>) {
    const data: Record<string, string> = { ...seed }
    return {
      data,
      area: {
        getItem: (k: string) => (Object.hasOwn(data, k) ? data[k] : null),
        setItem: (k: string, v: string) => {
          data[k] = v
        },
        removeItem: (k: string) => {
          delete data[k]
        },
      },
    }
  }

  /*
   * На /library модуля выдачи (lib/playcache) нет вовсе — его хранилища не
   * зарегистрированы, и в памяти вкладки выдачи нет. Стереть их ключи —
   * ровно то, что сделал бы их set(null).
   */
  test('стирает все три записи по ключам', async () => {
    vi.resetModules()
    const session = fakeStorage({ 'imbored.play.deal': '{}', 'imbored.play.warm': '{}', other: '1' })
    const local = fakeStorage({ 'imbored.play.bans': '[]', other: '1' })
    vi.stubGlobal('sessionStorage', session.area)
    vi.stubGlobal('localStorage', local.area)
    const { forgetPlay } = await import('./playforget')
    forgetPlay()
    expect(session.data).toEqual({ other: '1' })
    expect(local.data).toEqual({ other: '1' })
  })
})
