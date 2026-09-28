import { looksLikeNonGame } from './junk'
import { playtimeHidden } from './playtime'
import { plural } from './plural'
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
    const price = meta?.priceFinal
    if (price !== undefined && price > 0 && (meta?.priceCc ?? LEGACY_PRICE_CC) === cc) {
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
 */
type Unit = {
  /** цена штуки в минимальных единицах валюты таблицы (центы, копейки) */
  price: number
  /** фраза целиком; `{n}` — место числа, его страница рисует моноширинным */
  say: (n: number) => string
}

const BURGER = (n: number) => `Это {n} ${plural(n, 'бургер', 'бургера', 'бургеров')} — их бы ты доел.`
const SHAWARMA = (n: number) =>
  `Это {n} ${plural(n, 'шаурма', 'шаурмы', 'шаурм')}, и ни одну не пришлось бы «начать попозже».`
const COFFEE = (n: number) =>
  `Это {n} ${plural(n, 'стакан', 'стакана', 'стаканов')} кофе — как раз хватит не спать, пока проходишь.`
const PIZZA = (n: number) => `Это {n} ${plural(n, 'пицца', 'пиццы', 'пицц')} — вот их-то ты открываешь сразу.`
const CINEMA = (n: number) =>
  `Это {n} ${plural(n, 'поход', 'похода', 'походов')} в кино, где досидеть до конца почему-то получается.`
const GAME_PASS = (n: number) =>
  `Это {n} ${plural(n, 'месяц', 'месяца', 'месяцев')} Game Pass — чужие игры, которые ты бы тоже не запустил.`
const FULL_GAME = (n: number) =>
  `Это {n} ${plural(n, 'полная игра', 'полные игры', 'полных игр')} по цене релиза. Ну, ещё столько же.`
// единственная строка без склонения: «Steam Deck» не склоняется, а {n}
// подставляется снаружи — параметр здесь не нужен
const STEAM_DECK = () => `Это {n} Steam Deck — на них бы ты в это тоже не поиграл.`

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
 */
export function backlogEquivalent(
  minor: number,
  cc: string,
  seed: string,
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
  return { count, text: u.say(count) }
}
