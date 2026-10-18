import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { SPARK_LIFE } from '../components/ClickSpark'
import {
  AUTO_MOTION,
  autoMotion,
  BLUR_REVEAL,
  CONFIRM_MS,
  DUR,
  EASE,
  EASE_CSS,
  EASE_GLOW,
  EASE_GLOW_CSS,
  EASE_IN,
  EASE_IN_CSS,
  EASE_LIFT_CSS,
  EASE_STRIKE_CSS,
  OUTRO,
} from './motion'

/**
 * Сторож движения — брат lib/contrast.test.ts.
 *
 * Токены хореографии живут в app/globals.css, а их JS-зеркало — в lib/motion.ts,
 * потому что CSS-переменные не читаются в таймлайнах без getComputedStyle.
 * Два источника одного числа дрейфуют молча; этот тест делает дрейф красным.
 */

const ROOT = path.join(__dirname, '..')
const CSS = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8')

function cssToken(name: string): string {
  const m = CSS.match(new RegExp(`${name}:\\s*([^;]+);`))
  if (!m) throw new Error(`нет токена ${name} в globals.css`)
  return m[1].trim()
}

describe('lib/motion.ts зеркалит токены globals.css', () => {
  test('--dur-* совпадают с DUR (мс ↔ с)', () => {
    expect(cssToken('--dur-fast')).toBe(`${DUR.fast * 1000}ms`)
    expect(cssToken('--dur-base')).toBe(`${DUR.base * 1000}ms`)
    expect(cssToken('--dur-slow')).toBe(`${DUR.slow * 1000}ms`)
  })

  test('--ease-out совпадает с EASE и EASE_CSS', () => {
    const css = cssToken('--ease-out')
    expect(css.replace(/\s+/g, ' ')).toBe(EASE_CSS)
    const nums = css.match(/[\d.]+/g)?.map(Number)
    expect(nums).toEqual([...EASE])
  })

  test('--blur-reveal совпадает с BLUR_REVEAL', () => {
    expect(cssToken('--blur-reveal')).toBe(`${BLUR_REVEAL}px`)
  })

  test('такт подтверждения равен --dur-fast', () => {
    expect(`${CONFIRM_MS}ms`).toBe(cssToken('--dur-fast'))
  })

  test('вторая половина словаря кривых зеркалится', () => {
    expect(cssToken('--ease-in').replace(/\s+/g, ' ')).toBe(EASE_IN_CSS)
    expect(cssToken('--ease-strike').replace(/\s+/g, ' ')).toBe(EASE_STRIKE_CSS)
    expect(cssToken('--ease-glow').replace(/\s+/g, ' ')).toBe(EASE_GLOW_CSS)
    expect(cssToken('--ease-lift').replace(/\s+/g, ' ')).toBe(EASE_LIFT_CSS)
    expect(
      cssToken('--ease-in')
        .match(/[\d.]+/g)
        ?.map(Number),
    ).toEqual([...EASE_IN])
    expect(
      cssToken('--ease-glow')
        .match(/[\d.]+/g)
        ?.map(Number),
    ).toEqual([...EASE_GLOW])
  })
})

describe('партитура финального такта', () => {
  test('искры умирают до навигации', () => {
    // Ровно тот баг, который это правило закрывает: залп на 450 мс при
    // навигации на 640-й обрывал единственный церемониальный эффект квиза
    // на середине жизни.
    expect(OUTRO.sparkAt + SPARK_LIFE).toBeLessThan(OUTRO.navMs)
  })

  test('все биты таймлайна заканчиваются до навигации', () => {
    // Добавляешь такт в таймлайн — добавляешь его сюда. Иначе новый бит уходит
    // без сторожа, а обрыв на середине видно только глазами и не всегда.
    const beats = [
      OUTRO.losersAt + OUTRO.losersDur,
      OUTRO.keyAt + OUTRO.keyDur,
      OUTRO.winnerAt + OUTRO.winnerDur,
      OUTRO.captionAt + OUTRO.captionDur,
      // косая приходит и уходит одной длительностью
      OUTRO.flareAt + OUTRO.flareDur * 2,
      OUTRO.roomOutAt + OUTRO.roomOutDur,
    ]
    for (const end of beats) expect(end * 1000).toBeLessThan(OUTRO.navMs)
  })

  test('приведённая навигация короче обычной, но не мгновенная', () => {
    // Ноль означал бы, что человек с включённым «уменьшить движение» никогда не
    // видит, что его ответ принят. Твинов нет, состояние обязано побыть.
    expect(OUTRO.reducedNavMs).toBeGreaterThan(0)
    expect(OUTRO.reducedNavMs).toBeLessThan(OUTRO.navMs)
  })
})

/**
 * Фон, который пошёл сам, сам и встаёт — WCAG 2.2.2 (Pause, Stop, Hide, A).
 *
 * Лента главной дрейфовала бесконечно (repeat: -1), декабрьский снег на /daily
 * шёл, пока открыта вкладка, и остановить то и другое было нечем, кроме
 * системного «уменьшить движение». Критерий требует паузу у всего, что
 * запускается само и длится дольше пяти секунд. Кнопка «Пауза» на фоне под
 * текстом — лишний элемент (довод — у морфа героя, components/HeroShots.tsx),
 * поэтому такой фон обязан уложиться в пять секунд сам.
 */
describe('самоходный фон встаёт сам', () => {
  const TOTAL = AUTO_MOTION.holdMs + AUTO_MOTION.fadeMs

  test('сразу после старта — полный ход', () => {
    expect(autoMotion(0)).toBe(1)
    expect(autoMotion(AUTO_MOTION.holdMs)).toBe(1)
  })

  test('встаёт строго раньше пяти секунд и больше не трогается', () => {
    expect(TOTAL, 'граница WCAG 2.2.2 — пять секунд движения').toBeLessThan(5000)
    expect(autoMotion(TOTAL)).toBe(0)
    expect(autoMotion(TOTAL + 1)).toBe(0)
    expect(autoMotion(60_000)).toBe(0)
  })

  /**
   * Множитель — скорость, и скачок в нём виден рывком колонок. Шаг 10 мс —
   * чаще кадра; smoothstep за такой шаг меняется не больше чем на 1.5 × 10 /
   * fadeMs, и порог взят с запасом над этим, но далеко под любой ступенькой.
   */
  test('тормозит монотонно и без скачков', () => {
    let prev = autoMotion(0)
    for (let t = 10; t <= TOTAL + 500; t += 10) {
      const k = autoMotion(t)
      expect(k, `${t} мс`).toBeGreaterThanOrEqual(0)
      expect(k, `${t} мс`).toBeLessThanOrEqual(prev)
      expect(prev - k, `скачок на ${t} мс`).toBeLessThan(0.01)
      prev = k
    }
  })

  /** Ради этого торможение — smoothstep, а не прямая: без угла на обоих краях. */
  test('торможение начинается и кончается плавно', () => {
    expect(autoMotion(AUTO_MOTION.holdMs + 25)).toBeGreaterThan(0.999)
    expect(autoMotion(TOTAL - 25)).toBeLessThan(0.001)
    expect(autoMotion(AUTO_MOTION.holdMs + AUTO_MOTION.fadeMs / 2)).toBeCloseTo(0.5, 5)
  })
})

/**
 * Второе обещание — статическое: самоходный фон берёт скорость из autoMotion,
 * а не держит свою. Без сторожа следующий бесконечный твин приедет с
 * repeat: -1 и без остановки — ровно так, как приехала лента.
 */
describe('самоходный фон подключён к autoMotion', () => {
  /** Комментарии гасятся: докблоки цитируют и repeat: -1, и само правило. */
  const strip = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])(\/\/[^\n]*)/g, (_, pre: string, c: string) => pre + ' '.repeat(c.length))

  const read = (rel: string) => strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) return walk(full)
      return /\.tsx?$/.test(e.name) ? [full] : []
    })
  }

  test('бесконечный твин живёт только рядом с autoMotion', () => {
    const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))]
    const offenders = files.flatMap((file) => {
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      const src = read(rel)
      return /\brepeat:\s*-1\b/.test(src) && !/\bautoMotion\(/.test(src) ? [rel] : []
    })
    expect(
      offenders,
      'repeat: -1 без autoMotion — фон, который идёт без конца и без паузы (WCAG 2.2.2)',
    ).toEqual([])
  })

  /**
   * paint() ставит timeScale дрейфа на каждом кадре. Вызов без множителя
   * вернул бы ленте вечный ход, даже если autoMotion в файле остался.
   */
  test('лента умножает скорость партитуры на autoMotion', () => {
    const src = read('components/landing/GameRibbon.tsx')
    const factor = src.match(/const (\w+) = autoMotion\(/)?.[1]
    expect(factor, 'множитель autoMotion в paint() не найден').toBeTruthy()
    const args = [...src.matchAll(/\.timeScale\(([^)]*)\)/g)].map((m) => m[1])
    expect(args.length, 'timeScale дрейфа не найден').toBeGreaterThan(0)
    for (const arg of args) {
      expect(arg, 'timeScale дрейфа без множителя autoMotion').toMatch(new RegExp(`\\b${factor}\\b`))
    }
  })

  /**
   * Вставшая лента не держит тикер. gsap засыпает, только когда слушателей
   * у тикера меньше двух и активных твинов нет; paint(), подписанный на всю
   * жизнь главной, держал requestAnimationFrame на частоте экрана и после
   * того, как autoMotion дошёл до нуля: на каждом кадре — обход
   * ScrollTrigger.getAll(), сортировка опорных точек и timeScale на всех
   * колонках ради ленты, которая стоит.
   */
  test('лента отписывает покадровую отрисовку, когда дрейф встал', () => {
    const src = read('components/landing/GameRibbon.tsx')
    const factor = src.match(/const (\w+) = autoMotion\(/)?.[1]
    expect(factor).toBeTruthy()
    expect(src, 'paint() не снимает себя с тикера на нуле').toMatch(
      new RegExp(`if \\(${factor} === 0\\) gsap\\.ticker\\.remove\\(paint\\)`),
    )
    const onScroll = src.match(/const onScroll = \(\) => \{([\s\S]*?)\n {6}\}/)?.[1] ?? ''
    expect(onScroll, 'прокрутка обязана будить дрейф и снова подписывать paint').toMatch(
      /gsap\.ticker\.add\(paint\)/,
    )
    expect(onScroll).toMatch(/wokeAt = performance\.now\(\)/)
    expect(src, 'без покадрового цикла новые границы сцен после refresh приходят только с прокруткой').toMatch(
      /ScrollTrigger\.addEventListener\('refresh', paint\)/,
    )
    expect(src).toMatch(/ScrollTrigger\.removeEventListener\('refresh', paint\)/)
  })

  test('снег копит время шейдера с множителем autoMotion', () => {
    const src = read('components/PixelSnow.tsx')
    expect(src).toMatch(/\bautoMotion\(/)
    // Ровно та запись, с которой снег шёл без конца: время шейдера = время с монтирования
    expect(src).not.toMatch(/uTime\.value\s*=\s*\(?\s*performance\.now\(\)/)
  })
})

/**
 * Разбор globals.css до правил: селектор, объявления, стек @-блоков над ним и
 * строка. Регулярка по одному правилу здесь не годится — вопрос о ПОРЯДКЕ
 * правил и о том, в каком @media и @layer каждое стоит.
 *
 * Строки и скобки учитываются: в файле есть data:-ссылка с «;» внутри.
 * Вложенные правила (&:hover) разбираются как отдельные со своим
 * селектором — с внешними они не совпадут и ничего не перебьют.
 */
type CssRule = { selectors: string[]; decls: Array<[string, string]>; at: string[]; line: number }

function cssRules(css: string): CssRule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const out: CssRule[] = []
  const stack: Array<{ prelude: string; rule?: CssRule }> = []
  let buf = ''
  let bufAt = 0
  let quote = ''
  let paren = 0
  const decl = (rule: CssRule | undefined, text: string) => {
    if (!rule) return
    const at = text.indexOf(':')
    if (at === -1) return
    rule.decls.push([text.slice(0, at).trim(), text.slice(at + 1).trim()])
  }
  const lineOf = (i: number) => src.slice(0, i).split('\n').length
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (!buf.trim()) bufAt = i
    if (quote) {
      buf += ch
      if (ch === '\\') buf += src[++i] ?? ''
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      buf += ch
    } else if (ch === '(') {
      paren++
      buf += ch
    } else if (ch === ')') {
      paren--
      buf += ch
    } else if (paren > 0) {
      buf += ch
    } else if (ch === '{') {
      const prelude = buf.trim()
      buf = ''
      if (prelude.startsWith('@')) {
        stack.push({ prelude })
      } else {
        const rule: CssRule = {
          selectors: splitSelectors(prelude),
          decls: [],
          at: stack.filter((s) => !s.rule).map((s) => s.prelude),
          line: lineOf(bufAt),
        }
        out.push(rule)
        stack.push({ prelude, rule })
      }
    } else if (ch === ';') {
      decl(stack[stack.length - 1]?.rule, buf)
      buf = ''
    } else if (ch === '}') {
      const top = stack.pop()
      if (buf.trim()) decl(top?.rule, buf)
      buf = ''
    } else {
      buf += ch
    }
  }
  return out
}

/** Список селекторов по запятым верхнего уровня: в :is() и :not() свои. */
function splitSelectors(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of list) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  return parts.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

const REDUCE = /prefers-reduced-motion:\s*reduce/
const NO_PREFERENCE = /prefers-reduced-motion:\s*no-preference/

/**
 * Приведённое движение не перебито базовым правилом ниже по файлу.
 *
 * @media не добавляет специфичности. Правило «уменьшить движение» с тем же
 * селектором, что и базовое, побеждает, только если стоит ПОСЛЕ него, — и
 * общий блок отключений в середине файла молча проигрывал базовым правилам,
 * которые дописали ниже. Замер на /quiz с «уменьшить движение»: у
 * .anim-page-in анимация page-in 0.18s, у .anim-breathe — breathe 12s
 * infinite, тогда как соседи по тому же списку (.anim-rise) честно стояли.
 * То есть каждый переход между страницами всё равно въезжал, а фон комнаты
 * дышал по кругу у человека, который просил движения не показывать.
 *
 * Сторож смотрит только на совпадающий селектор в том же слое. Перебить
 * отключение более точным селектором — отдельная история, её сторож ниже.
 */
describe('«уменьшить движение» не перебито правилом ниже', () => {
  const rules = cssRules(CSS)
  const layerOf = (r: CssRule) => r.at.find((a) => a.startsWith('@layer')) ?? ''
  /** Свойство перебивает другое, если это оно же, его сокращение или его часть. */
  const overrides = (a: string, b: string) => a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`)

  test('разбор видит блоки reduce и базовые правила', () => {
    expect(rules.filter((r) => r.at.some((a) => REDUCE.test(a))).length).toBeGreaterThan(10)
    expect(rules.some((r) => r.selectors.includes('.anim-rise'))).toBe(true)
  })

  test('ни одно объявление из reduce не переписано позже тем же селектором', () => {
    const offenders: string[] = []
    rules.forEach((r, i) => {
      if (!r.at.some((a) => REDUCE.test(a))) return
      for (const later of rules.slice(i + 1)) {
        if (later.at.some((a) => REDUCE.test(a) || NO_PREFERENCE.test(a))) continue
        if (layerOf(later) !== layerOf(r)) continue
        for (const sel of r.selectors) {
          if (!later.selectors.includes(sel)) continue
          for (const [prop, value] of r.decls) {
            if (/!important/.test(value)) continue
            const hit = later.decls.find(([p]) => overrides(p, prop))
            if (hit) offenders.push(`${sel} { ${prop} } стр. ${r.line} перебито стр. ${later.line}: ${hit[0]}: ${hit[1]}`)
          }
        }
      }
    })
    expect(
      offenders,
      'правило reduce стоит выше базового с тем же селектором и проигрывает ему — перенеси отключение под базовое правило',
    ).toEqual([])
  })
})

/** Код без комментариев: докблоки рассказывают, почему чего-то здесь нет */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '')

/** Все .tsx из app/ и components/ — путь от корня и код без комментариев */
function uiFiles(): Array<{ rel: string; src: string }> {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) return walk(full)
      return /\.tsx$/.test(e.name) ? [full] : []
    })
  return [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))].map((file) => ({
    rel: path.relative(ROOT, file).split(path.sep).join('/'),
    src: stripComments(fs.readFileSync(file, 'utf8')),
  }))
}

/**
 * cubic-bezier(x1, y1, x2, y2) как функция y(x), как её считает браузер: x(t)
 * у допустимой кривой монотонна, и t ищется делением пополам.
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const at = (a: number, b: number, t: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t
  return (x) => {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      if (at(x1, x2, mid) < x) lo = mid
      else hi = mid
    }
    return at(y1, y2, (lo + hi) / 2)
  }
}

/** Имена всех @keyframes файла: по ним в сокращении animation видно имя */
function keyframeNames(css: string): Set<string> {
  return new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]))
}

/** Анимации в сокращении: по одной на запятую верхнего уровня */
function animationLayers(value: string): string[] {
  return splitSelectors(value.replace(/!important/, ''))
}

/** Время CSS в мс: 2.2s, 420ms */
const toMs = (t: string) => (t.endsWith('ms') ? parseFloat(t) : parseFloat(t) * 1000)
const TIME = /(?<![\w.-])\d*\.?\d+m?s\b/g

/**
 * Сколько идёт анимация правила, мс: задержка плюс длительность на число
 * повторов; Infinity — бесконечная. Функции (cubic-bezier, var) вычёркиваются
 * до разбора — их числа не длительности и не повторы. Из нескольких
 * анимаций через запятую — самая долгая. null — правило не про время.
 */
function animationSpan(decls: Array<[string, string]>): number | null {
  let span: number | null = null
  const take = (v: number) => {
    span = span === null ? v : Math.max(span, v)
  }
  for (const [prop, value] of decls) {
    const v = value.replace(/!important/, '').trim()
    if (prop === 'animation') {
      if (v === 'none') continue
      for (const layer of animationLayers(v)) {
        const bare = layer.replace(/[\w-]+\([^)]*\)/g, ' ')
        const times = bare.match(TIME) ?? []
        const rest = bare.replace(TIME, ' ')
        const count = /\binfinite\b/.test(rest)
          ? Infinity
          : Number(rest.match(/(?<![\w.%-])\d*\.?\d+(?![\w%])/)?.[0] ?? 1)
        take((times[1] ? toMs(times[1]) : 0) + (times[0] ? toMs(times[0]) : 0) * count)
      }
    } else if (prop === 'animation-duration') {
      take(Math.max(...splitSelectors(v).map(toMs)))
    } else if (prop === 'animation-iteration-count') {
      if (/\binfinite\b/.test(v)) take(Infinity)
    }
  }
  return span
}

/**
 * Самоходная анимация в CSS встаёт сама — та же граница AUTO_MOTION, что у
 * ленты и снега, только для globals.css. Сторож выше видел только TS
 * (repeat: -1), а бесконечные и долгие анимации жили в стилях: стена
 * совместимости ехала петлёй на 90 и 110 с за процентом и вердиктом, пока
 * открыта ссылка, стрелка «Что это такое» качалась без конца, кен-бёрнс
 * героя полз двадцать секунд под названием игры.
 *
 * Бесконечное или долгое движение позволено только знакам работы — тому, что
 * живёт, пока идёт загрузка или запрос, и само говорит «подожди». Это
 * исключение самого критерия (preload phase в Understanding 2.2.2), и
 * каждому в списке — своя причина.
 */
describe('самоходная анимация в CSS встаёт сама', () => {
  const TOTAL = AUTO_MOTION.holdMs + AUTO_MOTION.fadeMs
  const ALLOWED: Record<string, string> = {
    '.skel': 'каркас загрузки — страница ещё едет',
    '.btn-ember[data-busy]::after': 'блик кнопки, пока идёт её запрос',
    '.anim-pulse-dot': 'точка статуса «идёт»',
    '.link-pending': 'нажатая ссылка ждёт страницу',
    '.lib-search[data-pending] svg': 'поиск по библиотеке ждёт сервер',
    '.spinner': 'загрузчик',
    '.pwall-row': 'стена ожидания подбора: живёт, пока идёт подбор, и встаёт на is-chosen',
    '.pwall-row:nth-child(2)': 'второй ряд той же стены ожидания',
    '.pwall-row:nth-child(3)': 'третий ряд той же стены ожидания',
    '.anim-breathe':
      'заливка Ambient на экранах ожидания — прогрев, колесо /play, комната в одиночку (BREATHING ниже): ни знака, ни картинки — свет, вдох за 12 с на грани заметности',
  }

  /**
   * Где дыхание по кругу позволено: файл — экран ожидания или содержит его.
   * В app/play/page.tsx это фаза spin, в RoomWaiting — комната в одиночку.
   * /quiz дышал тем же классом молча: фон за вопросами шёл по кругу весь
   * квиз, хотя причина в ALLOWED говорила «экраны ожидания». Там теперь
   * .anim-exhale — один выдох при входе.
   */
  const BREATHING = ['app/[lang]/play/page.tsx', 'components/WarmupScreen.tsx', 'components/room/RoomWaiting.tsx']

  test('разбор времени видит длительность, задержку, повторы и бесконечность', () => {
    expect(animationSpan([['animation', 'kenburns 20s ease-out both']])).toBe(20_000)
    expect(animationSpan([['animation', 'hero-cue-bob 2.2s var(--ease-glow) 2']])).toBeCloseTo(4400)
    expect(animationSpan([['animation', 'chosen-line-in 0.6s var(--ease-out) 0.25s backwards']])).toBe(850)
    expect(animationSpan([['animation', 'pulse-dot 1.6s ease-in-out infinite']])).toBe(Infinity)
    expect(
      animationSpan([
        ['animation', '140ms ease-in both vt-fade reverse, 360ms cubic-bezier(0.22, 1, 0.36, 1) both vt-slide'],
      ]),
    ).toBe(360)
    expect(animationSpan([['animation-duration', '110s']])).toBe(110_000)
    expect(animationSpan([['animation', 'none']])).toBeNull()
  })

  test('бесконечное и дольше AUTO_MOTION — только у знаков работы', () => {
    const offenders = cssRules(CSS)
      .filter((r) => !r.at.some((a) => REDUCE.test(a) || a.startsWith('@keyframes')))
      .flatMap((r) => {
        const span = animationSpan(r.decls)
        if (span === null || span <= TOTAL) return []
        return r.selectors
          .filter((sel) => !(sel in ALLOWED))
          .map((sel) => `${sel} (стр. ${r.line}): ${span === Infinity ? 'бесконечно' : `${span / 1000} с`}`)
      })
    expect(
      offenders,
      `самоходное движение дольше ${TOTAL / 1000} с без паузы — WCAG 2.2.2. Уложи в AUTO_MOTION или, если это знак загрузки, внеси в ALLOWED с причиной`,
    ).toEqual([])
  })

  test('исключения не устарели', () => {
    const selectors = new Set(cssRules(CSS).flatMap((r) => r.selectors))
    for (const sel of Object.keys(ALLOWED)) {
      expect(selectors.has(sel), `${sel} в ALLOWED, но в globals.css его нет`).toBe(true)
    }
  })

  test('дыхание по кругу — только на экранах ожидания', () => {
    const users = uiFiles()
      .filter(({ src }) => /\banim-breathe(?![\w-])/.test(src))
      .map(({ rel }) => rel)
      .sort()
    expect(users, 'фон дышит по кругу там, где читают и отвечают, — возьми .anim-exhale').toEqual(
      [...BREATHING].sort(),
    )
  })

  /**
   * Морф героя /play и /daily — тот же самоходный фон, только в TS. Его
   * «один круг» из трёх кадров по семь секунд был ~27 с движения под
   * названием игры. Переход теперь один: секунда покоя и таяние обязаны
   * уложиться в AUTO_MOTION.
   */
  test('морф героя делает один переход и укладывается в AUTO_MOTION', () => {
    const src = fs
      .readFileSync(path.join(__dirname, '..', 'components', 'HeroShots.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const prop = (name: string) => Number(src.match(new RegExp(`\\b${name}=\\{([\\d.]+)\\}`))?.[1] ?? NaN)
    const delay = prop('autoplayDelay')
    const duration = prop('duration')
    expect(delay).not.toBeNaN()
    expect(duration).not.toBeNaN()
    expect(src, 'после первого перехода автоплей обязан выключиться').toMatch(
      /autoplay=\{[^}]*\bturns < 1\b[^}]*\}/,
    )
    // Меньше секунды слайдер паузу не делает (Math.max(autoplayDelay, 1))
    expect((Math.max(delay, 1) + duration) * 1000).toBeLessThanOrEqual(TOTAL)
  })
})

/**
 * Концы и торможения CSS-движения сверены с самой партитурой, а не со
 * словами в докблоках.
 *
 * Докблоки globals.css обещали больше, чем делали числа: стена совместимости
 * «как у ленты главной» тормозила по прямой (cubic-bezier квадратичного
 * ease-out), которую autoMotion отверг именно за угол скорости; кен-бёрнс
 * «как раньше за 4.5 с» вставал на 1.03, куда старый наезд доходил к 6.9 с;
 * стрелка подсказки отрабатывала свои два качка, пока вход героя держал её
 * невидимой. Каждое обещание здесь — число.
 */
describe('CSS-движение держит партитуру AUTO_MOTION', () => {
  const TOTAL = AUTO_MOTION.holdMs + AUTO_MOTION.fadeMs
  const rules = cssRules(CSS)
  const frames = (name: string) => rules.filter((r) => r.at.includes(`@keyframes ${name}`))
  const decl = (r: CssRule | undefined, prop: string) => r?.decls.find(([p]) => p === prop)?.[1] ?? ''

  test('cubic-bezier считается как в браузере', () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1)
    expect(ease(0)).toBeCloseTo(0, 6)
    expect(ease(1)).toBeCloseTo(1, 6)
    expect(ease(0.5)).toBeCloseTo(0.8024, 3)
    expect(cubicBezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 6)
  })

  /**
   * Путь ленты за торможение — интеграл её множителя скорости, в долях всего
   * пути торможения. Считается численно от самой autoMotion, а не выписанной
   * формулой: поменяют кривую там — разойдётся здесь.
   */
  const STEPS = 2000
  const speed = (k: number) => autoMotion(AUTO_MOTION.holdMs + k * AUTO_MOTION.fadeMs)
  const travelled = Array.from({ length: STEPS + 1 }, () => 0)
  for (let i = 1; i <= STEPS; i++) {
    travelled[i] = travelled[i - 1] + (speed((i - 1) / STEPS) + speed(i / STEPS)) / (2 * STEPS)
  }
  /** Путь торможения в долях того, что прошлось бы за то же время полным ходом */
  const share = travelled[STEPS]

  for (const name of ['cwall-drift-left', 'cwall-drift-right']) {
    test(`${name}: прежний ход, затем торможение ленты главной`, () => {
      const kf = frames(name)
      const at = (sel: string) => kf.find((r) => r.selectors.includes(sel))
      const x = (sel: string) => Number(decl(at(sel), 'transform').match(/translateX\((-?[\d.]+)%?\)/)?.[1] ?? NaN)
      const split = kf.map((r) => r.selectors[0]).find((sel) => sel !== '0%' && sel !== '100%') ?? ''

      // Стык — ровно конец полного хода
      expect(parseFloat(split) / 100).toBeCloseTo(AUTO_MOTION.holdMs / TOTAL, 4)
      expect(decl(at('0%'), 'animation-timing-function')).toBe('linear')

      // Путь торможения — доля share от того, что прошлось бы прежним ходом
      const hold = x(split) - x('0%')
      const brake = x('100%') - x(split)
      expect(brake / hold).toBeCloseTo((share * AUTO_MOTION.fadeMs) / AUTO_MOTION.holdMs, 2)

      const m = decl(at(split), 'animation-timing-function').match(
        /cubic-bezier\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/,
      )
      expect(m, `${name}: у отрезка торможения нет cubic-bezier`).toBeTruthy()
      const [x1, y1, x2, y2] = m!.slice(1).map(Number)
      const curve = cubicBezier(x1, y1, x2, y2)

      // Кривая — путь smoothstep-торможения
      let worst = 0
      for (let i = 0; i <= STEPS; i += 10) worst = Math.max(worst, Math.abs(curve(i / STEPS) - travelled[i] / share))
      expect(worst, 'торможение стены разошлось с autoMotion').toBeLessThan(0.01)
      // Скорость на стыке не прыгает: начальный наклон — прежний ход
      expect(y1 / x1).toBeCloseTo(1 / share, 1)
      // И ускорение на стыке нулевое: P0, P1, P2 на одной прямой
      expect(y2 / x2).toBeCloseTo(y1 / x1, 1)
      // Встаёт, а не обрывается: в конце скорость ноль
      expect(y2).toBe(1)
    })
  }

  test('кен-бёрнс встаёт там, где старый наезд был к концу AUTO_MOTION', () => {
    const run = decl(
      rules.find((r) => r.selectors.includes('.anim-kenburns')),
      'animation',
    )
    expect(animationSpan([['animation', run]])).toBe(TOTAL)
    const to = frames('kenburns').find((r) => r.selectors.includes('to'))
    const end = Number(decl(to, 'transform').match(/scale\(([\d.]+)\)/)?.[1])
    // Прежний: kenburns 20s ease-out до scale(1.06); ease-out — cubic-bezier(0, 0, 0.58, 1)
    const before = 1 + 0.06 * cubicBezier(0, 0, 0.58, 1)(TOTAL / 20_000)
    expect(
      Math.abs(end - before),
      `scale(${end}), а старый наезд к ${TOTAL / 1000} с был на ${before.toFixed(4)}`,
    ).toBeLessThan(0.002)
  })

  test('стрелка подсказки качается с проявления подсказки, а не с первой отрисовки', () => {
    const bob = rules.filter(
      (r) =>
        !r.at.some((a) => REDUCE.test(a)) &&
        r.decls.some(([p, v]) => p === 'animation' && /\bhero-cue-bob\b/.test(v)),
    )
    expect(bob.flatMap((r) => r.selectors)).toEqual(['.hero-cue.is-live .hero-cue-arrow'])
    const hero = stripComments(
      fs.readFileSync(path.join(ROOT, 'components', 'landing', 'scenes', 'Hero.tsx'), 'utf8'),
    )
    // is-live ставит тот же таймлайн входа, что проявляет подсказку на 0.9, — когда она проявилась
    expect(hero).toMatch(
      /\.from\('\[data-hero-cue\]', \{ opacity: 0, duration: DUR\.base[^}]*\}, 0\.9\)\s*\.call\(\(\) => root\.querySelector\('\[data-hero-cue\]'\)\?\.classList\.add\('is-live'\), \[\], 0\.9 \+ DUR\.base\)/,
    )
  })
})

/**
 * Отключение под «уменьшить движение» не перебито более точным селектором.
 *
 * @media специфичности не добавляет, и правило с селектором точнее
 * отключённого выигрывает у отключения свои свойства. .pwall-row:nth-child(2)
 * ставил имя pwall-right и 150 с — и второй ряд стены ожидания под «уменьшить
 * движение» ехал, хотя .pwall-row там честно выключен. У стены
 * совместимости .cwall .pwall-row ставит анимацию целиком. Правило: кто
 * уточняет выключенный селектор и даёт анимации имя, тот выключается под
 * reduce сам, своим селектором.
 */
describe('«уменьшить движение» не перебито селектором точнее', () => {
  const rules = cssRules(CSS)
  const names = keyframeNames(CSS)
  const isReduce = (r: CssRule) => r.at.some((a) => REDUCE.test(a))
  const stops = (r: CssRule) =>
    r.decls.some(([p, v]) => (p === 'animation' || p === 'animation-name') && /^none\b/.test(v.trim()))
  const namesAnimation = (r: CssRule) =>
    r.decls.some(
      ([p, v]) =>
        (p === 'animation-name' && !/^none\b/.test(v.trim())) ||
        (p === 'animation' && animationLayers(v).some((l) => l.split(/\s+/).some((w) => names.has(w)))),
    )
  /** Последний составной селектор уточняет простой: он сам или он плюс :псевдо, .класс, [атрибут] */
  const refines = (sel: string, simple: string) => {
    if (sel === simple || /[\s>+~]/.test(simple)) return false
    const last = sel.split(/\s*[\s>+~]\s*/).pop() ?? ''
    return last === simple || (last.startsWith(simple) && /^[:.[]/.test(last.slice(simple.length)))
  }

  test('уточнение понимает потомка и псевдокласс', () => {
    expect(refines('.cwall .pwall-row', '.pwall-row')).toBe(true)
    expect(refines('.pwall-row:nth-child(2)', '.pwall-row')).toBe(true)
    expect(refines('.pwall-row', '.pwall-row')).toBe(false)
    expect(refines('.pwall-rowx', '.pwall-row')).toBe(false)
    expect(refines('.pwall-row img', '.pwall-row')).toBe(false)
  })

  test('кто уточняет выключенный селектор и даёт анимации имя — выключен сам', () => {
    const stopped = new Set(rules.filter((r) => isReduce(r) && stops(r)).flatMap((r) => r.selectors))
    const offenders = rules
      .filter((r) => !isReduce(r) && !r.at.some((a) => a.startsWith('@keyframes')) && namesAnimation(r))
      .flatMap((r) =>
        r.selectors
          .filter((sel) => !stopped.has(sel))
          .flatMap((sel) =>
            [...stopped]
              .filter((base) => refines(sel, base))
              .map((base) => `${sel} (стр. ${r.line}) перебивает выключенный ${base}`),
          ),
      )
    expect(offenders, 'добавь этот селектор в отключение под reduce рядом с базовым').toEqual([])
  })
})

/**
 * Утилиты animate-* у Tailwind не знают про «уменьшить движение»: в
 * tailwindcss/theme.css у --animate-pulse нет варианта под reduce, а
 * globals.css гасит только свои классы. Скелет тела патча на /whatsnew и в
 * патчах страницы игры пульсировал под «уменьшить движение» — единственный
 * пульсирующий элемент на странице. Свои каркасы — .skel: у него есть и
 * дыхание, и состояние покоя. Если утилита всё же нужна — только с
 * motion-safe:.
 */
describe('анимация из утилит Tailwind не обходит «уменьшить движение»', () => {
  test('animate-* только с motion-safe:', () => {
    // Комментарии гасятся (uiFiles): докблоки рассказывают, почему утилиты здесь нет
    const offenders = uiFiles().flatMap(({ rel, src }) => {
      return [...src.matchAll(/(^|[\s"'`{])([\w:-]*:)?animate-(?:pulse|spin|ping|bounce)\b/g)]
        .filter((m) => !(m[2] ?? '').includes('motion-safe:'))
        .map((m) => `${rel}: ${m[0].trim()}`)
    })
    expect(offenders, 'утилита animate-* идёт и под «уменьшить движение» — возьми .skel или motion-safe:').toEqual([])
  })
})
