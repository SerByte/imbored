/**
 * Какую ленту показывать — личную или общую. ОДНА ветка на два вызова:
 * серверный рендер /whatsnew и опрос головы ленты из /api/whatsnew/head.
 *
 * Ветка выглядит простой ровно до того момента, как её копируют. Она
 * состояния: «личная лента пуста» превращает гостя в зрителя общей ленты и
 * убирает переключатель, а на общей вкладке личная лента запрашивается ради
 * одного ответа — есть ли она вообще. Стоит опросу переписать это своими
 * словами, и в день, когда у человека появится первый личный патч, страница
 * будет рисовать один набор игр, а плашка считать новинки по другому.
 *
 * Обобщено по типу строки, а не скопировано под «полную» и «голову»: копии
 * разошлись бы на первом же изменении LIBRARY_CAP. Ровно тот класс ошибки,
 * ради которого написан докблок lib/warmup.ts.
 */

/** Сколько игр библиотеки берём в личную ленту */
export const LIBRARY_CAP = 300
export const FEED_LIMIT = 30

/**
 * Ниже этого веса игра в общую ленту не попадает. rank — это MAX(отзывы,
 * онлайн). Живёт здесь, а не в странице, потому что тем же порогом обязан
 * пользоваться опрос: иначе плашка обещает обновления, которых в ленте нет.
 */
export const FEED_RANK_FLOOR = 10_000

type LibraryLike = { appid: number; playtimeForever: number }

/**
 * Топ библиотеки для ленты.
 *
 * Добивка по appid не украшение: Array.prototype.sort стабилен по спеке, так
 * что сегодня страница и опрос совпадают по удаче — из-за одинакового порядка
 * входных данных. На границе в триста игр, где две игры с равным
 * playtimeForever разрезаются пополам, совпадение должно быть доказуемым, а
 * не удачным.
 */
export function topLibraryAppids(games: readonly LibraryLike[], cap = LIBRARY_CAP): number[] {
  return [...games]
    .sort((a, b) => b.playtimeForever - a.playtimeForever || a.appid - b.appid)
    .slice(0, cap)
    .map((g) => g.appid)
}

export type FeedChoice<T> = {
  items: T[]
  /** Показываем общую ленту: явный выбор вкладки или пустая личная */
  showPopular: boolean
  /** Есть ли личная лента вообще — от этого зависит, рисовать ли переключатель */
  hasMine: boolean
}

export async function resolveWhatsNew<T>(opts: {
  steamid: string | null
  wantsPopular: boolean
  snapshot: (steamid: string) => Promise<{ games: LibraryLike[] } | null>
  forApps: (appids: number[], limit: number) => Promise<T[]>
  major: (limit: number, minRank: number) => Promise<T[]>
  limit?: number
  libraryCap?: number
  rankFloor?: number
}): Promise<FeedChoice<T>> {
  const limit = opts.limit ?? FEED_LIMIT
  const cap = opts.libraryCap ?? LIBRARY_CAP
  const floor = opts.rankFloor ?? FEED_RANK_FLOOR

  let mine: T[] = []
  if (opts.steamid) {
    const snap = await opts.snapshot(opts.steamid)
    if (snap?.games.length) {
      // На общей вкладке личная лента нужна ради одного ответа — «есть ли она
      // вообще». Просить под это тридцать записей значит прочитать сто
      // двадцать строк и выбросить их.
      mine = await opts.forApps(topLibraryAppids(snap.games, cap), opts.wantsPopular ? 1 : limit)
    }
  }

  const hasMine = mine.length > 0
  const showPopular = opts.wantsPopular || !hasMine
  const items = showPopular ? await opts.major(limit, floor) : mine
  return { items, showPopular, hasMine }
}
