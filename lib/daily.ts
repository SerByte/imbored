import type { ScoredCandidate } from './types'

/** FNV-1a — стабильный хеш строки в uint32 */
export function hashString(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 — детерминированный ГПСЧ */
export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * «Игра дня»: детерминированный взвешенный выбор — один и тот же весь день
 * для конкретного пользователя, завтра другой. Верхние кандидаты весят больше.
 */
export function pickDaily(candidates: ScoredCandidate[], seed: string): ScoredCandidate | null {
  if (!candidates.length) return null
  const rng = mulberry32(hashString(seed))
  const weights = candidates.map((_, i) => candidates.length - i)
  const total = weights.reduce((s, w) => s + w, 0)
  let r = rng() * total
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]
    if (r <= 0) return candidates[i]
  }
  return candidates[0]
}

/**
 * Чьи сутки у «Игры дня».
 *
 * Сутки считались по UTC (toISOString), и игра менялась в 03:00 по Москве —
 * посреди ночной сессии, а с полуночи до трёх подпись показывала вчерашнее
 * число. Аудитория русскоязычная, и полночь продукта — московская.
 *
 * Пояс клиента сюда не берётся сознательно: запись дня (daily_picks) и сид
 * отбора ключуются этой датой, и у одного человека с двух устройств в разных
 * поясах «сегодня» разошлось бы на две разные игры. Граница одна на всех.
 */
export const DAILY_TZ = 'Europe/Moscow'

const DAY_FORMATS = new Map<string, Intl.DateTimeFormat>()

/**
 * Ключ суток вида 2026-09-24 в поясе tz.
 *
 * Один ключ на всё, что зовётся «сегодня» у игры дня: сид отбора, запись в
 * daily_picks, подпись даты (dayLabel в lib/freshness строит её из ключа) и
 * уборка вчерашних записей в кроне.
 *
 * Дата собирается по частям (formatToParts), а не строкой формата en-CA:
 * вид «ГГГГ-ММ-ДД» у en-CA — договорённость данных ICU, а не стандарт, и
 * от неё зависел бы первичный ключ таблицы.
 *
 * Не путать с dayKey из lib/forgotten: тот — сид полки «запечатанного» в
 * /library и считается по UTC.
 */
export function dayKey(nowSec: number, tz: string = DAILY_TZ): string {
  let fmt = DAY_FORMATS.get(tz)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    DAY_FORMATS.set(tz, fmt)
  }
  const parts = fmt.formatToParts(new Date(nowSec * 1000))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Каждый какой день герой — игра из магазина, а не из библиотеки */
export const STORE_DAY_EVERY = 3

/**
 * Из какого пула берём героя дня.
 *
 * «Игра дня» задумывалась как разбор своего бэклога, и витрина магазина не
 * должна его вытеснять: магазинный день — каждый третий, остальные два свои.
 * Отдельный хеш, а не тот же, что у pickDaily: общий сид дал бы корреляцию
 * между «сегодня магазинный день» и «какая именно игра», а это две независимые
 * лотереи.
 *
 * Если одна из сторон пуста, берём вторую: пустой экран хуже неудачной
 * рекомендации — то же правило, что у фильтров актуальности.
 */
export function pickDailyPool<T>(own: T[], discovery: T[], seed: string): T[] {
  if (!discovery.length) return own
  if (!own.length) return discovery
  return hashString(`${seed}:store`) % STORE_DAY_EVERY === 0 ? discovery : own
}

/**
 * Что из кандидата уходит клиенту: кто он и откуда. Скор и его части — это
 * ранжирование, и живут они только на сервере: по части cooldown видно, что
 * человек откладывал и что ему надоело. /api/recommend получает это даром —
 * Pick из llm.ts частей не несёт, — а здесь герой и есть сам кандидат, и
 * спред отдал бы всё.
 */
export function publicPick(c: ScoredCandidate): Pick<ScoredCandidate, 'appid' | 'name' | 'source'> {
  return { appid: c.appid, name: c.name, source: c.source }
}
