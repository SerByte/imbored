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
 */

type Region = {
  /** ISO 4217 */
  currency: string
  /** «цена в российском Steam» */
  where: string
  /** «по ценам российского Steam» */
  whose: string
}

/**
 * Регионы, которые понимает сервис. Турция и Аргентина — в долларах: Steam
 * перевёл их на доллар в 2023-м, и старая таблица в lib/jsonld, где у Турции
 * стояла лира, размечала бы доллары лирами.
 */
export const STEAM_REGIONS: Readonly<Record<string, Region>> = {
  us: { currency: 'USD', where: 'американском', whose: 'американского' },
  ru: { currency: 'RUB', where: 'российском', whose: 'российского' },
  kz: { currency: 'KZT', where: 'казахстанском', whose: 'казахстанского' },
  ua: { currency: 'UAH', where: 'украинском', whose: 'украинского' },
  gb: { currency: 'GBP', where: 'британском', whose: 'британского' },
  de: { currency: 'EUR', where: 'немецком', whose: 'немецкого' },
  fr: { currency: 'EUR', where: 'французском', whose: 'французского' },
  pl: { currency: 'PLN', where: 'польском', whose: 'польского' },
  br: { currency: 'BRL', where: 'бразильском', whose: 'бразильского' },
  jp: { currency: 'JPY', where: 'японском', whose: 'японского' },
  cn: { currency: 'CNY', where: 'китайском', whose: 'китайского' },
  ca: { currency: 'CAD', where: 'канадском', whose: 'канадского' },
  au: { currency: 'AUD', where: 'австралийском', whose: 'австралийского' },
  in: { currency: 'INR', where: 'индийском', whose: 'индийского' },
  tr: { currency: 'USD', where: 'турецком', whose: 'турецкого' },
  ar: { currency: 'USD', where: 'аргентинском', whose: 'аргентинского' },
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

function formatter(currency: string, digits: number): Intl.NumberFormat {
  const key = `${currency}:${digits}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat('ru-RU', {
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
 */
export function formatPrice(minor: number, cc: string, opts: { whole?: boolean } = {}): string {
  const digits = opts.whole || minor % 100 === 0 ? 0 : 2
  return formatter(regionCurrency(cc), digits).format(minor / 100)
}

/** «цена в российском Steam» — подпись под ценником */
export function priceWhere(cc: string): string {
  return `цена в ${STEAM_REGIONS[steamRegion(cc)].where} Steam`
}

/** «не продаётся в российском Steam» — вместо цены у скрытой регионом игры */
export function notSold(cc: string): string {
  return `не продаётся в ${STEAM_REGIONS[steamRegion(cc)].where} Steam`
}

/** «нет в российском Steam» — то же для строки, где места на глагол нет (чип колоды) */
export function notSoldShort(cc: string): string {
  return `нет в ${STEAM_REGIONS[steamRegion(cc)].where} Steam`
}

/** «по ценам российского Steam» — хвост суммы бэклога */
export function byPrices(cc: string): string {
  return `по ценам ${STEAM_REGIONS[steamRegion(cc)].whose} Steam`
}
