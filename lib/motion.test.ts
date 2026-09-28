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

const CSS = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8')

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
  const ROOT = path.join(__dirname, '..')

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

  test('снег копит время шейдера с множителем autoMotion', () => {
    const src = read('components/PixelSnow.tsx')
    expect(src).toMatch(/\bautoMotion\(/)
    // Ровно та запись, с которой снег шёл без конца: время шейдера = время с монтирования
    expect(src).not.toMatch(/uTime\.value\s*=\s*\(?\s*performance\.now\(\)/)
  })
})
