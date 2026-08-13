/**
 * Форматирование подписей ленты «Что нового».
 *
 * Чистые функции без React: их зовут и серверные строки, и клиентские островки.
 */

const DAY = 86_400

/**
 * Свежесть словами. В ленте это несёт больше смысла, чем полная дата: человек
 * листает сверху вниз и хочет понять «это вчера или полгода назад», а не
 * вычитать числа в уме. Точная дата остаётся рядом, в <time>.
 */
export function freshness(publishedAt: number, nowSec: number): string {
  const days = Math.floor((nowSec - publishedAt) / DAY)
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`
  if (days < 31) {
    const w = Math.floor(days / 7)
    return `${w} ${plural(w, 'неделю', 'недели', 'недель')} назад`
  }
  const m = Math.floor(days / 30)
  if (m < 12) return `${m} ${plural(m, 'месяц', 'месяца', 'месяцев')} назад`
  const y = Math.floor(days / 365)
  return `${y} ${plural(y, 'год', 'года', 'лет')} назад`
}

/** «31 правка» / «3 правки» / «12 правок» */
export function changesLabel(n: number): string {
  return `${n.toLocaleString('ru-RU')} ${plural(n, 'правка', 'правки', 'правок')}`
}

/**
 * Русское склонение по числу. Без него подписи выглядят машинно: «1 правок»
 * читается как баг, а не как цифра.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return many
  if (last > 1 && last < 5) return few
  if (last === 1) return one
  return many
}

/** Подпись студии: «Valve · 2013». Любая половина может отсутствовать. */
export function byline(developer?: string, releaseYear?: number): string | null {
  const parts = [developer, releaseYear ? String(releaseYear) : undefined].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}
