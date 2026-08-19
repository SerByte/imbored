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

/**
 * Дата события словами, В ЗОНЕ UTC.
 *
 * Зона зафиксирована, и это чинит расхождение гидратации, а не вкусовщину.
 *
 * toLocaleDateString без timeZone берёт зону процесса. На сервере Vercel это
 * UTC, в браузере — зона читателя, и для всего, что опубликовано после
 * 21:00 UTC, стороны печатают РАЗНЫЕ дни. Замер на живой /game/730: из шести
 * элементов <time> четыре расходятся у московского читателя («12 августа» на
 * сервере против «13 августа» в браузере).
 *
 * Это не гонка, а константа: страница кэшируется на сутки, разметка одна и
 * та же для всех. React на расхождении разматывает поддерево до ближайшей
 * границы Suspense — а она у этих страниц route-level (app/loading.tsx), —
 * то есть выбрасывает и перерисовывает всё тело страницы, не одну подпись.
 *
 * Почему именно UTC, а не зона читателя: дата выхода патча — это про
 * событие, а не про то, где стоит смотрящий. Показывать её в местной зоне
 * можно только дорисовкой после монтирования, то есть мигнув. Тот же выбор
 * уже сделан у dayLabel выше.
 */
export function dateLabel(atSec: number, opts: { year?: boolean } = {}): string {
  return new Date(atSec * 1000).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(opts.year ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  })
}

/**
 * Давность в минутах — словами. Для доски пати, где счёт идёт на минуты и
 * часы, а не на дни: freshness() выше начинается с суток и всё, что моложе,
 * называет «сегодня».
 *
 * Часы обязательны. Комната живёт на доске до суток (PUBLIC_ROOM_MAX_AGE_SEC),
 * а подпись собиралась как `${minutes} мин назад` — то есть комната
 * двадцатитрёхчасовой давности честно писала «1380 мин назад».
 */
export function minutesAgoLabel(minutes: number): string {
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const h = Math.floor(minutes / 60)
  if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`
  const d = Math.floor(h / 24)
  return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`
}

/**
 * Подпись даты «19 августа» из ключа суток вида 2026-08-19.
 *
 * Именно ИЗ КЛЮЧА, а не из второго вызова new Date(), и это не педантизм.
 *
 * В app/api/daily ключ записи считался в UTC в начале обработки, а подпись —
 * отдельным new Date() в самом конце, уже после отбора. Отбор стоит около
 * полутора секунд (см. докблок там же), то есть запрос, начавшийся в
 * 23:59:59, дорисовывал подпись уже следующими сутками: «игра дня 20
 * августа» под выбором, записанным на 19-е.
 *
 * Вторая причина — зона. toLocaleDateString без timeZone берёт зону
 * рантайма. На Vercel это UTC, и сегодня всё сходится, но зависимость
 * подразумеваемая: достаточно кому-нибудь задать TZ, и подпись разъедется с
 * ключом навсегда, а не только на границе суток.
 */
export function dayLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
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
