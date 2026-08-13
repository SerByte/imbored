/**
 * Русские окончания по числу: 1 игра, 2 игры, 5 игр.
 *
 * Жил локальной функцией внутри страницы портрета, но понадобился в lib —
 * вынесен как есть, логика не менялась.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
