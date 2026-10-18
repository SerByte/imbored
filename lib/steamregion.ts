/**
 * Регион магазина Steam: чьи цены показываем и как их писать.
 *
 * Модуль чистый и годится клиенту — как lib/discount.ts и lib/stores.ts: сюда
 * ходят и ценник в браузере, и роуты, и крон. process.env читает только
 * priceRegion, и клиентскому коду звать её нельзя (в бандле переменной нет, и
 * ответ был бы «us» у всех): регион решает сервер и отдаёт его рядом с ценой.
 * Сторож — lib/steamregion.test.ts.
 *
 * РЕГИОНОВ ДВА, и это главное решение модуля.
 *
 * Метаданные (названия, теги, отзывы, кадры, appdetails) берутся из
 * американского магазина всегда — META_CC. Цены — из того, что задан
 * STEAM_STORE_CC, — priceRegion. Одна переменная на оба раньше значила, что
 * смена региона цен ломает каталог: в российском Steam GetItems отдаёт
 * visible:false у Cyberpunk 2077, Starfield, The Witcher 3, Hogwarts Legacy и
 * других (замер 28.09.2026), а appdetails — success:false. Прогрев сделал бы
 * им заглушки «App N», крон карточек счёл бы их пустыми, сверка отзывов
 * перестала бы их обновлять.
 *
 * Регион, а не код валюты, хранится рядом с ценой (games.price_cc): у США и у
 * СНГ-доллара одна валюта, а цены разные, и сравнивать их как одно нельзя.
 *
 * Английская версия сайта показывает те же цены того же региона: регион — один
 * на развёртывание, а не на читателя. Поэтому подпись называет его прямо —
 * «price on Russian Steam», — и никогда «in your region»: регион читателя
 * сервис не знает, и такая подпись была бы неправдой про каждого, чей
 * магазин не совпал с регионом развёртывания.
 */

import { intlLocale, tr, type Locale } from './i18n'

type Region = {
  /** ISO 4217 */
  currency: string
  /** «цена в российском Steam» */
  where: string
  /** «по ценам российского Steam» */
  whose: string
  /** Английское прилагательное: «price on Russian Steam», «at US Steam prices» */
  en: string
}

/**
 * Регионы, которые понимает сервис. Турция и Аргентина — в долларах: Steam
 * перевёл их на доллар в 2023-м, и старая таблица в lib/jsonld, где у Турции
 * стояла лира, размечала бы доллары лирами.
 */
export const STEAM_REGIONS: Readonly<Record<string, Region>> = {
  // «US» и «UK», а не «American» и «British»: так эти магазины называют
  // по-английски, «American Steam» звучит переводом
  us: { currency: 'USD', where: 'американском', whose: 'американского', en: 'US' },
  ru: { currency: 'RUB', where: 'российском', whose: 'российского', en: 'Russian' },
  kz: { currency: 'KZT', where: 'казахстанском', whose: 'казахстанского', en: 'Kazakhstani' },
  ua: { currency: 'UAH', where: 'украинском', whose: 'украинского', en: 'Ukrainian' },
  gb: { currency: 'GBP', where: 'британском', whose: 'британского', en: 'UK' },
  de: { currency: 'EUR', where: 'немецком', whose: 'немецкого', en: 'German' },
  fr: { currency: 'EUR', where: 'французском', whose: 'французского', en: 'French' },
  pl: { currency: 'PLN', where: 'польском', whose: 'польского', en: 'Polish' },
  br: { currency: 'BRL', where: 'бразильском', whose: 'бразильского', en: 'Brazilian' },
  jp: { currency: 'JPY', where: 'японском', whose: 'японского', en: 'Japanese' },
  cn: { currency: 'CNY', where: 'китайском', whose: 'китайского', en: 'Chinese' },
  ca: { currency: 'CAD', where: 'канадском', whose: 'канадского', en: 'Canadian' },
  au: { currency: 'AUD', where: 'австралийском', whose: 'австралийского', en: 'Australian' },
  in: { currency: 'INR', where: 'индийском', whose: 'индийского', en: 'Indian' },
  tr: { currency: 'USD', where: 'турецком', whose: 'турецкого', en: 'Turkish' },
  ar: { currency: 'USD', where: 'аргентинском', whose: 'аргентинского', en: 'Argentine' },
}

/**
 * Регион цен, записанных до колонки price_cc. NULL в ней — это он: до этой
 * правки все цены снимались с `us` (живая /game/1086940 показывала $59.99 с
 * priceCurrency USD), поэтому бэкфилл не нужен.
 */
export const LEGACY_PRICE_CC = 'us'

/**
 * Регион метаданных, отзывов и appdetails. Не настраивается: в `us` видно всё
 * (см. докблок модуля), и отзывы остаются на той же шкале, что у посева
 * каталога и у сверки сигналов.
 */
export const META_CC = 'us'

/** Строка → известный регион; всё остальное — null */
function known(raw: string | null | undefined): string | null {
  const cc = (raw ?? '').trim().toLowerCase()
  return Object.hasOwn(STEAM_REGIONS, cc) ? cc : null
}

/** Регион из строки: неизвестный и пустой — LEGACY_PRICE_CC */
export function steamRegion(raw: string | null | undefined): string {
  return known(raw) ?? LEGACY_PRICE_CC
}

let warned = false

/**
 * Регион цен из STEAM_STORE_CC. Читается при каждом вызове — как
 * llmDailyCap: vi.stubEnv в тестах и одно место правды у всех, кто пишет и
 * читает цены.
 *
 * Неизвестное значение — `us` и одна строка в лог на процесс, а не падение:
 * опечатка в переменной не должна класть сайт, а молча — не должна прятаться.
 * Прежний код отправлял в Steam что угодно, и «eu» из старого .env.example
 * становилось country_code EU, которого у Steam нет.
 */
export function priceRegion(env: Record<string, string | undefined> = process.env): string {
  const raw = env.STEAM_STORE_CC
  const cc = known(raw)
  if (cc) return cc
  if (raw?.trim() && !warned) {
    warned = true
    console.warn(JSON.stringify({ event: 'steam-region-unknown', value: raw, used: LEGACY_PRICE_CC }))
  }
  return LEGACY_PRICE_CC
}

/** Валюта региона; неизвестный регион — валюта LEGACY_PRICE_CC */
export function regionCurrency(cc: string | null | undefined): string {
  return STEAM_REGIONS[steamRegion(cc)].currency
}

const formatters = new Map<string, Intl.NumberFormat>()

/** Язык в ключе обязателен: иначе первый вызов решал бы разряды и знак для обоих */
function formatter(currency: string, digits: number, locale: Locale): Intl.NumberFormat {
  const key = `${locale}:${currency}:${digits}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(intlLocale(locale), {
      style: 'currency',
      currency,
      // «$», а не «US$»: регион называет подпись рядом (priceWhere)
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    formatters.set(key, f)
  }
  return f
}

/**
 * Цена строкой по-русски: «1 999 ₽», «59,99 $», «4 499 ₸». Пробелы —
 * неразрывные (U+00A0): сумма не рвётся переносом посреди числа.
 *
 * minor — в минимальных единицах, как их отдаёт Steam: сотые у любой валюты,
 * включая рубль (BG3 в российском магазине — 199900). Копейки и центы — только
 * когда они есть: «1 999,00 ₽» на ценнике читается как бухгалтерия.
 *
 * whole — целыми единицами, с округлением: для строк, где на копейки нет места
 * (чип колоды, сумма бэклога).
 *
 * cc — регион ЭТОЙ цены, а не текущий: карточка, отданная до переключения
 * региона, приезжает со своим и рисует свою валюту.
 *
 * locale — язык записи числа, а не регион: та же цена по-английски — «₽1,999»,
 * «$59.99», знак перед числом и разряды запятой. Валюту по-прежнему решает cc.
 */
export function formatPrice(
  minor: number,
  cc: string,
  opts: { whole?: boolean; locale?: Locale } = {},
): string {
  const digits = opts.whole || minor % 100 === 0 ? 0 : 2
  return formatter(regionCurrency(cc), digits, opts.locale ?? 'ru').format(minor / 100)
}

/** «цена в российском Steam» · «price on Russian Steam» — подпись под ценником */
export function priceWhere(cc: string, locale: Locale = 'ru'): string {
  const r = STEAM_REGIONS[steamRegion(cc)]
  return tr(locale, { ru: `цена в ${r.where} Steam`, en: `price on ${r.en} Steam` })
}

/** «не продаётся в российском Steam» — вместо цены у скрытой регионом игры */
export function notSold(cc: string, locale: Locale = 'ru'): string {
  const r = STEAM_REGIONS[steamRegion(cc)]
  return tr(locale, { ru: `не продаётся в ${r.where} Steam`, en: `not sold on ${r.en} Steam` })
}

/**
 * «нет в российском Steam» — то же для строки, где места на глагол нет (чип
 * колоды). Английская короче русской: «not on Russian Steam».
 */
export function notSoldShort(cc: string, locale: Locale = 'ru'): string {
  const r = STEAM_REGIONS[steamRegion(cc)]
  return tr(locale, { ru: `нет в ${r.where} Steam`, en: `not on ${r.en} Steam` })
}

/** «по ценам российского Steam» · «at Russian Steam prices» — хвост суммы бэклога */
export function byPrices(cc: string, locale: Locale = 'ru'): string {
  const r = STEAM_REGIONS[steamRegion(cc)]
  return tr(locale, { ru: `по ценам ${r.whose} Steam`, en: `at ${r.en} Steam prices` })
}
