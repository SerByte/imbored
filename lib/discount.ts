import { fmtDate, pl, tr, type Locale } from './i18n'
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
  /**
   * «до 17 августа» — считается на сервере, чтобы не разъезжалась гидратация.
   * Язык — того запроса, который её посчитал (discountView, opts.locale):
   * клиент её не переводит, он рисует готовую строку.
   */
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

// Цена строкой — formatPrice в lib/steamregion: у неё есть валюта, и её
// знает только регион, в котором цену сняли

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
 *
 * calendar — только датой, без «осталось N дней». Для страниц, которые живут
 * в кэше дольше суток (карточка игры, см. GAME_PAGE_REVALIDATE_SEC): отсчёт
 * там был бы неправдой уже назавтра, а каждая его новая цифра — новым
 * выводом страницы, то есть лишней записью ISR. Дата верна весь срок акции.
 *
 * locale — язык подписи, по умолчанию русский. Английская — «1 day left»,
 * «last day today», «until Nov 24»: месяц сокращением, как в глоссарии, —
 * подпись стоит рядом с ценой, и полное «November» её бы раздвинуло.
 */
export function discountEndsLabel(
  endsAt: number,
  nowSec: number,
  opts: { calendar?: boolean; locale?: Locale } = {},
): string | null {
  const left = endsAt - nowSec
  if (left <= 0) return null
  const locale = opts.locale ?? 'ru'
  const en = locale === 'en'
  if (!opts.calendar) {
    if (left < 24 * 3600) return tr(locale, { ru: 'сегодня последний день', en: 'last day today' })
    const days = Math.floor(left / 86_400)
    if (days <= 3) {
      // Русская фраза склоняет и глагол («остался 1 день»), английская — только
      // существительное: у каждого языка своя целая фраза, а не общая склейка
      if (en) return `${days} ${pl('en', days, { ru: ['день', 'дня', 'дней'], en: ['day', 'days'] })} left`
      return `${plural(days, 'остался', 'осталось', 'осталось')} ${days} ${plural(days, 'день', 'дня', 'дней')}`
    }
  }
  // Английская дата — через Intl, в той же зоне UTC, что и русская ниже: сервер
  // и браузер обязаны сойтись в дне. Русская остаётся своей таблицей
  // родительного падежа — так она печаталась всегда
  const d = new Date(endsAt * 1000)
  if (en) {
    // Intl на битой дате (срок NaN или Infinity из кривой записи) бросает
    // RangeError, и цена уронила бы всю страницу в error.tsx. Срока, которому
    // нельзя верить, на английской странице просто нет — как и истёкшего выше.
    // Русская ветка битую дату не роняет и печатает как печатала
    if (Number.isNaN(d.getTime())) return null
    return `until ${fmtDate('en', d, { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
  }
  return `до ${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}`
}

/**
 * До какого момента скидке верит discountOf: названный Steam срок, а без него
 * — замер плюс PRICE_TRUST_SEC. null — верить нечему или скидки нет.
 *
 * Нужна странице, которая показывает скидку дольше, чем та живёт: карточка
 * игры кэшируется на неделю, и страница, собранная в последний день
 * распродажи, иначе обещала бы «−70%» ещё шесть дней. Клиент прячет цену по
 * этому сроку сам (components/ShownUntil).
 */
export function discountTrustedUntil(
  meta: Parameters<typeof discountOf>[0],
  nowSec: number,
): number | null {
  if (!discountOf(meta, nowSec)) return null
  if (meta.discountEndsAt !== undefined) return meta.discountEndsAt
  return meta.priceAt !== undefined ? meta.priceAt + PRICE_TRUST_SEC : null
}

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

/**
 * Обычная цена игры, чью погасшую распродажу trustedPrice спрятал, — или null.
 *
 * Прятать акционное число правильно, а вот герой карточки без цены, но с
 * «Steam возвращает деньги» под кнопками читался сбоем: так неделями стояли
 * Hades ($24.99) и ICARUS — до перезамера, который сверка каталога теперь
 * делает сама (deadDeals в stalePriceAppids), а карточка видит на своей
 * недельной перегенерации.
 *
 * Это не та подстановка, которую запрещает докблок trustedPrice. Там
 * price_initial выдавался бы за цену, а «акция кончилась» и «продлена» отсюда
 * неразличимы. Здесь он подписан как то, чем и является, — цена без скидки
 * по словам Steam, «было» той же пары, — и правдив в обоих случаях: кончилась
 * акция — столько и стоит, продлена — в магазине дешевле написанного. Ценой
 * при этом он не становится: ни в Offer разметки, ни в суммы, ни на плитки
 * /play он не идёт — только подписанной строкой героя карточки.
 */
export function lapsedRegularPrice(
  meta: Parameters<typeof discountOf>[0],
  nowSec: number,
): number | null {
  const { priceFinal, priceInitial, discountPercent } = meta
  if (priceFinal === undefined || priceInitial === undefined) return null
  if (!discountPercent || discountPercent <= 0 || priceInitial <= priceFinal) return null
  return trustedPrice(meta, nowSec) === null ? priceInitial : null
}

/**
 * Скидка вместе с подписью срока — то, что уезжает клиенту одним куском.
 *
 * urgency: false — скидка без «до 17 августа». Срок распродажи — давление
 * «успей купить», и у человека, у которого нераспакованного больше, чем он
 * успеет пройти за год, оно работает против него же: цена и процент остаются
 * фактом, а обратный отсчёт убираем (см. hideUrgencyFor в lib/recommend.ts).
 *
 * calendar: true — срок только датой (см. discountEndsLabel): для страниц,
 * которые живут в кэше дольше суток.
 *
 * locale — язык endsLabel, по умолчанию русский: подпись уезжает клиенту
 * готовой строкой, поэтому язык решает тот, кто её считает, — язык запроса.
 */
export function discountView(
  meta: Parameters<typeof discountOf>[0],
  nowSec: number,
  opts: { urgency?: boolean; calendar?: boolean; locale?: Locale } = {},
): Discount | null {
  const d = discountOf(meta, nowSec)
  if (!d) return null
  if (d.endsAt === undefined || opts.urgency === false) return d
  const label = discountEndsLabel(d.endsAt, nowSec, { calendar: opts.calendar, locale: opts.locale })
  return label ? { ...d, endsLabel: label } : d
}
