import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  characterTrait,
  entryTrait,
  languageTrait,
  lengthTrait,
  reviewsBrief,
  reviewsLine,
  ruLangLine,
  sessionPhrase,
  sessionTrait,
  steamScoreLabel,
  type GameTrait,
} from './gametraits'
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
  const words = (min: number) => lengthTrait({ semantics: sem(min) }, { endless: false })?.value

  test('называет, чьё это время: тех, кто её хвалит, а не всех', () => {
    // выборка — самые полезные отзывы, и хвалившие наигрывают больше среднего:
    // «обычно столько играют» было бы неправдой
    expect(lengthTrait({ semantics: sem(8 * 60) }, { endless: false })).toEqual({
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
    expect(lengthTrait({ semantics: sem(300 * 60) }, { endless: true })).toBeNull()
  })

  test('не знаем — молчим', () => {
    // до прохода крона карточек наигранного нет у большинства игр
    expect(lengthTrait({}, { endless: false })).toBeNull()
    expect(lengthTrait({ semantics: sem(null) }, { endless: false })).toBeNull()
  })
})

/** Ни одной русской буквы: английская строка не должна протекать русским словом */
const CYRILLIC = /[А-Яа-яЁё]/

describe('английская версия', () => {
  /** Уверенная семантика: заход minutes, оси и время до веселья — по выбору */
  const sem = (over: Partial<GameSemantics> & { minutes?: number } = {}): GameSemantics => {
    const { minutes = 40, ...rest } = over
    return {
      v: 1,
      axes: { challenge: 50, complexity: 50, pace: 50 },
      session: { bucket: minutes >= 75 ? 'long' : minutes <= 25 ? 'short' : 'medium', minutes, canStopAnytime: false },
      timeToFun: { bucket: null, hours: null },
      confidence: 0.8,
      n: 80,
      basis: 'tags+reviews',
      ...rest,
    }
  }
  const SOLO = [2]
  const ONLINE_ONLY = [1, 49]

  test('сессия: Session / Match, минуты по-английски', () => {
    const value = (minutes: number) => sessionTrait({ categories: SOLO, semantics: sem({ minutes }) }, 'en')
    expect(value(10)).toEqual({ label: 'Session', value: '~20 min' })
    expect(value(40)?.value).toBe('~40 min')
    expect(value(90)?.value).toBe('~1.5 h')
    expect(value(160)?.value).toBe('all evening')
    expect(sessionTrait({ categories: ONLINE_ONLY, semantics: sem({ minutes: 45 }) }, 'en')).toEqual({
      label: 'Match',
      value: '~45 min',
    })
  })

  test('без языка — русская строка, как была', () => {
    expect(sessionTrait({ categories: SOLO, semantics: sem({ minutes: 160 }) })).toEqual({
      label: 'Сессия',
      value: 'на вечер',
    })
  })

  test('фраза сессии: по-русски — та же склейка, по-английски — целиком', () => {
    const trait = (minutes: number, categories: number[], locale: 'ru' | 'en') =>
      sessionTrait({ categories, semantics: sem({ minutes }) }, locale) as GameTrait
    // русская — ровно то, что экраны склеивали сами: label.toLowerCase() + value
    expect(sessionPhrase(trait(20, SOLO, 'ru'))).toBe('сессия ~20 мин')
    expect(sessionPhrase(trait(160, SOLO, 'ru'), 'ru')).toBe('сессия на вечер')
    expect(sessionPhrase(trait(45, ONLINE_ONLY, 'ru'))).toBe('матч ~45 мин')
    // английская — не «session all evening»
    expect(sessionPhrase(trait(20, SOLO, 'en'), 'en')).toBe('~20 min sessions')
    expect(sessionPhrase(trait(90, SOLO, 'en'), 'en')).toBe('~1.5 h sessions')
    expect(sessionPhrase(trait(160, SOLO, 'en'), 'en')).toBe('all-evening sessions')
    expect(sessionPhrase(trait(45, ONLINE_ONLY, 'en'), 'en')).toBe('~45 min matches')
  })

  test('вход: Ramp-up, «per reviews», час и часы', () => {
    expect(entryTrait({ tags: {}, semantics: sem({ timeToFun: { bucket: 'fast', hours: 0.3 } }) }, 'en')).toEqual({
      label: 'Ramp-up',
      value: 'hooks you from the first minutes — per reviews',
    })
    expect(entryTrait({ tags: {}, semantics: sem({ timeToFun: { bucket: 'slow', hours: 3.4 } }) }, 'en')?.value).toBe(
      'takes 3 hours to click — per reviews',
    )
    expect(entryTrait({ tags: {}, semantics: sem({ timeToFun: { bucket: 'slow', hours: 1.2 } }) }, 'en')?.value).toBe(
      'takes 1 hour to click — per reviews',
    )
  })

  test('наиграли: Playtime — чьё это время, фразой', () => {
    const played = (min: number) =>
      lengthTrait({ semantics: sem({ played: { posMedianMin: min, posN: 60 } }) }, { endless: false }, 'en')
    expect(played(8 * 60)).toEqual({ label: 'Playtime', value: '~8 h among players who recommend it' })
    expect(played(20)?.value).toBe('under an hour among players who recommend it')
    expect(played(300 * 60)?.value).toBe('40+ h among players who recommend it')
  })

  test('характер: Feel — те же слова, что у «под настроение»', () => {
    expect(characterTrait({ semantics: sem({ axes: { challenge: 20, complexity: 60, pace: 30 } }) }, 'en')).toEqual({
      label: 'Feel',
      value: 'calm, unhurried',
    })
    expect(characterTrait({ semantics: sem({ axes: { challenge: 90, complexity: 80, pace: 70 } }) }, 'en')?.value).toBe(
      'challenging, plenty to master',
    )
    // равная выраженность — порядок осей в таблице: темп раньше освоения, как по-русски
    expect(characterTrait({ semantics: sem({ axes: { challenge: 50, complexity: 10, pace: 90 } }) }, 'en')?.value).toBe(
      'fast-paced, easy to pick up',
    )
  })

  test('русский язык игры на английской версии не называется', () => {
    for (const ru of [0, 1, 2, 3] as const) {
      expect(ruLangLine(ru, 'en')).toBeNull()
      expect(languageTrait({ ruLang: ru }, 'en')).toBeNull()
      // без языка — как было
      expect(ruLangLine(ru)).not.toBeNull()
    }
  })

  test('отзывы: «92% of 48K» и полная фраза', () => {
    expect(reviewsBrief(92, 48_213, 'en')).toEqual({ short: '92% of 48K', full: '92% of 48,213 reviews are positive' })
    expect(reviewsBrief(88.6, 4_812, 'en')?.short).toBe('89% of 4.8K')
    expect(reviewsBrief(90, 1_000, 'en')?.short).toBe('90% of 1K')
    expect(reviewsBrief(75, 480, 'en')?.short).toBe('75% of 480')
    expect(reviewsBrief(97, 1_234_567, 'en')?.short).toBe('97% of 1.2M')
    expect(reviewsBrief(97, 999_700, 'en')?.short).toBe('97% of 1M')
    expect(reviewsBrief(100, 1, 'en')?.full).toBe('100% of 1 review is positive')
    expect(reviewsBrief(undefined, 100, 'en')).toBeNull()
  })

  test('полная фраза отзывов — одна на карточку и плитку', () => {
    expect(reviewsLine(92, 48_213)).toMatch(/^92% из 48\s213 отзывов — положительные$/)
    expect(reviewsLine(92, 21)).toBe(reviewsBrief(92, 21)?.full)
    expect(reviewsLine(92, 48_213, 'en')).toBe('92% of 48,213 reviews are positive')
  })

  test('ярлык Steam: по-русски — русский магазин, по-английски — как есть', () => {
    expect(steamScoreLabel('Very Positive')).toBe('Очень положительные')
    expect(steamScoreLabel('Overwhelmingly Negative', 'ru')).toBe('Крайне отрицательные')
    expect(steamScoreLabel('Very Positive', 'en')).toBe('Very Positive')
    expect(steamScoreLabel('Brand New Label')).toBe('Brand New Label')
    expect(steamScoreLabel('constructor')).toBe('constructor')
  })

  test('ни в одной английской строке нет кириллицы', () => {
    const s = sem({
      minutes: 160,
      axes: { challenge: 10, complexity: 90, pace: 15 },
      timeToFun: { bucket: 'slow', hours: 5 },
      played: { posMedianMin: 12 * 60, posN: 50 },
    })
    const out = [
      sessionTrait({ categories: SOLO, semantics: s }, 'en'),
      sessionTrait({ categories: ONLINE_ONLY, semantics: sem({ minutes: 30 }) }, 'en'),
      entryTrait({ tags: {}, semantics: s }, 'en'),
      lengthTrait({ semantics: s }, { endless: false }, 'en'),
      characterTrait({ semantics: s }, 'en'),
      reviewsBrief(81, 12_345, 'en'),
    ]
    for (const o of out) {
      expect(o).not.toBeNull()
      expect(JSON.stringify(o)).not.toMatch(CYRILLIC)
    }
    expect(sessionPhrase(out[0] as GameTrait, 'en')).not.toMatch(CYRILLIC)
  })
})
