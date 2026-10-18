import { trustedPrice } from './discount'
import { pl, tr, type Locale } from './i18n'
import { looksLikeNonGame } from './junk'
import { playtimeHidden } from './playtime'
import { classifyLibraryGame } from './recommend'
import { LEGACY_PRICE_CC, priceRegion, regionCurrency } from './steamregion'
import type { GameMeta, LibraryGame } from './types'

/**
 * «Цена бэклога»: сколько денег лежит в несыгранных играх (по известным ценам).
 *
 * Не-игры (looksLikeNonGame) в бэклог не входят: саундтрек за $9.99 с нулём
 * минут добавлял себя и к счётчику, и к «сгоревшим» деньгам, хотя /play тот же
 * саундтрек бэклогом не считает. Мёртвая сетевая игра входит — она куплена.
 *
 * Время скрыто настройками Steam (lib/playtime.ts) — бэклога нет: «несыгранной»
 * тогда выглядит вся библиотека, и сумма за неё была бы суммой за всё
 * купленное, названной долгом. Нули гасят и карточку на /library, и строку
 * денег на портрете.
 *
 * Сумма — в ОДНОЙ валюте, региона cc, и он едет в ответе: страница печатает
 * валюту по нему, а не по текущему региону. Цены в мете уже однородны
 * (rowToMeta), но проверка стоит и здесь — мета могла прийти не из базы.
 * Конвертации нет намеренно: региональная цена — не курс. BG3 в американском
 * Steam стоит 59,99 $, по курсу это под пять тысяч рублей, а в российском —
 * 1 999 ₽; пересчитанная сумма — деньги, которых никто не платил. Пока каталог
 * переоценивается после смены региона, растёт не сумма, а «цена известна у N».
 *
 * Цена — trustedPrice, а не сырой price_final: при сгоревшей скидке это
 * акционное число без акции (у Heavy Rain $0.99 при $19.99), и сумма бэклога
 * занижалась бы на его разницу, расходясь с карточкой игры, которая ту же
 * цену не показывает вовсе. Такая игра — «цена неизвестна», и снижает «цена
 * известна у N»; полную цену вместо неё не подставляем — см. докблок
 * trustedPrice.
 */
export function backlogValue(
  library: LibraryGame[],
  metaOf: (appid: number) => GameMeta | undefined,
  nowSec: number,
  cc: string = priceRegion(),
): { cents: number; pricedCount: number; unplayedCount: number; cc: string } {
  if (playtimeHidden(library)) return { cents: 0, pricedCount: 0, unplayedCount: 0, cc }
  let cents = 0
  let pricedCount = 0
  let unplayedCount = 0
  for (const g of library) {
    if (classifyLibraryGame(g, nowSec) !== 'unplayed') continue
    const meta = metaOf(g.appid)
    if (looksLikeNonGame(g, meta)) continue
    unplayedCount++
    const price = meta ? trustedPrice(meta, nowSec) : null
    if (price !== null && price > 0 && (meta?.priceCc ?? LEGACY_PRICE_CC) === cc) {
      cents += price
      pricedCount++
    }
  }
  return { cents, pricedCount, unplayedCount, cc }
}

/**
 * Перевод суммы бэклога в осязаемое: «≥ $1073» ни с чем не соотносится, а
 * «153 бургера» — соотносится сразу.
 *
 * Шутка держится на одном контрасте: еду человек доводит до конца без осечек,
 * в отличие от купленных игр. Поэтому сравнения бытовые, а не абстрактные.
 *
 * Цены единиц — своя таблица на валюту: сумма приходит в валюте региона цен
 * (backlogValue), и бургер за семь «долларов» из рублёвой суммы насчитал бы
 * их в сто раз меньше. Числа ориентировочные — шутка не прайс-лист.
 *
 * Язык — не таблица, а фраза: у каждой единицы обе версии шутки рядом. Так
 * выбор по хэшу (ниже) у русского и английского читателя падает на одну и
 * ту же строку таблицы — английская версия той же страницы шутит про то же
 * число, а не про случайное другое. Шаурма по-английски — буррито: шутка
 * держится на еде, которую доедают, а не на слове.
 */
type Unit = {
  /** цена штуки в минимальных единицах валюты таблицы (центы, копейки) */
  price: number
  /** фраза целиком на языке; `{n}` — место числа, его страница рисует моноширинным */
  say: (n: number, locale: Locale) => string
}

const BURGER = (n: number, locale: Locale) => {
  const word = pl(locale, n, { ru: ['бургер', 'бургера', 'бургеров'], en: ['burger', 'burgers'] })
  return tr(locale, { ru: `Это {n} ${word} — их бы ты доел.`, en: `That's {n} ${word}, and you'd finish every one.` })
}
const SHAWARMA = (n: number, locale: Locale) => {
  const word = pl(locale, n, { ru: ['шаурма', 'шаурмы', 'шаурм'], en: ['burrito', 'burritos'] })
  return tr(locale, {
    ru: `Это {n} ${word}, и ни одну не пришлось бы «начать попозже».`,
    en: `That's {n} ${word}, and not one of them would wait for “someday”.`,
  })
}
const COFFEE = (n: number, locale: Locale) => {
  const word = pl(locale, n, { ru: ['стакан', 'стакана', 'стаканов'], en: ['cup', 'cups'] })
  return tr(locale, {
    ru: `Это {n} ${word} кофе — как раз хватит не спать, пока проходишь.`,
    en: `That's {n} ${word} of coffee, just enough to stay up and play through it all.`,
  })
}
const PIZZA = (n: number, locale: Locale) => {
  const word = pl(locale, n, { ru: ['пицца', 'пиццы', 'пицц'], en: ['pizza', 'pizzas'] })
  return tr(locale, {
    ru: `Это {n} ${word} — вот их-то ты открываешь сразу.`,
    en: `That's {n} ${word}. Those you open right away.`,
  })
}
const CINEMA = (n: number, locale: Locale) => {
  const word = pl(locale, n, { ru: ['поход', 'похода', 'походов'], en: ['trip', 'trips'] })
  return tr(locale, {
    ru: `Это {n} ${word} в кино, где досидеть до конца почему-то получается.`,
    en: `That's {n} ${word} to the movies, where somehow you always make it to the end.`,
  })
}
const GAME_PASS = (n: number, locale: Locale) => {
  const word = pl(locale, n, { ru: ['месяц', 'месяца', 'месяцев'], en: ['month', 'months'] })
  return tr(locale, {
    ru: `Это {n} ${word} Game Pass — чужие игры, которые ты бы тоже не запустил.`,
    en: `That's {n} ${word} of Game Pass, full of games you wouldn't launch either.`,
  })
}
const FULL_GAME = (n: number, locale: Locale) => {
  const word = pl(locale, n, { ru: ['полная игра', 'полные игры', 'полных игр'], en: ['new game', 'new games'] })
  return tr(locale, {
    ru: `Это {n} ${word} по цене релиза. Ну, ещё столько же.`,
    en: `That's {n} ${word} at launch price. So, another backlog just like this one.`,
  })
}
// По-русски «Steam Deck» не склоняется, по-английски — обычное
// множественное: три формы русского одинаковы, а {n} подставляется снаружи
const STEAM_DECK = (n: number, locale: Locale) => {
  const word = pl(locale, n, { ru: ['Steam Deck', 'Steam Deck', 'Steam Deck'], en: ['Steam Deck', 'Steam Decks'] })
  return tr(locale, {
    ru: `Это {n} ${word} — на них бы ты в это тоже не поиграл.`,
    en: `That's {n} ${word}, and you wouldn't play these on them either.`,
  })
}

const UNITS: Readonly<Record<string, readonly Unit[]>> = {
  USD: [
    { price: 700, say: BURGER },
    { price: 500, say: SHAWARMA },
    { price: 500, say: COFFEE },
    { price: 1400, say: PIZZA },
    { price: 1300, say: CINEMA },
    { price: 1700, say: GAME_PASS },
    { price: 7000, say: FULL_GAME },
    { price: 40_000, say: STEAM_DECK },
  ],
  // Game Pass в рублях не продаётся — строки нет, а не выдуманная цена
  RUB: [
    { price: 35_000, say: BURGER },
    { price: 30_000, say: SHAWARMA },
    { price: 25_000, say: COFFEE },
    { price: 80_000, say: PIZZA },
    { price: 50_000, say: CINEMA },
    { price: 350_000, say: FULL_GAME },
    { price: 6_000_000, say: STEAM_DECK },
  ],
}

/** Вне этих границ шутка перестаёт читаться: «0 Steam Deck» или «21 460 жвачек» */
const MIN_COUNT = 3
const MAX_COUNT = 500

/** Стабильный хэш строки: одному игроку — всегда одна и та же шутка */
function hash(s: string): number {
  let h = 2_166_136_261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16_777_619)
  }
  return h >>> 0
}

/**
 * minor — сумма в минимальных единицах, cc — её регион (backlogValue). Для
 * валюты без своей таблицы шутки нет: null, как и у суммы вне границ.
 *
 * locale — язык фразы, по умолчанию русский. Выбор единицы от языка не
 * зависит (см. Unit): count у обеих версий один и тот же.
 */
export function backlogEquivalent(
  minor: number,
  cc: string,
  seed: string,
  locale: Locale = 'ru',
): { count: number; text: string } | null {
  const units = UNITS[regionCurrency(cc)]
  if (!units) return null
  const fitting = units.map((u) => ({ u, count: Math.floor(minor / u.price) })).filter(
    ({ count }) => count >= MIN_COUNT && count <= MAX_COUNT,
  )
  if (!fitting.length) return null
  // выбор по игроку, а не случайный: страница динамическая, и random менял бы
  // шутку на каждом обновлении — скриншот было бы не повторить
  const { u, count } = fitting[hash(seed) % fitting.length]
  return { count, text: u.say(count, locale) }
}
