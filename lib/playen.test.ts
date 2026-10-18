import fs from 'node:fs'
import path from 'node:path'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { LocaleProvider } from '../components/LocaleProvider'
import { SpinWheel } from '../components/SpinWheel'
import { TagChips } from '../components/TagChips'
import { WarmupScreen } from '../components/WarmupScreen'
import type { Locale } from './i18n'

/**
 * /play и его островки по-английски.
 *
 * Островки берут язык из контекста (useLocale), а не пропом: их рендерят и
 * чужие страницы (/daily, /explore), и проп пришлось бы протягивать через
 * каждую. Поэтому здесь — рендер под LocaleProvider: на /en ни одной русской
 * буквы, без провайдера и на ru — прежний текст до буквы.
 *
 * Плашки порталом (StopAsk, WarmStrip, OutcomeAsk) на сервере не рисуются
 * вовсе — их строки сторожит разбор исходника ниже, вместе со страницей.
 */

const CYRILLIC = /[А-Яа-яЁё]/
const ROOT = path.join(__dirname, '..')

const under = (locale: Locale | null, node: ReactNode) =>
  renderToStaticMarkup(locale ? createElement(LocaleProvider, { locale, children: node }) : node)

const warmup = () =>
  createElement(WarmupScreen, {
    progress: { remaining: 312, total: 1204, library: { games: 1204, untouched: 87, wall: [] } },
    message: 'Looking through your library…',
    caption: 'Short · Chill · Solo',
    chosen: { appid: 620, name: 'Portal 2' },
  })

describe('островки /play на /en', () => {
  test('экран ожидания: кольцо, стена и факты библиотеки — без кириллицы', () => {
    const html = under('en', warmup())
    expect(html).not.toMatch(CYRILLIC)
    expect(html).toContain('One of 1,204')
    expect(html).toContain('% read')
    expect(html).toContain('in your library')
    expect(html).toContain('of them you&#x27;ve never launched')
  })

  test('экран ожидания при скрытом времени — строка о настройках Steam', () => {
    const html = under(
      'en',
      createElement(WarmupScreen, {
        progress: { remaining: 0, total: 10, library: { games: 10, untouched: 0, timeHidden: true } },
        message: 'Going through your library…',
      }),
    )
    expect(html).not.toMatch(CYRILLIC)
    expect(html).toContain('playtime seems to be hidden by your Steam privacy settings')
  })

  test('экран ожидания на ru и без провайдера — прежние слова', () => {
    for (const html of [under('ru', warmup()), under(null, warmup())]) {
      // Разряды — неразрывным пробелом, как у прежнего toLocaleString('ru-RU')
      expect(html).toContain('Из 1\u00a0204 — одна')
      expect(html).toContain('разобрано')
      expect(html).toContain('в библиотеке')
      expect(html).toContain('из них ты не открывал ни разу')
    }
  })

  test('теги: подпись — сам тег Steam, отметка совпадения — по-английски', () => {
    const chips = createElement(TagChips, { tags: ['Puzzle', 'Co-op'], matched: ['Puzzle'] })
    const en = under('en', chips)
    expect(en).not.toMatch(CYRILLIC)
    expect(en).toContain('Puzzle')
    expect(en).toContain(' — in your games')
    expect(under('ru', chips)).toContain(' — есть в твоих играх')
  })

  test('барабан рулетки говорит по-английски', () => {
    const wheel = createElement(SpinWheel, { items: ['Portal 2', 'Hades'], landOn: 1, onDone: () => {} })
    const en = under('en', wheel)
    expect(en).not.toMatch(CYRILLIC)
    expect(en).toContain('Picking a game…')
    expect(under('ru', wheel)).toContain('Выбираем игру…')
  })
})

/**
 * Разбор исходника: каждая строка с кириллицей в коде /play и островков
 * стоит в русской ветке пары (ru:) — или в списке на язык (SKIP_REASONS,
 * FAIL…), где рядом английский двойник. Комментарии вырезаются: они в
 * проекте по-русски по правилу.
 *
 * Сторож грубый намеренно: он не понимает JSX, а ищет «русское без пары». Но
 * именно так и возвращается забытая строка — голым литералом в разметке.
 */
describe('в коде /play нет русского без английской пары', () => {
  const FILES = [
    'app/[lang]/play/page.tsx',
    'app/[lang]/play/layout.tsx',
    'components/WarmupScreen.tsx',
    'components/WarmStrip.tsx',
    'components/SpinWheel.tsx',
    'components/StopAsk.tsx',
    'components/TonightButton.tsx',
    'components/OutcomeAsk.tsx',
    'components/SharePick.tsx',
    'components/TagChips.tsx',
    'components/HeroShots.tsx',
    'components/HeroTrailer.tsx',
    'components/morph/MorphSlider.tsx',
  ]

  /** Код без комментариев; строки сохраняют номера */
  const code = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  test.each(FILES)('%s', (file) => {
    const lines = code(fs.readFileSync(path.join(ROOT, file), 'utf8')).split('\n')
    const bare: string[] = []
    // Русская ветка пары может занимать несколько строк (JSX-фрагмент, список
    // или карточки на язык): всё от последнего «ru:» до «en:» — её тело
    let inRu = false
    lines.forEach((line, i) => {
      if (CYRILLIC.test(line) && !inRu && !/\bru: /.test(line)) bare.push(`${file}:${i + 1}: ${line.trim()}`)
      const ru = line.lastIndexOf('ru: ')
      const en = line.lastIndexOf('en: ')
      if (ru > en) inRu = true
      else if (en > -1) inRu = false
    })
    expect(bare, 'русская строка без английской пары — на /en она останется русской').toEqual([])
  })
})
