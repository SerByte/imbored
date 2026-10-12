import fs from 'node:fs'
import path from 'node:path'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { landingDemo, MOOD_KEYS, type LandingDemo } from './landing'

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

/**
 * Хуки для прямого вызова Engine — без DOM нажатие иначе не увидеть: серверный
 * рендер setState после себя молча выбрасывает.
 *
 * Пока hooks.store пуст, всё уходит в настоящий React, и серверные рендеры
 * сцены этой подмены не замечают. С хранилищем useState помнит значения между
 * вызовами по порядку хуков — как React между рендерами, — а «уменьшить
 * движение» читается серверным снимком, как при гидратации. build при прямом
 * вызове не исполняется, и past остаётся false: это закреплённая сцена, чья
 * партитура ещё не сыграна, — ровно то место, куда прокрутка к чипу её ставит.
 */
const hooks = vi.hoisted(() => ({ store: null as unknown[] | null, at: 0 }))
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  const realState = react.useState
  const realExternal = react.useSyncExternalStore
  return {
    ...react,
    useState: ((init: unknown) => {
      const store = hooks.store
      if (!store) return realState(init)
      const i = hooks.at++
      if (!(i in store)) store[i] = init
      return [store[i], (next: unknown) => void (store[i] = next)]
    }) as typeof react.useState,
    useSyncExternalStore: ((subscribe, get, server) =>
      hooks.store ? server!() : realExternal(subscribe, get, server)) as typeof react.useSyncExternalStore,
  }
})

const { buildEngine, Engine } = await import('@/components/landing/scenes/Engine')

type Props = {
  children?: ReactNode
  className?: string
  'aria-pressed'?: boolean
  'data-live'?: string
  onClick?: (e: { detail: number }) => void
}

/** Все элементы дерева подряд, без вызова вложенных компонентов */
function walk(node: ReactNode, out: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) for (const n of node) walk(n as ReactNode, out)
  else if (isValidElement<Props>(node)) {
    out.push(node)
    walk(node.props.children, out)
  }
  return out
}

/** Один «рендер» сцены прямым вызовом: чипы по подписи, блоки причины, data-live */
function scene(demo: LandingDemo) {
  hooks.at = 0
  const all = walk(Engine({ demo }))
  const chip = (label: string) => {
    const el = all.find(
      (e) => e.type === 'button' && (e.props.children as ReactElement<Props>[])[0].props.children === label,
    )
    if (!el) throw new Error(`нет чипа «${label}»`)
    return el.props
  }
  return {
    chip,
    pressed: (label: string) => chip(label)['aria-pressed'],
    live: all.find((e) => e.props.className === 'engine-grid')?.props['data-live'],
    whys: all.filter((e) => /^engine-why( |$)/.test(e.props.className ?? '')),
  }
}

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
 *
 * Блок — на каждую РАЗНУЮ причину, а не на каждое состояние. Первая игра от
 * компании почти не зависит: в демо «Один» и «С друзьями» дают одну и ту же
 * первую и одну и ту же причину. Четыре блока по ключам перекрещивали на
 * нажатии «Один ↔ С друзьями» два одинаковых абзаца, и на середине перехода
 * суммарная непрозрачность проседала до ~0.75 — причина мигала, хотя не
 * менялось ничего.
 */
describe('почему первая', () => {
  const demo = landingDemo(1_780_000_000)
  const html = renderToStaticMarkup(createElement(Engine, { demo }))
  const unescape = (s: string) =>
    s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

  test('по блоку на каждую разную причину демо-выдачи, виден ровно тот, что у включённой пятёрки', () => {
    const whys = [...html.matchAll(/<div class="engine-why( is-on)?">[\s\S]*?<p[^>]*>([^<]*)<\/p><\/div>/g)]
    const distinct = [...new Set(MOOD_KEYS.flatMap((k) => demo.picks[k][0]?.why ?? []))]
    expect(
      whys.map((w) => unescape(w[2])),
      'одинаковая причина у двух состояний — один блок, а не два одинаковых',
    ).toEqual(distinct)
    const on = whys.filter((w) => w[1])
    expect(on, 'видна ровно одна — та, что под включённой пятёркой').toHaveLength(1)
    expect(unescape(on[0][2])).toBe(demo.picks['chill:solo'][0].why)
    expect(html).toContain('Почему первая')
  })

  /*
   * Сама подмена — прямым вызовом сцены (scene выше). Демо собрано руками,
   * чтобы проверка не зависела от того, совпадут ли первые игры в данных:
   * у «Один» и «С друзьями» одна причина, у «Напрячься» — другая.
   */
  test('«Один ↔ С друзьями» с той же причиной не трогает блок, смена вайба — меняет', () => {
    const base = landingDemo(1_780_000_000)
    const first = (k: (typeof MOOD_KEYS)[number], why: string) => [{ ...base.picks[k][0], why }, ...base.picks[k].slice(1)]
    const same = 'Причина одна на обе компании.'
    const other = 'Причина для «Напрячься».'
    const paired: LandingDemo = {
      ...base,
      picks: {
        'chill:solo': first('chill:solo', same),
        'chill:friends': first('chill:friends', same),
        'engaged:solo': first('engaged:solo', other),
        'engaged:friends': first('engaged:friends', other),
      },
    }
    hooks.store = []
    try {
      const on = () => {
        const s = scene(paired)
        const lit = s.whys.filter((e) => e.props.className?.includes('is-on'))
        expect(lit, 'включён ровно один блок').toHaveLength(1)
        return { keys: s.whys.map((e) => e.key), lit: lit[0].key, s }
      }
      const before = on()
      expect(before.keys, 'два разных текста — два блока').toEqual([same, other])
      expect(before.lit).toBe(same)

      before.s.chip('С друзьями').onClick!({ detail: 0 })
      const after = on()
      expect(after.s.pressed('С друзьями')).toBe(true)
      expect(after.keys, 'набор блоков тот же — React не пересоздаёт ни один').toEqual(before.keys)
      expect(after.lit, 'включён тот же элемент — переходить ему некуда, мигать нечему').toBe(same)

      after.s.chip('Напрячься').onClick!({ detail: 0 })
      expect(on().lit, 'другая первая — другая причина').toBe(other)
    } finally {
      hooks.store = null
    }
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

/**
 * ЧЕТВЁРТОЕ: нажатие без указателя отвечает и на закреплённой сцене.
 *
 * Закреплённая сцена отдаёт руки с 0.82 прогресса (past), клавиатуре —
 * досрочно, по фокусу с :focus-visible (held). Экранный диктор нажимает
 * кнопку, не проводя к ней клавиатурный фокус (VoiceOver VO+Пробел, NVDA в
 * режиме обзора, Switch Control): held не встаёт, а прокрутка к чипу ставит
 * сцену около нуля — и нажатие пропадало. Такой click узнаётся по detail 0;
 * у щелчка мыши и касания detail 1 и больше, и для них отказ до конца
 * партитуры остаётся прежним.
 */
describe('нажатие без указателя на закреплённой сцене', () => {
  const demo = landingDemo(1_780_000_000)
  beforeEach(() => {
    hooks.store = []
  })
  afterEach(() => {
    hooks.store = null
  })

  test('click с detail 0 (клавиатура, диктор) переключает, пока партитура не сыграна', () => {
    const before = scene(demo)
    expect(before.live, 'сцена ещё не отпущена — past и held ложны').toBe('0')
    expect(before.pressed('Один')).toBe(true)
    before.chip('С друзьями').onClick!({ detail: 0 })
    const after = scene(demo)
    expect(after.pressed('С друзьями'), 'нажатие диктора не пропадает').toBe(true)
    expect(after.pressed('Один')).toBe(false)
    expect(after.live, 'сцена при этом не «отпускается» целиком — курсор и отклик из стилей ждут партитуру').toBe('0')
  })

  test('щелчок мыши (detail ≥ 1) до конца партитуры по-прежнему ничего не меняет', () => {
    scene(demo).chip('С друзьями').onClick!({ detail: 1 })
    const after = scene(demo)
    expect(after.pressed('Один'), 'курсор дождётся прокрутки — отказ для мыши честен').toBe(true)
    expect(after.pressed('С друзьями')).toBe(false)
  })
})
