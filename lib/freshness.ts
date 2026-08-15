import { plural } from './plural'

const DAY = 86_400

/**
 * Свежесть словами. В ленте это несёт больше смысла, чем полная дата: человек
 * листает сверху вниз и хочет понять «это вчера или полгода назад», а не
 * вычитать числа в уме. Точная дата остаётся рядом, в <time>.
 *
 * Живёт в lib/, а не рядом с разметкой, вместе с nextFreshnessTickMs: эти две
 * функции обязаны одинаково понимать, где проходит граница суток. Разъедься
 * они — и вкладка просыпалась бы не в тот момент, когда подпись меняется.
 * Плюс vitest собирает только lib/, а до переезда на freshness не было ни
 * одного теста.
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

/** Запись из будущего (кривая дата в фиде) не должна давать нулевую задержку */
const MIN_TICK_MS = 1_000

/**
 * Ноутбук, проспавший границу суток, таймером не разбудить: setTimeout в
 * suspend не тикает. Потолок гарантирует, что подпись всё равно пересчитается
 * в обозримое время, а не через неделю.
 */
const MAX_TICK_MS = 6 * 3_600_000

/**
 * Через сколько миллисекунд подпись свежести может смениться.
 *
 * freshness() считает сутки ОТ publishedAt, а не от полуночи, поэтому граница
 * у каждой записи своя: publishedAt + (days + 1) * DAY. Берём ближайшую по
 * всей ленте и просыпаемся ровно на ней.
 *
 * Тикать ежеминутно было бы проще и заметно хуже: подпись меняется раз в
 * сутки, а перерисовка тридцати строк заставляет каждую заново пересчитать
 * число правок по всему телу патча — 1440 раз в день впустую.
 */
export function nextFreshnessTickMs(publishedAts: readonly number[], nowSec: number): number {
  let soonest = Number.POSITIVE_INFINITY
  for (const at of publishedAts) {
    const days = Math.floor((nowSec - at) / DAY)
    const boundary = at + (days + 1) * DAY
    const left = (boundary - nowSec) * 1000
    if (left < soonest) soonest = left
  }
  if (!Number.isFinite(soonest)) return MAX_TICK_MS
  return Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, soonest))
}
