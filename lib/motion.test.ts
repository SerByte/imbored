import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { SPARK_LIFE } from '../components/ClickSpark'
import {
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
  RELIGHT,
  TITLE,
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

  test('--dur-relight совпадает с DUR.relight', () => {
    expect(cssToken('--dur-relight')).toBe(`${DUR.relight * 1000}ms`)
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

describe('перекраска комнаты и титульная карточка', () => {
  test('провал диммера достигает пика ровно в момент подмены DOM', () => {
    // AnimatePresence mode="wait" меняет детей через exit, а он идёт --dur-fast.
    // Пик темноты обязан совпасть с этим кадром — там закапывается склейка.
    expect(RELIGHT.dipInDur).toBe(DUR.fast)
  })

  test('провал заканчивается раньше, чем устаканится вход', () => {
    expect((RELIGHT.dipAt + RELIGHT.dipInDur + RELIGHT.dipOutDur) * 1000).toBeLessThan(
      (DUR.fast + DUR.base) * 1000,
    )
  })

  test('перекраска не удлиняет взаимодействие', () => {
    // Она ложится ПОВЕРХ существующей сериализации exit→enter, а не после неё.
    // Стоит перекраске стать длиннее навигации финала — и квиз начнёт ждать.
    expect(DUR.relight * 1000).toBeLessThan(OUTRO.navMs)
  })

  test('все такты карточки заканчиваются до размонтирования', () => {
    const beats = [
      TITLE.strikeAt + TITLE.strikeDur,
      TITLE.flareAt + TITLE.flareDur,
      // последняя створка стартует позже всех на два шага стаггера
      TITLE.openAt + TITLE.openDur + TITLE.openStagger * 2,
    ]
    for (const end of beats) expect(end * 1000).toBeLessThanOrEqual(TITLE.unmountMs)
  })

  test('жёсткий бэкстоп срабатывает позже штатного размонтирования', () => {
    // Иначе страховка гасила бы карточку раньше, чем она доиграет.
    expect(TITLE.unmountMs).toBeLessThan(TITLE.hardMs)
  })

  test('чёрный держится дольше кадра, но короче розжига', () => {
    expect(TITLE.blackMs).toBeGreaterThan(16)
    expect(TITLE.blackMs).toBeLessThanOrEqual(TITLE.strikeAt * 1000)
  })
})
