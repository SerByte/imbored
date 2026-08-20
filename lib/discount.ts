import { plural } from './plural'
import type { GameMeta } from './types'

/**
 * Скидка на игру: решение «показывать или нет» и то, как она выглядит.
 *
 * Модуль намеренно без серверных зависимостей — как lib/stores.ts и
 * lib/sources.ts: сюда ходит и клиентский компонент цены, и роуты. Сеть и
 * запись в базу живут отдельно, в lib/deals.ts.
 *
 * Главная мысль здесь — не арифметика процентов, а СРОК ГОДНОСТИ. Цена
 * приезжает вместе с остальными метаданными, а те живут две недели (см.
 * META_MAX_AGE_SEC): без проверки свежести «−70%» провисело бы на карточке
 * ещё десять дней после конца распродажи. Неточная цена — полбеды, неправда
 * про скидку — повод больше сюда не возвращаться.
 */

export type Discount = {
  /** 1..99 */
  percent: number
  finalCents: number
  initialCents: number
  /** unix-секунды конца распродажи, если Steam назвал срок */
  endsAt?: number
  /** «до 17 августа» — считается на сервере, чтобы не разъезжалась гидратация */
  endsLabel?: string
}

/**
 * Сколько замер цены считается годным без подтверждения сроком.
 *
 * 36 часов, а не 24: прогрев цен идёт по заходам пользователя, и суточный
 * порог гасил бы скидку у того, кто заходит раз в день примерно в одно время.
 */
export const PRICE_TRUST_SEC = 36 * 3600

/**
 * Скидка, которую не стыдно показать. null — либо её нет, либо ей нельзя верить.
 *
 * Известный срок окончания сильнее возраста замера в обе стороны: срок в
 * прошлом гасит скидку даже у свежего замера (распродажа кончилась ровно
 * тогда, когда обещала), а срок в будущем оживляет старый замер (Steam сам
 * сказал, до какого числа держится цена).
 */
export function discountOf(
  meta: Pick<GameMeta, 'priceFinal' | 'priceInitial' | 'discountPercent' | 'discountEndsAt' | 'priceAt'>,
  nowSec: number,
): Discount | null {
  const { priceFinal, priceInitial, discountPercent, discountEndsAt, priceAt } = meta
  if (!discountPercent || discountPercent <= 0) return null
  if (priceFinal === undefined || priceInitial === undefined) return null
  if (priceInitial <= priceFinal) return null

  if (discountEndsAt !== undefined) {
    if (discountEndsAt <= nowSec) return null
  } else if (priceAt === undefined || nowSec - priceAt > PRICE_TRUST_SEC) {
    return null
  }

  return {
    percent: Math.min(Math.round(discountPercent), 99),
    finalCents: priceFinal,
    initialCents: priceInitial,
    ...(discountEndsAt !== undefined ? { endsAt: discountEndsAt } : {}),
  }
}

/**
 * Цена как строка. Валюта приходит из STEAM_STORE_CC и по умолчанию доллар —
 * тот же символ, что уже стоял по всем страницам до появления этого модуля.
 */
export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

/**
 * «до 17 августа», «остались сутки», «сегодня последний день».
 *
 * Считается на сервере и уезжает готовой строкой: toLocaleDateString у
 * клиента и у сервера живут в разных часовых поясах, и одна и та же скидка
 * рендерилась бы с разной датой — Next ловит это как расхождение гидратации.
 *
 * Дата берётся в UTC осознанно: распродажи Steam заканчиваются по
 * тихоокеанскому времени, и точность до часа тут всё равно недостижима.
 */
export function discountEndsLabel(endsAt: number, nowSec: number): string | null {
  const left = endsAt - nowSec
  if (left <= 0) return null
  if (left < 24 * 3600) return 'сегодня последний день'
  const days = Math.floor(left / 86_400)
  if (days <= 3) return `${plural(days, 'остался', 'осталось', 'осталось')} ${days} ${plural(days, 'день', 'дня', 'дней')}`
  const d = new Date(endsAt * 1000)
  return `до ${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}`
}

/** Скидка вместе с подписью срока — то, что уезжает клиенту одним куском */
/**
 * Цена, которую не стыдно показать. null — верить нечему, лучше промолчать.
 *
 * discountOf честно отказывается показывать протухшую СКИДКУ. Но price_final
 * при заявленной скидке — это АКЦИОННОЕ число, и отбросив скидку, мы рисовали
 * его как обычную цену. Замер по проду: 262 карточки в таком состоянии, у
 * Heavy Rain стояло $0.99 при настоящих $19.99 — не неточность, а двадцатая
 * часть правды. То же число уезжало в Offer микроразметки, то есть в выдачу
 * поисковика.
 *
 * Подставлять price_initial НЕЛЬЗЯ: «срок вышел» и «акция продлена с новой
 * датой» отсюда неразличимы, и полная цена оказалась бы такой же выдумкой,
 * только в другую сторону.
 *
 * Цена без заявленной скидки под это правило не попадает: старый замер делает
 * её неточной, но не ложной. Это та же граница, что проведена в докблоке
 * модуля: «неточная цена — полбеды, неправда про скидку — повод больше сюда
 * не возвращаться».
 */
export function trustedPrice(
  meta: Parameters<typeof discountOf>[0],
  nowSec: number,
): number | null {
  const price = meta.priceFinal
  if (price === undefined) return null
  if (!meta.discountPercent) return price
  return discountOf(meta, nowSec) ? price : null
}

export function discountView(
  meta: Parameters<typeof discountOf>[0],
  nowSec: number,
): Discount | null {
  const d = discountOf(meta, nowSec)
  if (!d) return null
  if (d.endsAt === undefined) return d
  const label = discountEndsLabel(d.endsAt, nowSec)
  return label ? { ...d, endsLabel: label } : d
}
