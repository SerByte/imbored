/**
 * Форматирование подписей ленты «Что нового».
 *
 * Чистые функции без React: их зовут и серверные строки, и клиентские островки.
 */

/**
 * freshness переехала в lib/freshness — там она стоит рядом с расчётом момента,
 * когда подпись меняется, и попадает под vitest (он собирает только lib/).
 * Здесь остаётся ре-экспорт, чтобы места вызова не переписывать.
 */
export { freshness } from '@/lib/freshness'

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
