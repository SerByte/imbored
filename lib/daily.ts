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
function mulberry32(seed: number): () => number {
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
