import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { languageTrait, lengthTrait, reviewsBrief, ruLangLine } from './gametraits'
import type { GameSemantics } from './types'

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

describe('русский язык', () => {
  test('одной фразой — самое сильное, что назвал Steam', () => {
    expect(ruLangLine(3)).toBe('русская озвучка')
    expect(ruLangLine(2)).toBe('русские субтитры')
    expect(ruLangLine(1)).toBe('русский интерфейс')
    expect(ruLangLine(0)).toBe('без русского')
  })

  test('не знаем — молчим: «без русского» по пустоте было бы выдумкой', () => {
    // Язык привозят крон карточек и доливка медиа, прогрев его не просит —
    // до их прохода у большинства игр поля нет, и это не «нет русского»
    expect(ruLangLine(undefined)).toBeNull()
    expect(ruLangLine(null)).toBeNull()
    expect(languageTrait({})).toBeNull()
  })

  test('строка карточки называет источник: это заявление издателя в Steam', () => {
    expect(languageTrait({ ruLang: 3 })).toEqual({ label: 'Русский', value: 'полная озвучка — по данным Steam' })
    expect(languageTrait({ ruLang: 2 })).toEqual({ label: 'Русский', value: 'субтитры — по данным Steam' })
    expect(languageTrait({ ruLang: 1 })).toEqual({ label: 'Русский', value: 'интерфейс — по данным Steam' })
    expect(languageTrait({ ruLang: 0 })).toEqual({ label: 'Русский', value: 'нет — по данным Steam' })
  })
})

describe('«Наиграли»', () => {
  /** Семантика по отзывам, где хвалившие наиграли medianMin минут (медиана) */
  const sem = (medianMin: number | null): GameSemantics => ({
    v: 1,
    axes: { challenge: 50, complexity: 50, pace: 50 },
    session: { bucket: 'medium', minutes: 40, canStopAnytime: false },
    timeToFun: { bucket: null, hours: null },
    confidence: 0.8,
    n: 80,
    basis: 'tags+reviews',
    ...(medianMin === null ? {} : { played: { posMedianMin: medianMin, posN: 60 } }),
  })
  const words = (min: number) => lengthTrait({ semantics: sem(min) }, { replayable: false })?.value

  test('называет, чьё это время: тех, кто её хвалит, а не всех', () => {
    // выборка — самые полезные отзывы, и хвалившие наигрывают больше среднего:
    // «обычно столько играют» было бы неправдой
    expect(lengthTrait({ semantics: sem(8 * 60) }, { replayable: false })).toEqual({
      label: 'Наиграли',
      value: '~8 ч — те, кто её хвалит',
    })
  })

  test('ступенями в полтора-два раза, а не числом до часа', () => {
    expect(words(20)).toBe('меньше часа — те, кто её хвалит')
    expect(words(59)).toBe('меньше часа — те, кто её хвалит')
    expect(words(60)).toBe('~1 ч — те, кто её хвалит')
    expect(words(89)).toBe('~1 ч — те, кто её хвалит')
    expect(words(90)).toBe('~2 ч — те, кто её хвалит')
    expect(words(3 * 60)).toBe('~3 ч — те, кто её хвалит')
    expect(words(4 * 60)).toBe('~5 ч — те, кто её хвалит')
    expect(words(7 * 60)).toBe('~8 ч — те, кто её хвалит')
    // 9 ч 50 мин — ещё «~8», ровно 10 — уже «~12»
    expect(words(590)).toBe('~8 ч — те, кто её хвалит')
    expect(words(600)).toBe('~12 ч — те, кто её хвалит')
    expect(words(20 * 60)).toBe('~20 ч — те, кто её хвалит')
    expect(words(30 * 60)).toBe('~30 ч — те, кто её хвалит')
    expect(words(39 * 60)).toBe('~30 ч — те, кто её хвалит')
    // сверху — честная открытая граница, а не «~30» у игры на сотню часов
    expect(words(40 * 60)).toBe('от 40 ч — те, кто её хвалит')
    expect(words(300 * 60)).toBe('от 40 ч — те, кто её хвалит')
  })

  test('у игры без финала молчит: сотни часов в песочнице не отвечают «потяну ли»', () => {
    expect(lengthTrait({ semantics: sem(300 * 60) }, { replayable: true })).toBeNull()
  })

  test('не знаем — молчим', () => {
    // до прохода крона карточек наигранного нет у большинства игр
    expect(lengthTrait({}, { replayable: false })).toBeNull()
    expect(lengthTrait({ semantics: sem(null) }, { replayable: false })).toBeNull()
  })
})
