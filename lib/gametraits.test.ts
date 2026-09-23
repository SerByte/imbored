import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { reviewsBrief } from './gametraits'

/**
 * Строку сессии берут клиентские экраны — герой /play и колода пати, — поэтому
 * модуль обязан оставаться клиентобезопасным: ни базы, ни сервера, ни node:
 * даже через цепочку импортов. Поведение строки проверяет lib/gamepage.test.ts
 * (там её показывает карточка игры); здесь — только то, откуда она может брать.
 */

const LIB = __dirname

/** Модули, которые тянут за собой базу, сервер или сеть */
const SERVER_ONLY = /^(\.\/(db|server|gamepage|pagejob|reviews|catalog|llm)|node:|@libsql\/)/

/** Импорты с рантаймом (не `import type`) — рекурсивно по lib */
function runtimeClosure(file: string, seen = new Set<string>()): Set<string> {
  const src = fs.readFileSync(path.join(LIB, file), 'utf8')
  for (const m of src.matchAll(/^import (?!type )[^\n]*?from '([^']+)'/gm)) {
    const spec = m[1]
    if (seen.has(spec)) continue
    seen.add(spec)
    if (spec.startsWith('./') && !SERVER_ONLY.test(spec)) runtimeClosure(`${spec.slice(2)}.ts`, seen)
  }
  return seen
}

describe('клиентобезопасность', () => {
  test('lib/gametraits.ts не тянет ни базы, ни сервера — даже через цепочку', () => {
    const closure = [...runtimeClosure('gametraits.ts')]
    expect(closure.length).toBeGreaterThan(0)
    expect(closure.filter((spec) => SERVER_ONLY.test(spec))).toEqual([])
  })
})

describe('reviewsBrief', () => {
  test('«92% из 48 тыс.» — коротко, как на плитке', () => {
    expect(reviewsBrief(92, 48_213)?.short).toBe('92% из 48 тыс.')
    expect(reviewsBrief(88.6, 4_812)?.short).toBe('89% из 4,8 тыс.')
    expect(reviewsBrief(90, 1_000)?.short).toBe('90% из 1 тыс.')
    expect(reviewsBrief(75, 480)?.short).toBe('75% из 480')
    expect(reviewsBrief(97, 1_234_567)?.short).toBe('97% из 1,2 млн')
    // на границе тысяч не пишем «1000 тыс.»
    expect(reviewsBrief(97, 999_700)?.short).toBe('97% из 1 млн')
  })

  test('полная фраза — точным числом и со склонением, как у кольца /game', () => {
    const full = (total: number) => reviewsBrief(92, total)?.full ?? ''
    expect(full(48_213)).toMatch(/^92% из 48\s213 отзывов — положительные$/)
    expect(full(21)).toBe('92% из 21 отзыва — положительные')
    expect(full(33)).toBe('92% из 33 отзывов — положительные')
  })

  test('без отзывов или с битыми числами — молчим', () => {
    expect(reviewsBrief(undefined, 100)).toBeNull()
    expect(reviewsBrief(90, null)).toBeNull()
    expect(reviewsBrief(90, 0)).toBeNull()
    expect(reviewsBrief(Number.NaN, 100)).toBeNull()
    expect(reviewsBrief(140, 100)?.short).toBe('100% из 100')
  })
})
