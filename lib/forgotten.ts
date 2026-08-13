import { hashString } from './daily'
import { isJunk } from './junk'
import { buildTagProfile, isUntouched, libraryTileState, rankByTaste } from './recommend'
import type { GameMeta, LibraryGame } from './types'

type MetaOf = (appid: number) => GameMeta | undefined

/** Сколько игр на полке забытого */
export const SHELF_SIZE = 5

/**
 * «Полка»: N игр одним и тем же составом весь день, завтра другие.
 *
 * Не pickDaily в цикле по двум причинам. Нужен набор без повторов — раз. И
 * главное: результат не должен зависеть от порядка входа. /library сортирует
 * библиотеку по часам, портрет — иначе, а полка обязана совпадать. Поэтому
 * ключ считается от appid, он же служит тай-брейком.
 *
 * Детерминизм здесь не роскошь: /library — force-dynamic, и WarmCatalog дёргает
 * router.refresh() прямо на этой странице. Случайная полка видимо
 * перетасовывалась бы через секунду после загрузки, сама по себе.
 */
export function pickForgotten<T extends { appid: number }>(
  items: T[],
  seed: string,
  count = SHELF_SIZE,
): T[] {
  return [...items]
    .map((item) => ({ item, key: hashString(`${seed}:${item.appid}`) }))
    .sort((a, b) => a.key - b.key || a.item.appid - b.item.appid)
    .slice(0, count)
    .map((x) => x.item)
}

/** Ключ дня для сида — тот же вид, что у «Игры дня» */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Игры для полки: ни разу не запускались, не мусор, и по возможности с
 * обложкой — пять пустых прямоугольников полкой не выглядят.
 *
 * Гард appid > 0 — записи не-Steam магазинов лежат под отрицательными id, и
 * арта у них нет (тот же гард стоит на портрете).
 */
export function forgottenCandidates(library: LibraryGame[], metaOf: MetaOf): LibraryGame[] {
  const sealed = library.filter(
    (g) => g.appid > 0 && isUntouched(g) && !isJunk(g, metaOf(g.appid)),
  )
  const withArt = sealed.filter((g) => {
    const meta = metaOf(g.appid)
    return Boolean(meta?.headerImage || meta?.art)
  })
  // Порог в две игры, а не пять: на маленькой библиотеке лучше показать три
  // с обложками, чем пять, из которых две — заглушки
  return withArt.length >= 2 ? withArt : sealed
}

/* ---------- фильтры сетки /library ---------- */

export const LIBRARY_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'untouched', label: 'Не распакованы' },
  { id: 'unplayed', label: 'Открыл и закрыл' },
  { id: 'comeback', label: 'Заброшенные' },
  { id: 'active', label: 'Играю сейчас' },
] as const

export type LibraryFilter = (typeof LIBRARY_FILTERS)[number]['id']

const FILTER_IDS = new Set<string>(LIBRARY_FILTERS.map((f) => f.id))

/**
 * ?state= приходит из URL, то есть это может быть что угодно: мусор, массив
 * (при `?state=a&state=b`) или ничего. Всё непонятное — общая сетка.
 */
export function parseLibraryFilter(raw: string | string[] | undefined): LibraryFilter {
  return typeof raw === 'string' && FILTER_IDS.has(raw) ? (raw as LibraryFilter) : 'all'
}

export type LibraryView = {
  games: LibraryGame[]
  /** по ВСЕЙ библиотеке, а не по выбранной полке — это подписи на чипсах */
  counts: Record<LibraryFilter, number>
}

export function buildLibraryView(
  library: LibraryGame[],
  metaOf: MetaOf,
  filter: LibraryFilter,
  nowSec: number,
): LibraryView {
  const counts: Record<LibraryFilter, number> = {
    all: library.length,
    untouched: 0,
    unplayed: 0,
    comeback: 0,
    active: 0,
  }
  for (const g of library) {
    const state = libraryTileState(g, nowSec)
    if (state !== 'played') counts[state]++
  }

  const picked =
    filter === 'all' ? library : library.filter((g) => libraryTileState(g, nowSec) === filter)

  // «Ни разу не запускал» ранжируется по вкусу: часов у этих игр нет вовсе, а
  // даты покупки Steam не отдаёт — вкус здесь единственный осмысленный порядок.
  // Остальные полки остаются на часах вниз, как было.
  const games =
    filter === 'untouched'
      ? rankByTaste(picked, metaOf, buildTagProfile(library, metaOf))
      : [...picked].sort((a, b) => b.playtimeForever - a.playtimeForever)

  return { games, counts }
}
