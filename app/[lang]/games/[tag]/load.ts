import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { cache } from 'react'
import type { GameArtUrls } from '@/lib/art'
import { getGamesMetaLite, getLovedFor, topGamesByFacet, topGamesByTags, type Db, type SimilarGame } from '@/lib/db'
import { descriptionFor } from '@/lib/gamedesc'
import {
  facetCopy,
  HUB_MIN_SHELF,
  HUB_MIN_WEIGHT,
  HUB_PAGE,
  hubFacetOf,
  hubTagOf,
  hubTitle,
  playsAgainst,
  type HubFacet,
} from '@/lib/gamehub'
import { isRussianText } from '@/lib/gamepage'
import { reviewsBrief, sessionTrait, shownReviews, type GameTrait, type ReviewsBrief } from '@/lib/gametraits'
import type { Locale } from '@/lib/i18n'
import { seedable } from '@/lib/roomseed'
import { getDb } from '@/lib/server'
import type { GameMeta } from '@/lib/types'

export type GenreGame = {
  appid: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
  /**
   * «92% из 48 тыс.» — доля положительных отзывов Steam на всех языках: та же
   * пара, что кольцо на карточке игры (shownReviews), а не англоязычная шкала
   * порогов, которая печаталась здесь втрое меньшим числом
   */
  reviews: ReviewsBrief | null
  /** «Сессия: ~40 мин» — только из уверенной семантики (lib/gametraits) */
  session: GameTrait | null
  /** «За что любят» — только собранное моделью (getLovedFor) */
  loved: string[]
  /**
   * Описание витрины на языке страницы, когда «за что любят» ещё не собрано:
   * на русской — только русское, на английской — только английское
   */
  about: string | null
  /**
   * «Позвать в эту игру» под карточкой — только у подборок про компанию
   * (HubFacet.party) и только у игры, которую комната возьмёт первой картой:
   * та же мерка seedable, что у кнопки на странице игры. Иначе кнопка звала
   * бы в игру, которую колода пати молча снимет.
   */
  invite: boolean
}

/**
 * Страница сегмента /games/<slug>: жанр (по тегу) или подборка по факту
 * (HUB_FACETS). Вид у них один, и всё общее — список, крошки, разметка,
 * карточка для чатов — читает общие поля; разное — kind.
 */
export type Genre = { slug: string; title: string; games: GenreGame[] } & (
  | { kind: 'genre'; tag: string }
  | { kind: 'facet'; facet: HubFacet }
)

/**
 * Тонкая страница: список короче полки хаба (HUB_MIN_SHELF). Страница есть,
 * но в поиск её не пускаем — список из трёх игр не ответ.
 *
 * Одно правило на noindex страницы (generateMetadata) и на карту сайта
 * (app/sitemap.ts): адрес, который страница закрывает от индекса, карта
 * краулеру предлагать не должна — Search Console записывает это ошибкой
 * самой карты («Submitted URL marked noindex»), а не страницы.
 */
export function thinList(games: readonly GenreGame[]): boolean {
  return games.length < HUB_MIN_SHELF
}

/**
 * Строки выборки — в игры страницы: отзывы, сессия, «за что любят». Отсев
 * подборки (keep) и потолок HUB_PAGE — по порядку отбора, а уже отобранные
 * плитки встают по напечатанному на них числу (byShownTotal).
 *
 * locale — только подписи: строки отзывов и сессии, «за что любят» своего
 * языка и описание витрины (aboutOn). Отбор, отсев и порядок от языка не
 * зависят: у /en/games/<slug> те же игры в том же порядке.
 */
async function enrich(
  db: Db,
  rows: readonly SimilarGame[],
  locale: Locale,
  opts: { keep?: (meta: GameMeta) => boolean; invite?: boolean } = {},
): Promise<GenreGame[]> {
  const ids = rows.map((r) => r.appid)
  // «За что любят» — слот своего языка: на /en нет английского — нет строки
  const [metas, loved] = await Promise.all([getGamesMetaLite(db, ids), getLovedFor(db, ids, locale)])
  const tiles: Array<{ game: GenreGame; total: number | null }> = []
  for (const r of rows) {
    if (tiles.length >= HUB_PAGE) break
    const meta = metas.get(r.appid)
    // Без строки меты отбор по ней не проверить — такой игры подборка не обещает
    if (opts.keep && (!meta || !opts.keep(meta))) continue
    const shown = meta ? shownReviews(meta) : null
    const game: GenreGame = {
      appid: r.appid,
      name: r.name,
      headerImage: r.headerImage,
      art: r.art,
      reviews: reviewsBrief(shown?.percent, shown?.total, locale),
      session: meta ? sessionTrait(meta, locale) : null,
      loved: loved.get(r.appid) ?? [],
      about: aboutOn(meta, locale),
      invite: Boolean(opts.invite && meta && seedable(meta)),
    }
    tiles.push({ game, total: shown?.total ?? null })
  }
  return byShownTotal(tiles)
}

/**
 * Порядок плиток — по тем отзывам, что на них напечатаны.
 *
 * Отбирают игры topGamesByTags (жанр) и topGamesByFacet (подборка), обе — по
 * англоязычному reviews_total: та же шкала, что у порядка пула и у соседних
 * полок хаба, и менять её здесь значило бы, что /games и /games/<slug>
 * собирают разный верх. Но плитка печатает все языки (shownReviews), номер
 * места стоит в её углу, а шапка обещает «порядок — по числу отзывов в
 * Steam». У игр, которые больше хвалят не по-английски (китайские и японские
 * хиты), доля английских совсем другая, и по порядку отбора полка показала бы
 * №1 «из 400 тыс.» прямо над №2 «из 1 млн» — то же «одно из чисел выдумано»,
 * от которого и заведено одно правило показа.
 *
 * Поэтому внутри отобранного плитки с числами встают по своему числу, а
 * плитка без чисел (сверка до игры не дошла) остаётся на месте отбора: ей
 * спорить нечем, и прыжок в хвост был бы таким же выдуманным порядком.
 * Сортировка устойчивая — при равных числах порядок отбора.
 */
function byShownTotal(tiles: ReadonlyArray<{ game: GenreGame; total: number | null }>): GenreGame[] {
  const counted = tiles.filter((t) => t.total !== null).sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
  let next = 0
  return tiles.map((t) => (t.total === null ? t.game : counted[next++].game))
}

/**
 * Описание витрины, годное странице этого языка, — или null.
 *
 * Правило зеркальное: чужой абзац посреди страницы хуже, чем ничего. На
 * русской — описание, только если оно русское (до прохода крона там бывает
 * английский текст прогрева). На английской — descriptionFor: английский
 * слот карточки или своё описание, если оно правда английское; русского на
 * /en нет вовсе (docs/i18n.md).
 */
function aboutOn(meta: Parameters<typeof descriptionFor>[0], locale: Locale): string | null {
  if (locale === 'en') return descriptionFor(meta, locale)?.trim() || null
  const about = meta?.shortDescription?.trim()
  return about && isRussianText(about) ? about : null
}

async function readGenre(tag: string, locale: Locale): Promise<GenreGame[]> {
  const db = await getDb()
  // Тот же запрос и тот же порог, что у полки хаба, — одним тегом: план
  // проверен в lib/queryplan («хаб игр»), и «для кого жанр главный» здесь
  // значит то же, что на /games
  const rows = await topGamesByTags(db, [tag], { minWeight: HUB_MIN_WEIGHT, perTag: HUB_PAGE })
  return enrich(db, rows, locale)
}

/**
 * Что выбрасывает подборка уже по строке игры (HubFacet.drop).
 *
 * «Матч» — словами карточки: sessionTrait называет заход «Матчем» или
 * «Сессией», и «на 20 минут» берёт только «Сессию». Своё правило здесь
 * разошлось бы с карточкой — подборка обещала бы короткий заход, а карточка
 * той же игры называла бы его матчем.
 *
 * sessionTrait здесь — без языка, то есть с русской подписью, и это логика,
 * а не вывод: отсев один на обе версии страницы и сверяется с той же
 * «Сессией», каким бы ни был язык страницы.
 */
function keeper(facet: HubFacet): ((meta: GameMeta) => boolean) | undefined {
  if (facet.drop === 'versus') return (meta) => !playsAgainst(meta.tags)
  if (facet.drop === 'match') return (meta) => sessionTrait(meta)?.label === 'Сессия'
  return undefined
}

/**
 * Запас выборки, когда подборка ещё отсеивает по строке: вдвое. Замер на
 * каталоге — из сорока верхних «кооперативных» по отзывам соперничество
 * перевешивает у шести (Dota 2, Rainbow Six, Apex, Marvel Rivals, Overwatch,
 * THE FINALS), из восьмидесяти — у десяти: без запаса страница вышла бы
 * короче сорока, с ним остаётся семьдесят кандидатов. Цена запаса — вдвое
 * длиннее проход по верху idx_games_pool (он останавливается на limit-й
 * подходящей игре), а не скан таблицы; раз в неделю, на ISR.
 */
const FACET_FETCH = HUB_PAGE * 2

async function readFacet(facet: HubFacet, locale: Locale): Promise<GenreGame[]> {
  const db = await getDb()
  const keep = keeper(facet)
  const rows = await topGamesByFacet(db, facet.query, keep ? FACET_FETCH : HUB_PAGE)
  return enrich(db, rows, locale, { keep, invite: facet.party })
}

/**
 * Страница жанра или подборки: игры по числу отзывов.
 *
 * null — такого адреса нет (страница отдаёт 404). Решается без базы, по
 * списку жанров и подборок: страница стоит под dynamicParams = true, и
 * чужой slug доходит сюда, а не отсекается сборкой. Пустой список — только
 * на сборке без базы, как у хаба (app/games/page.tsx, loadHub): при
 * перегенерации на проде ошибка уходит наружу намеренно, и ISR оставляет
 * прошлую версию, а не кэширует пустую страницу на неделю.
 *
 * locale — язык страницы: заголовок (hubTitle у жанра, facetCopy у
 * подборки), строки отзывов и сессии, «за что любят» и описание витрины.
 * Список игр и порядок от языка не зависят — у /en/games/<slug> те же игры,
 * что у русской.
 *
 * cache — метаданные, страница и её JSON-LD читают один раз на запрос (ключ —
 * пара slug и язык).
 */
export const loadGenre = cache(async (slug: string, locale: Locale = 'ru'): Promise<Genre | null> => {
  const tag = hubTagOf(slug)
  const facet = tag ? null : hubFacetOf(slug)
  if (!tag && !facet) return null
  const head = tag
    ? { kind: 'genre' as const, tag, slug, title: hubTitle(tag, locale) }
    : { kind: 'facet' as const, facet: facet!, slug, title: facetCopy(facet!, locale).title }
  try {
    return { ...head, games: await (tag ? readGenre(tag, locale) : readFacet(facet!, locale)) }
  } catch (err) {
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw err
    // Одной строкой: страниц три десятка, и столько стеков подряд заслоняли бы лог сборки
    console.error(`games/${slug}: каталог недоступен на сборке, страница собрана пустой —`, String(err))
    return { ...head, games: [] }
  }
})
