import { createElement, type ComponentProps, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { LocaleProvider } from '@/components/LocaleProvider'
import { landingDemo } from './landing'
import { stepsFor } from './quiz'

/**
 * Английская главная (/en) — сцены, дверь без скрипта и подсказка «Where’s
 * that?» серверным рендером, тем же, что уходит в статический HTML.
 *
 * Тесты по-русски сторожат раскладку и обещания главной; здесь — что на /en
 * всё это говорит по-английски целиком (ни одной кириллической буквы вне
 * названий игр, которых в демо и так нет) и теми словами глоссария, которые
 * человек встретит дальше: чипы сцены подбора — подписи квиза, лозунг денег —
 * фраза /support, шаги Steam — пункты английского клиента Steam.
 *
 * Партитуры сцен (gsap) здесь не нужны: рендер серверный, эффектов нет.
 */
vi.mock('gsap/ScrollTrigger', () => ({ ScrollTrigger: { create: vi.fn() } }))
vi.mock('gsap', () => ({ default: { set: vi.fn(), registerPlugin: vi.fn() } }))
vi.mock('@gsap/react', () => ({ useGSAP: vi.fn() }))

const { Engine } = await import('@/components/landing/scenes/Engine')
const { Compat } = await import('@/components/landing/scenes/Compat')
const { Pain } = await import('@/components/landing/scenes/Pain')
const { Money } = await import('@/components/landing/scenes/Money')
const { AccessNote, ConnectFallback } = await import('@/components/landing/ConnectFallback')
const { LinkHelp, LinkHelpToggle } = await import('@/components/landing/LinkHelp')

const CYR = /[А-Яа-яЁё]/
const NOW = 1_780_000_000

/** Рендер под провайдером языка — как под корневым layout на /en */
const en = (el: ReactElement) =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale: 'en' } as ComponentProps<typeof LocaleProvider>, el))

describe('сцены главной на /en', () => {
  test('сцена подбора: чипы — подписи квиза, «Why this one first», без кириллицы', () => {
    const html = renderToStaticMarkup(createElement(Engine, { demo: landingDemo(NOW, 'en'), locale: 'en' }))
    expect(html).not.toMatch(CYR)
    expect(html).toContain('Why this one first')
    // те же слова, что человек нажмёт в квизе
    const quiz = stepsFor('en').flatMap((s) => s.options.map((o) => o.label))
    for (const chip of ['Unwind', 'Lock in', 'Solo', 'With friends']) {
      expect(quiz, chip).toContain(chip)
      expect(html).toContain(`<b>${chip}</b>`)
    }
    // число часов — с разрядами английского письма
    expect(html).toMatch(/\d,\d{3} hours/)
  })

  test('сцена совместимости: числа и подписи по-английски', () => {
    const demo = landingDemo(NOW, 'en')
    const html = renderToStaticMarkup(createElement(Compat, { demo, locale: 'en' }))
    expect(html).not.toMatch(CYR)
    expect(html).toContain('games in common')
    expect(html).toContain(demo.compat.hours.toLocaleString('en-US'))
  })

  test('без языка сцены — русские, как были', () => {
    const html = renderToStaticMarkup(createElement(Engine, { demo: landingDemo(NOW) }))
    expect(html).toContain('Почему первая')
    expect(renderToStaticMarkup(createElement(Compat, { demo: landingDemo(NOW) }))).toContain('общих игр')
  })

  test('сцены без данных — по-английски из провайдера', () => {
    for (const scene of [Pain, Money]) expect(en(createElement(scene))).not.toMatch(CYR)
    // лозунг денег — фраза глоссария, та же, что на /support
    const money = en(createElement(Money))
    expect(money.replace(/ /g, ' ')).toContain(
      'We don’t sell spots in our picks. A recommendation is trust, <span class="text-ember-text">and trust isn’t for sale</span>.',
    )
    // артикль не остаётся в конце строки — как предлог в русском
    expect(money).toContain('A\u00a0recommendation')
    // возврат к форме: «yours» есть на что указать — заголовок называет библиотеку
    expect(money).toContain('>Connect your library?</h3>')
    expect(money).toContain('Rather not share yours?')
    expect(money).toMatch(/<a class="btn-ember back-btn" href="#main">Back to the top <svg/)
  })
})

describe('дверь без скрипта и подсказки поля на /en', () => {
  test('фолбэк: вход через Steam с языком и сноска по-английски', () => {
    const html = en(createElement(ConnectFallback))
    expect(html).not.toMatch(CYR)
    expect(html).toContain('href="/api/auth/steam?lang=en"')
    expect(html).toContain('>Sign in with Steam</a>')
    expect(html).toContain('href="/en/privacy"')
  })

  test('сноска: у фразы о пароле тот же id, на который ссылается дверь', () => {
    expect(en(createElement(AccessNote))).toMatch(
      /^<p [^>]*><span id="steam-password-note">You enter your password on Steam’s site — we never see it\.<\/span>/,
    )
  })

  test('«Where’s that?» и шаги — пунктами английского клиента Steam', () => {
    const toggle = en(createElement(LinkHelpToggle, { open: false, onToggle: () => {} }))
    expect(toggle).toContain('aria-label="Where do I find my link?"')
    expect(toggle).toMatch(/<span class="join-help-word">Where’s that<\/span>\?<\/button>$/)
    const panel = en(createElement(LinkHelp, { open: true }))
    expect(panel).not.toMatch(CYR)
    for (const label of ['“Profile”', '“Copy Page URL”', '“Add a Friend”', '/id/']) expect(panel).toContain(label)
  })
})
