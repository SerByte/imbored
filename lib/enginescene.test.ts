import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { landingDemo } from './landing'

/**
 * Сторож сцены «Как это работает» (components/landing/scenes/Engine.tsx).
 *
 * ПЕРВОЕ: незакреплённая сцена отпускает руки сразу.
 *
 * Переключатели оживают, когда прокрутка доиграет партитуру (`past`), — а
 * партитуру считал свой ScrollTrigger сцены с окном закрепления: 'top top' →
 * '+=240%'. Только закрепления нет там, где сцена не помещается в экран
 * (Stage, `fits`), — то есть на любом телефоне: замер в докблоке Stage, 981 px
 * содержимого при рабочей высоте 767 на 375×812. Без закрепления секция уходит
 * из кадра примерно через свою высоту, прогресс окна в 2.4 экрана к этому
 * моменту — около половины, и 0.82 наступало через полэкрана ПОСЛЕ того, как
 * сцена уехала. Касание чипа `held` не ставит (это :focus-visible, клавиатура),
 * VoiceOver — тоже. Итог: «Расслабиться / Напрячься / Один / С друзьями» на
 * телефоне не отвечали на нажатие ни разу, пока были видны.
 *
 * Проверяется поведение партитуры (buildEngine с заглушками gsap), а не текст:
 * незакреплённая сцена живая сразу и счёта по прокрутке не заводит вовсе —
 * иначе каждый следующий тик прокрутки перебивал бы выбор касанием своим
 * тактом. У закреплённой всё по-прежнему: руки отдаются с 0.82.
 */

const { create, gsapSet } = vi.hoisted(() => ({ create: vi.fn(), gsapSet: vi.fn() }))

vi.mock('gsap/ScrollTrigger', () => ({ ScrollTrigger: { create } }))
vi.mock('gsap', () => ({ default: { set: gsapSet, registerPlugin: vi.fn() } }))
vi.mock('@gsap/react', () => ({ useGSAP: vi.fn() }))

const { buildEngine, Engine } = await import('@/components/landing/scenes/Engine')

/** Таймлайн-заглушка: to() цепочкой, как у gsap */
function timeline() {
  const tl = { to: vi.fn(() => tl) }
  return tl as unknown as gsap.core.Timeline
}
const root = { querySelector: () => null } as unknown as HTMLElement

type Update = (self: { progress: number }) => void

beforeEach(() => {
  create.mockClear()
  gsapSet.mockClear()
})

describe('переключатели сцены подбора', () => {
  test('сцена не закреплена (телефон) — переключатели живые сразу, счёта по прокрутке нет', () => {
    const key = vi.fn()
    const past = vi.fn()
    buildEngine(timeline(), root, false, { key, past })
    expect(past, 'без закрепления ждать партитуру негде — чипы обязаны отвечать сразу').toHaveBeenLastCalledWith(true)
    expect(
      create,
      'счёт тактов без закрепления перебивал бы выбор касанием на следующем же тике прокрутки',
    ).not.toHaveBeenCalled()
    expect(key, 'такт без закрепления не щёлкается — выбор остаётся за человеком').not.toHaveBeenCalled()
  })

  test('сцена закреплена (десктоп) — руки отдаются с 0.82, такты щёлкает прокрутка', () => {
    const key = vi.fn()
    const past = vi.fn()
    buildEngine(timeline(), root, true, { key, past })
    expect(create).toHaveBeenCalledTimes(1)
    const opts = create.mock.calls[0][0] as { start: string; end: string; onUpdate: Update }
    expect(opts.start).toBe('top top')
    expect(opts.end).toBe('+=240%')

    // До создания триггера past сброшен: пересборка на повороте телефона
    // (из незакреплённой в закреплённую) не оставляет чипы живыми до партитуры
    expect(past.mock.calls[0]).toEqual([false])

    opts.onUpdate({ progress: 0.5 })
    expect(key).toHaveBeenLastCalledWith('engaged:solo')
    expect(past).toHaveBeenLastCalledWith(false)

    opts.onUpdate({ progress: 0.9 })
    expect(key).toHaveBeenLastCalledWith('engaged:friends')
    expect(past).toHaveBeenLastCalledWith(true)
  })

  /**
   * Решение «закреплять» принимает только Stage — и обязан передать его в
   * build: второй источник этого решения в сцене разошёлся бы с первым.
   */
  test('Stage сообщает build, закрепил ли он сцену', () => {
    const stage = fs
      .readFileSync(path.join(__dirname, '..', 'components', 'landing', 'Stage.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    expect(stage).toMatch(/build\(tl,\s*root,\s*fits\)/)
  })
})

/**
 * ВТОРОЕ: пятёрка — нумерованный список.
 *
 * Видимый ранг «01…05» спрятан от скринридера (aria-hidden) с объяснением
 * «порядок уже сообщает сам список» — а списка не было: пять div подряд.
 * Ридер слышал пять текстовых блоков без числа и без места, то есть терял
 * ровно то, ради чего сцена существует: «своё идёт первым».
 *
 * Разметку проверяем серверным рендером сцены — той же, что уходит в
 * статический HTML главной.
 */
describe('пятёрка для скринридера', () => {
  const html = renderToStaticMarkup(createElement(Engine, { demo: landingDemo(1_780_000_000) }))

  test('каждый набор — <ol role="list"> из пяти <li>', () => {
    const sets = [...html.matchAll(/<ol role="list" class="pickset[^"]*">([\s\S]*?)<\/ol>/g)]
    expect(sets, 'четыре набора — по одному на состояние переключателей').toHaveLength(4)
    for (const [, body] of sets) {
      expect(body.match(/<li class="pick">/g), 'пять карточек — пять пунктов списка').toHaveLength(5)
    }
  })

  test('видимый ранг от ридера спрятан — место называет сам список', () => {
    expect(html).toMatch(/<span aria-hidden="true" class="pick-rank">01<\/span>/)
  })
})

/**
 * ТРЕТЬЕ: «Почему первая» — обещание первой строки главной («И почему именно
 * она»), показанное до входа: причина первой карточки, про демо-игрока
 * (lib/landing.ts, LandingCard.why).
 *
 * Стоит под стеной, а не в карточке: в карточке она прибавляла сцене 64 px и
 * снимала закрепление на обычных окнах ноутбука (замер — в разметке сцены).
 * Наборов четыре, как пятёрок, и виден ровно тот, что включён.
 */
describe('почему первая', () => {
  const demo = landingDemo(1_780_000_000)
  const html = renderToStaticMarkup(createElement(Engine, { demo }))
  const unescape = (s: string) =>
    s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

  test('у каждого состояния своя причина, видна только включённая', () => {
    const whys = [...html.matchAll(/<div class="engine-why( is-on)?">[\s\S]*?<p[^>]*>([^<]*)<\/p><\/div>/g)]
    expect(whys, 'по причине на каждое состояние переключателей').toHaveLength(4)
    const on = whys.filter((w) => w[1])
    expect(on, 'видна ровно одна — та, что под включённой пятёркой').toHaveLength(1)
    expect(unescape(on[0][2])).toBe(demo.picks['chill:solo'][0].why)
    expect(html).toContain('Почему первая')
  })

  /*
   * Причина — часть ответа: приходит вместе с пятёркой, а не раньше неё, и
   * прячется до этого так же, как пятёрка, — autoAlpha, а не opacity
   * (lib/hiddenfocus.test.ts).
   */
  test('в партитуре причина прячется и приходит вместе с пятёркой', () => {
    const whys = { tag: 'whys' }
    const picks = { tag: 'picks' }
    const node = { querySelector: (sel: string) => (sel === '[data-whys]' ? whys : sel === '[data-picks]' ? picks : null) }
    const tl = timeline()
    buildEngine(tl, node as unknown as HTMLElement, true, { key: vi.fn(), past: vi.fn() })
    expect(gsapSet).toHaveBeenCalledWith(whys, expect.objectContaining({ autoAlpha: 0 }))
    const to = (tl as unknown as { to: ReturnType<typeof vi.fn> }).to.mock.calls
    const at = (target: unknown) => to.find((c) => c[0] === target)?.[2] as number
    expect(at(whys), 'причина приходит не раньше пятёрки').toBeGreaterThanOrEqual(at(picks))
  })
})
