import { trimArt, type GameArtUrls } from './art'
import type { GameMeta } from './types'
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

/**
 * Дальше этого срока патч из твоей библиотеки новостью не считается.
 *
 * Без порога личная лента добивает список вглубь, пока не кончатся записи, —
 * и библиотека, где игры патчатся редко, гарантированно даёт хвост в годы.
 * Замер на живой библиотеке: 12 карточек возрастом 15, 37, 101, 172, 323, 351,
 * 394, 487, 625, 1340, 1781 и 1964 дня. Страница называется «Что нового», и
 * патч пятилетней давности на ней — ложь независимо от причины.
 *
 * Три месяца, а не месяц: игра, патчащаяся раз в квартал, всё ещё твоя
 * новость, а вот прошлогодняя — уже архив.
 */
export const MINE_FRESH_SEC = 90 * 86_400

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
  /**
   * Сколько первых записей — из твоей библиотеки. Остальные добиты из общей.
   * На общей вкладке равно длине списка.
   */
  mineCount: number
}

/**
 * Порядок здесь НЕ хронологический, и это намеренно.
 *
 * Слить оба источника и отсортировать по дате — первое, что приходит в голову,
 * и оно ломает смысл вкладки: популярное свежее (0–8 дней против 15+ у
 * библиотеки), поэтому оно вытеснило бы твои игры вниз, а обложкой на вкладке
 * «в твоих играх» встала бы чужая игра. Личный блок идёт первым целиком,
 * добивка — после него, с видимой границей.
 */
export async function resolveWhatsNew<T extends { appid: number; publishedAt: number }>(opts: {
  steamid: string | null
  wantsPopular: boolean
  nowSec: number
  snapshot: (steamid: string) => Promise<{ games: LibraryLike[] } | null>
  forApps: (appids: number[], limit: number) => Promise<T[]>
  major: (limit: number, minRank: number) => Promise<T[]>
  limit?: number
  libraryCap?: number
  rankFloor?: number
  freshSec?: number
}): Promise<FeedChoice<T>> {
  const limit = opts.limit ?? FEED_LIMIT
  const cap = opts.libraryCap ?? LIBRARY_CAP
  const floor = opts.rankFloor ?? FEED_RANK_FLOOR
  const freshSec = opts.freshSec ?? MINE_FRESH_SEC

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

  const fresh = mine.filter((i) => opts.nowSec - i.publishedAt <= freshSec)

  /*
   * Переключатель показываем ровно тогда, когда есть ЧТО показать на второй
   * вкладке, — то есть по свежим, а не по всем найденным.
   *
   * Через mine.length это давало тупик. Библиотека, где все крупные патчи
   * старше трёх месяцев: hasMine истинно, значит страница рисует две вкладки;
   * showPopular тоже истинно, значит «В популярных играх» помечается
   * aria-current="page" — находясь при этом по адресу /whatsnew без
   * параметра. Вкладка «В твоих играх» ведёт на текущий адрес, вторая — на
   * тот же набор строк. Переключить ленту нельзя ни с одного из двух адресов,
   * и подсветка врёт про то, где ты стоишь.
   *
   * Правило «вкладка, ведущая в пустоту, хуже её отсутствия» было записано
   * абзацем ниже с самого начала — просто hasMine считался по другой мерке.
   */
  const hasMine = fresh.length > 0

  // Вкладка, ведущая в пустоту, хуже её отсутствия: если по твоим играм за
  // три месяца не набралось ничего, показываем общую целиком — ровно как
  // гостю, у которого библиотеки нет вовсе.
  if (opts.wantsPopular || !fresh.length) {
    const items = await opts.major(limit, floor)
    return { items, showPopular: true, hasMine, mineCount: items.length }
  }

  if (fresh.length >= limit) {
    return { items: fresh.slice(0, limit), showPopular: false, hasMine, mineCount: limit }
  }

  // Добираем из общей, выбрасывая игры, которые уже показаны выше: одна и та
  // же игра дважды в одной ленте выглядит поломкой, а не полнотой. Просим с
  // запасом ровно на возможные пересечения.
  const seen = new Set(fresh.map((i) => i.appid))
  const pop = await opts.major(limit + fresh.length, floor)
  const topup = pop.filter((i) => !seen.has(i.appid)).slice(0, limit - fresh.length)

  return { items: [...fresh, ...topup], showPopular: false, hasMine, mineCount: fresh.length }
}

/**
 * Метаданные игры В ТОМ ОБЪЁМЕ, который лента правда читает.
 *
 * Cover и PatchRow — клиентские островки, а значит всё, что им передано,
 * уезжает в разметку сериализованным. Им отдавали GameMeta целиком, хотя из
 * него открывают СЕМЬ полей: имя, студию, год, арт, запасную ссылку на арт,
 * онлайн и признак бесплатности. Остальное — теги, категории, жанры,
 * скриншоты, описание, вся ценовая пятёрка, три поля отзывов, магазин,
 * издатель, признаки живости — ехало мёртвым грузом.
 *
 * Тип узкий НАМЕРЕННО, а не «то же самое, только поменьше»: попытка прочитать
 * выброшенное поле теперь не собирается, и никто не вернёт его случайно.
 *
 * Арт режется trimArt под вариант card: hero и hero2x в ленте не открывает
 * никто, а весят они столько же строкой, сколько и остальные.
 */
export type FeedMeta = Pick<
  GameMeta,
  'name' | 'developer' | 'releaseYear' | 'headerImage' | 'ccu' | 'isFree'
> & { art?: GameArtUrls | null }

export function feedMeta(meta: GameMeta | undefined): FeedMeta | undefined {
  if (!meta) return undefined
  return {
    name: meta.name,
    developer: meta.developer,
    releaseYear: meta.releaseYear,
    headerImage: meta.headerImage,
    ccu: meta.ccu,
    isFree: meta.isFree,
    art: trimArt(meta.art),
  }
}
