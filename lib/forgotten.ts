import { hashString } from './daily'
import { collapseEditions, editionKey, isVariantName } from './editions'
import { isJunk, looksLikeNonGame } from './junk'
import {
  buildTagProfile,
  isUntouched,
  libraryTileState,
  rankByTaste,
  type LibraryTileState,
} from './recommend'
import { hasOldMarker } from './series'
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
 * Какое из изданий представляет игру на полке.
 *
 * Первые два уровня считаются ПО ИМЕНИ, а не по мете: /library — force-dynamic,
 * WarmCatalog догревает обложки прямо во время рендера, и metaOf === undefined
 * здесь норма, а не исключение. Игра без метаданных и без пометки обязана
 * выигрывать у прогретого VR-издания: молчание меты не доказывает, что запись
 * вторична.
 */
function canonicalFirst(metaOf: MetaOf) {
  const noArt = (m: GameMeta | undefined) => Number(!(m?.headerImage || m?.art))
  return (a: LibraryGame, b: LibraryGame): number => {
    const ma = metaOf(a.appid)
    const mb = metaOf(b.appid)
    return (
      // без пометки издания — это и есть игра, остальные записи её упаковка
      Number(isVariantName(a.name)) - Number(isVariantName(b.name)) ||
      // «legacy/classic/original» проигрывает всегда: пометка в названии сильнее
      // метрик — то же решение, что в buildSeriesIndex
      Number(hasOldMarker(a.name)) - Number(hasOldMarker(b.name)) ||
      // полка — стена обложек, запись без арта на ней бесполезна
      noArt(ma) - noArt(mb) ||
      // какое издание знает мир. Именно total, а не percent: у нишевого
      // VR-издания доля положительных выше на трёхстах отзывах
      (mb?.reviewsTotal ?? 0) - (ma?.reviewsTotal ?? 0) ||
      (mb?.ccu ?? 0) - (ma?.ccu ?? 0) ||
      (mb?.releaseYear ?? 0) - (ma?.releaseYear ?? 0) ||
      // детерминизм обязателен по той же причине, что и в pickForgotten
      a.appid - b.appid
    )
  }
}

/**
 * Игры для полки: ни разу не запускались, не мусор, и по возможности с
 * обложкой — пять пустых прямоугольников полкой не выглядят.
 *
 * Гард appid > 0 — записи не-Steam магазинов лежат под отрицательными id, и
 * арта у них нет (тот же гард стоит на портрете).
 *
 * banned — «Больше не показывать» (bannedAppids). Полка — тоже совет, и игра,
 * которую человек попросил не предлагать, не должна возвращаться сюда под
 * видом «ты забыл, что она у тебя есть»: он помнит, он её и убрал.
 */
export function forgottenCandidates(
  library: LibraryGame[],
  metaOf: MetaOf,
  banned: ReadonlySet<number> = new Set(),
): LibraryGame[] {
  const sealed = library.filter(
    (g) =>
      g.appid > 0 && isUntouched(g) && !banned.has(g.appid) && !isJunk(g, metaOf(g.appid)),
  )

  // «Ты забыл, что они у тебя есть» — неправда, если в другое издание ты играл.
  // Двадцать часов в Hellblade и ноль в «Hellblade … VR Edition» — это одна
  // игра, про которую ты помнишь. Ключи собираем по ВСЕЙ библиотеке, включая
  // записи чужих магазинов под отрицательными id: наиграл в копию из Epic —
  // тоже не забыл. Граница ровно та же, что у самой полки (ноль минут), а не
  // «два часа»: одной минуты хватает, чтобы игру помнить.
  const played = new Set<string>()
  for (const g of library) {
    if (isUntouched(g)) continue
    const key = editionKey(g.name)
    if (key) played.add(key)
  }
  const forgotten = sealed.filter((g) => !played.has(editionKey(g.name)))

  // Схлопывание СТРОГО до фильтра по обложкам: ниже не фильтр, а презентационный
  // выбор с оптовым откатом, и после него откат вернул бы дубликат обратно —
  // ровно на маленьких библиотеках, ради которых откат и существует.
  const unique = collapseEditions(forgotten, (g) => g.name, canonicalFirst(metaOf))

  const withArt = unique.filter((g) => {
    const meta = metaOf(g.appid)
    return Boolean(meta?.headerImage || meta?.art)
  })
  // Порог в две игры, а не пять: на маленькой библиотеке лучше показать три
  // с обложками, чем пять, из которых две — заглушки
  return withArt.length >= 2 ? withArt : unique
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

/**
 * ЧТО НАПИСАНО НА ПУСТОЙ ПОЛКЕ — СВОЁ У КАЖДОГО ФИЛЬТРА.
 *
 * Здесь была одна строка на все пять: «Здесь пусто — и это хорошая новость».
 * Для трёх полок это правда: не осталось запечатанного, брошенного на первом
 * часе, заброшенного — действительно хорошо. Для «Играю сейчас» ровно
 * наоборот: пусто значит, что за две недели человек не запускал ничего, и
 * поздравлять его с этим не за что.
 *
 * Строки живут рядом со списком фильтров, а не в разметке страницы: разъехаться
 * им негде. Полноту сторожит не тест, а тип: Record по Exclude<LibraryFilter,
 * 'all'> — добавить шестой фильтр и забыть про строку компилятор не даст.
 *
 * Полки «Все» в этом списке нет намеренно: пустая «Все» — это не пустая полка,
 * а пустая библиотека, и разговор там совсем другой (см. app/library/page.tsx).
 */
export const SHELF_EMPTY: Record<Exclude<LibraryFilter, 'all'>, string> = {
  untouched: 'Ни одной запечатанной: всё, что куплено, ты хотя бы открывал.',
  unplayed: 'Открыть и бросить на первом часе — не про тебя.',
  comeback: 'Заброшенных нет: ты возвращаешься к своим играм.',
  active: 'За две недели ты не запускал ничего.',
}


const FILTER_IDS = new Set<string>(LIBRARY_FILTERS.map((f) => f.id))

/**
 * ?state= приходит из URL, то есть это может быть что угодно: мусор, массив
 * (при `?state=a&state=b`) или ничего. Всё непонятное — общая сетка.
 */
export function parseLibraryFilter(raw: string | string[] | undefined): LibraryFilter {
  return typeof raw === 'string' && FILTER_IDS.has(raw) ? (raw as LibraryFilter) : 'all'
}

/**
 * СЕТКА ОТДАЁТСЯ ПОРЦИЯМИ, А НЕ ЦЕЛИКОМ.
 *
 * Страница рисовала всю полку разом. Замер на синтетической библиотеке в
 * тысячу игр: 2.3 МБ HTML, из них 1.4 МБ RSC, и тысяча клиентских плиток с
 * обложками — у коллекционера на три тысячи игр, ровно того, кому бэклог и
 * адресован, это под семь мегабайт на телефон.
 *
 * 48 — делится и на две колонки телефона, и на четыре десктопа, так что
 * последний ряд порции всегда полный. «Показать ещё» добавляет следующую
 * порцию к уже показанным (?page=N — сколько порций на экране), а не листает:
 * человек, долистав до кнопки, ищет глазами дальше, а не заново сверху.
 *
 * Счётчики на чипсах, деньги бэклога и сводка по-прежнему считаются по всей
 * библиотеке — порция касается только плиток.
 */
export const LIBRARY_PAGE_SIZE = 48

/**
 * ?page= приходит из URL: мусор, массив, ноль, минус — всё это первая
 * порция. Сверху номер ограничивает libraryPage, когда полка уже известна.
 */
export function parseLibraryPage(raw: string | string[] | undefined): number {
  if (typeof raw !== 'string' || !/^\d{1,6}$/.test(raw)) return 1
  return Math.max(1, Number(raw))
}

export type LibraryPage<T> = {
  /** Плитки на экране: первые page × size. */
  shown: T[]
  /** Сколько ещё за кнопкой. */
  rest: number
  /** Номер для ссылки «Показать ещё»; null — показано всё. */
  nextPage: number | null
}

export function libraryPage<T>(games: T[], page: number, size = LIBRARY_PAGE_SIZE): LibraryPage<T> {
  // Номер больше, чем порций, — это всё, а не пустая сетка: ссылку с ?page=99
  // могли сохранить до того, как библиотека похудела
  const pages = Math.max(1, Math.ceil(games.length / size))
  const p = Math.min(Math.max(1, Math.floor(page)), pages)
  const shown = games.slice(0, p * size)
  const rest = games.length - shown.length
  return { shown, rest, nextPage: rest > 0 ? p + 1 : null }
}

/**
 * Адрес полки. Смена фильтра сбрасывает порцию: у новой полки своя длина, и
 * «третья порция заброшенных» ничего не значит для нераспакованных.
 */
export function libraryHref(filter: LibraryFilter, page = 1): string {
  const qs = new URLSearchParams()
  if (filter !== 'all') qs.set('state', filter)
  if (page > 1) qs.set('page', String(page))
  const s = qs.toString()
  return s ? `/library?${s}` : '/library'
}

/**
 * Состояние плитки на стене /library — с поправкой на не-игры.
 *
 * libraryTileState знает только часы, и саундтрек с нулём минут для него «не
 * распакован». Счётчики бэклога не-игры не считают (looksLikeNonGame в
 * backlogValue и на портрете), и чипс «Не распакованы» обязан показать то же
 * число, что строка-сводка над ним, а ссылка «Все нераспакованные» — привести
 * ровно к ним. Поэтому не-игра в бэклоговых состояниях стоит нейтральной
 * плиткой: без подписи и вне полок бэклога, как пройденная. На полке «Все»
 * она остаётся — это библиотека, и саундтрек в ней правда есть.
 */
export function wallState(
  g: LibraryGame,
  meta: GameMeta | undefined,
  nowSec: number,
): LibraryTileState {
  const state = libraryTileState(g, nowSec)
  if ((state === 'untouched' || state === 'unplayed') && looksLikeNonGame(g, meta)) return 'played'
  return state
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
    const state = wallState(g, metaOf(g.appid), nowSec)
    if (state !== 'played') counts[state]++
  }

  const picked =
    filter === 'all'
      ? library
      : library.filter((g) => wallState(g, metaOf(g.appid), nowSec) === filter)

  // «Ни разу не запускал» ранжируется по вкусу: часов у этих игр нет вовсе, а
  // даты покупки Steam не отдаёт — вкус здесь единственный осмысленный порядок.
  // Остальные полки остаются на часах вниз, как было.
  const games =
    filter === 'untouched'
      ? rankByTaste(picked, metaOf, buildTagProfile(library, metaOf))
      : [...picked].sort((a, b) => b.playtimeForever - a.playtimeForever)

  return { games, counts }
}
