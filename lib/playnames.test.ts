import fs from 'node:fs'
import path from 'node:path'
import { createElement, type ComponentProps, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { LocaleProvider } from '../components/LocaleProvider'
import { OutcomeAsk } from '../components/OutcomeAsk'
import { SpinWheel } from '../components/SpinWheel'
import { StopAsk } from '../components/StopAsk'
import type { Locale } from './i18n'
import type { OutcomeAsk as Ask } from './outcome'

/**
 * Названия игр на /play — данные, и на /en русское название обязано стоять
 * своим lang="ru" (WCAG 3.1.2, docs/i18n.md: textLangOn и withForeignRuns),
 * иначе английский голос скринридера читает его по буквам. На русской
 * странице атрибута нет, как не было: разметка прежняя до байта.
 *
 * Плашки порталом (StopAsk, OutcomeAsk) на сервере не рисуются, поэтому
 * портал здесь — просто дети на месте. Вопрос OutcomeAsk приходит из fetch в
 * эффекте, которого серверный рендер не делает: его состояние подставлено
 * подменой useState — тем же приёмом, что у lib/backstage.test.ts. Подмена
 * видна только нашим модулям: framer-motion и react-dom берут настоящий react.
 */

const { asked } = vi.hoisted(() => ({ asked: { current: null as unknown } }))

vi.mock('@/components/Portal', () => ({ Portal: ({ children }: { children: ReactNode }) => children }))

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    // Только состояние вопроса OutcomeAsk: единственный useState(null) в рендере
    useState: (init: unknown) => (init === null && asked.current ? [asked.current, () => {}] : react.useState(init)),
  }
})

const CYRILLIC = /[А-Яа-яЁё]/
const ROOT = path.join(__dirname, '..')

const under = (locale: Locale | null, node: ReactNode) =>
  renderToStaticMarkup(
    locale ? createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, node) : node,
  )

/** Разметка без честно помеченных кусков: в остатке кириллицы быть не должно */
const unmarked = (html: string) => html.replace(/<span lang="ru"[^>]*>[^<]*<\/span>/g, '')

const RU_NAME = 'Одни из нас™: Часть II'

const stop = (name: string) =>
  createElement(StopAsk<'genre'>, {
    game: { appid: 1888930, name },
    reasons: [{ key: 'genre', label: 'Wrong genre' }],
    onReason: () => {},
    onHooked: () => {},
    onClose: () => {},
  })

describe('«“X” didn’t hook you?» (StopAsk)', () => {
  test('на /en русское название — lang="ru" и в плашке, и в живой строке', () => {
    const html = under('en', stop(RU_NAME))
    expect(html).toContain(`<span lang="ru" class="text-ember-text">“${RU_NAME}”</span> didn&#x27;t hook you?`)
    expect(html).toContain(
      `<p role="status" class="sr-only">“<span lang="ru">${RU_NAME}</span>” didn&#x27;t hook you? The question is at the bottom of the screen</p>`,
    )
    expect(unmarked(html)).not.toMatch(CYRILLIC)
  })

  test('латинское название на /en — без пометки, одним текстом', () => {
    const html = under('en', stop('Portal 2'))
    expect(html).toContain('<span class="text-ember-text">“Portal 2”</span> didn&#x27;t hook you?')
    expect(html).toContain('<p role="status" class="sr-only">“Portal 2” didn&#x27;t hook you?')
    expect(html).not.toContain('lang=')
  })

  test('на ru и без провайдера — прежняя разметка, без lang', () => {
    for (const html of [under('ru', stop(RU_NAME)), under(null, stop(RU_NAME))]) {
      expect(html).toContain(`<p role="status" class="sr-only">Не зацепило «${RU_NAME}»? Вопрос внизу экрана</p>`)
      expect(html).toContain(`Не зацепило <span class="text-ember-text">«${RU_NAME}»</span>?`)
      expect(html).not.toContain('lang=')
    }
  })
})

describe('«How’s “X”?» (OutcomeAsk)', () => {
  const ask: Ask = { appid: 1888930, name: RU_NAME, shownAt: 1_760_000_000, minutes: 50, bought: false }
  const render = (locale: Locale | null, a: Ask) => {
    asked.current = a
    try {
      return under(locale, createElement(OutcomeAsk))
    } finally {
      asked.current = null
    }
  }

  test('на /en русское название — lang="ru" и в вопросе, и в живой строке', () => {
    const html = render('en', ask)
    const question = `“<span lang="ru">${RU_NAME}</span>”: you&#x27;ve played 50 min since we suggested it. How is it?`
    expect(html).toContain(`<p class="text-sm">${question}</p>`)
    expect(html).toContain(`<p role="status" class="sr-only">${question} The question is at the bottom of the screen</p>`)
    expect(unmarked(html)).not.toMatch(CYRILLIC)
  })

  test('латинское название на /en — без пометки', () => {
    const html = render('en', { ...ask, name: 'Hades' })
    expect(html).toContain('<p class="text-sm">“Hades”: you&#x27;ve played 50 min since we suggested it. How is it?</p>')
    expect(html).not.toContain('lang=')
  })

  test('на ru и без провайдера — прежний текст, без lang', () => {
    for (const html of [render('ru', ask), render(null, ask)]) {
      const question = `«${RU_NAME}»: 50 мин с тех пор, как мы её предложили. Как тебе?`
      expect(html).toContain(`<p class="text-sm">${question}</p>`)
      expect(html).toContain(`<p role="status" class="sr-only">${question} Вопрос внизу экрана</p>`)
      expect(html).not.toContain('lang=')
    }
  })
})

describe('барабан рулетки (SpinWheel)', () => {
  const wheel = () =>
    createElement(SpinWheel, { items: ['Смута', 'Portal 2', 'Атомное сердце'], landOn: 0, onDone: () => {} })

  test('на /en русские названия — lang="ru", латинские — без пометки', () => {
    const html = under('en', wheel())
    expect(html).toContain('<span lang="ru" class="truncate text-xl font-extrabold tracking-tight text-ink">Смута</span>')
    expect(html).toContain('<span lang="ru" class="truncate text-xl font-extrabold tracking-tight text-dim">Атомное сердце</span>')
    expect(html).toContain('<span class="truncate text-xl font-extrabold tracking-tight text-dim">Portal 2</span>')
    expect(unmarked(html)).not.toMatch(CYRILLIC)
  })

  test('на ru — без lang, как было', () => {
    const html = under('ru', wheel())
    expect(html).toContain('<span class="truncate text-xl font-extrabold tracking-tight text-ink">Смута</span>')
    expect(html).not.toContain('lang=')
  })
})

/**
 * Герой /play рисуется после ответа /api/recommend, и серверный рендер его
 * не видит — сторож по исходнику, как у пар ru/en в lib/playen.test.ts:
 * причина и кнопки с названием идут через withForeignRuns, а не голым текстом.
 */
describe('названия в тексте героя /play помечены', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app/[lang]/play/page.tsx'), 'utf8')

  test('причина героя — через withForeignRuns с героем и якорем', () => {
    // includes, а не toContain: при провале toContain печатал бы весь файл страницы
    expect(src.includes('withForeignRuns(locale, pick.reason, [pick.name, pick.via?.name])')).toBe(true)
    expect(/\{pick\.reason\}/.test(src)).toBe(false)
  })

  test('живая строка выдачи — названия в “лапках” своим lang', () => {
    // liveLineOn (lib/announce) — та же разметка через withForeignRuns, её
    // span на /en и голую строку на ru сторожит lib/announce.test.ts
    expect(src.includes('{liveLineOn(locale, said)}')).toBe(true)
    expect(/\{said\}/.test(src)).toBe(false)
  })

  test('«Like “X”, but…» и «Similar to “X”» — через withForeignRuns', () => {
    expect(/withForeignRuns\(\s*locale,\s*tr\(locale, \{ ru: `Как «\$\{pick\.name\}», но…`/.test(src)).toBe(true)
    expect(/withForeignRuns\(\s*locale,\s*tr\(locale, \{ ru: `Похожие на «\$\{seed\.name\}»`/.test(src)).toBe(true)
  })
})
