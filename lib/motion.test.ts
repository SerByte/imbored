import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { SPARK_LIFE } from '../components/ClickSpark'
import { BLUR_REVEAL, CONFIRM_MS, DUR, EASE, EASE_CSS, OUTRO } from './motion'

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
})

describe('партитура финального такта', () => {
  test('искры умирают до навигации', () => {
    // Ровно тот баг, который это правило закрывает: залп на 450 мс при
    // навигации на 640-й обрывал единственный церемониальный эффект квиза
    // на середине жизни.
    expect(OUTRO.sparkAt + SPARK_LIFE).toBeLessThan(OUTRO.navMs)
  })

  test('все биты таймлайна заканчиваются до навигации', () => {
    const beats = [
      OUTRO.losersAt + OUTRO.losersDur,
      OUTRO.winnerAt + OUTRO.winnerDur,
      OUTRO.captionAt + OUTRO.captionDur,
    ]
    for (const end of beats) expect(end * 1000).toBeLessThan(OUTRO.navMs)
  })
})
