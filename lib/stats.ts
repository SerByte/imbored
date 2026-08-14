import { plural } from './plural'
import { classifyLibraryGame } from './recommend'
import type { GameMeta, LibraryGame } from './types'

/** «Цена бэклога»: сколько денег лежит в несыгранных играх (по известным ценам) */
export function backlogValue(
  library: LibraryGame[],
  metaOf: (appid: number) => GameMeta | undefined,
  nowSec: number,
): { cents: number; pricedCount: number; unplayedCount: number } {
  let cents = 0
  let pricedCount = 0
  let unplayedCount = 0
  for (const g of library) {
    if (classifyLibraryGame(g, nowSec) !== 'unplayed') continue
    unplayedCount++
    const price = metaOf(g.appid)?.priceFinal
    if (price !== undefined && price > 0) {
      cents += price
      pricedCount++
    }
  }
  return { cents, pricedCount, unplayedCount }
}

/**
 * Перевод суммы бэклога в осязаемое: «≥ $1073» ни с чем не соотносится, а
 * «153 бургера» — соотносится сразу.
 *
 * Шутка держится на одном контрасте: еду человек доводит до конца без осечек,
 * в отличие от купленных игр. Поэтому сравнения бытовые, а не абстрактные.
 *
 * Цены — в долларах: price_final приходит в валюте STEAM_STORE_CC, а он по
 * умолчанию `us`, и весь остальной UI тоже печатает `$`.
 */
type Unit = {
  /** цена штуки в центах */
  price: number
  /** фраза целиком; `{n}` — место числа, его страница рисует моноширинным */
  say: (n: number) => string
}

const UNITS: Unit[] = [
  {
    price: 700,
    say: (n) => `Это {n} ${plural(n, 'бургер', 'бургера', 'бургеров')} — их бы ты доел.`,
  },
  {
    price: 500,
    say: (n) =>
      `Это {n} ${plural(n, 'шаурма', 'шаурмы', 'шаурм')}, и ни одну не пришлось бы «начать попозже».`,
  },
  {
    price: 500,
    say: (n) =>
      `Это {n} ${plural(n, 'стакан', 'стакана', 'стаканов')} кофе — как раз хватит не спать, пока проходишь.`,
  },
  {
    price: 1400,
    say: (n) => `Это {n} ${plural(n, 'пицца', 'пиццы', 'пицц')} — вот их-то ты открываешь сразу.`,
  },
  {
    price: 1300,
    say: (n) =>
      `Это {n} ${plural(n, 'поход', 'похода', 'походов')} в кино, где досидеть до конца почему-то получается.`,
  },
  {
    price: 1700,
    say: (n) =>
      `Это {n} ${plural(n, 'месяц', 'месяца', 'месяцев')} Game Pass — чужие игры, которые ты бы тоже не запустил.`,
  },
  {
    price: 7000,
    say: (n) =>
      `Это {n} ${plural(n, 'полная игра', 'полные игры', 'полных игр')} по цене релиза. Ну, ещё столько же.`,
  },
  {
    price: 40_000,
    // единственная строка без склонения: «Steam Deck» не склоняется, а {n}
    // подставляется снаружи — параметр здесь не нужен
    say: () => `Это {n} Steam Deck — на них бы ты в это тоже не поиграл.`,
  },
]

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

export function backlogEquivalent(
  cents: number,
  seed: string,
): { count: number; text: string } | null {
  const fitting = UNITS.map((u) => ({ u, count: Math.floor(cents / u.price) })).filter(
    ({ count }) => count >= MIN_COUNT && count <= MAX_COUNT,
  )
  if (!fitting.length) return null
  // выбор по игроку, а не случайный: страница динамическая, и random менял бы
  // шутку на каждом обновлении — скриншот было бы не повторить
  const { u, count } = fitting[hash(seed) % fitting.length]
  return { count, text: u.say(count) }
}
