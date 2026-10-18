import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { cache } from 'react'
import type { GameArtUrls } from '@/lib/art'
import { getGamesMetaLite, getLovedFor, topGamesByFacet, topGamesByTags, type Db, type SimilarGame } from '@/lib/db'
import {
  HUB_GENRES,
  HUB_MIN_WEIGHT,
  HUB_PAGE,
  hubFacetOf,
  hubTagOf,
  playsAgainst,
  type HubFacet,
} from '@/lib/gamehub'
import { isRussianText } from '@/lib/gamepage'
import { reviewsBrief, sessionTrait, type GameTrait, type ReviewsBrief } from '@/lib/gametraits'
import { seedable } from '@/lib/roomseed'
import { getDb } from '@/lib/server'
import type { GameMeta } from '@/lib/types'

export type GenreGame = {
  appid: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
  /** «92% из 48 тыс.» — доля положительных отзывов Steam */
  reviews: ReviewsBrief | null
  /** «Сессия: ~40 мин» — только из уверенной семантики (lib/gametraits) */
  session: GameTrait | null
  /** «За что любят» — только собранное моделью (getLovedFor) */
  loved: string[]
  /** Описание витрины, если оно по-русски, — когда «за что любят» ещё не собрано */
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

/** Строки выборки — в игры страницы: отзывы, сессия, «за что любят» */
async function enrich(
  db: Db,
  rows: readonly SimilarGame[],
  opts: { keep?: (meta: GameMeta) => boolean; invite?: boolean } = {},
): Promise<GenreGame[]> {
  const ids = rows.map((r) => r.appid)
  const [metas, loved] = await Promise.all([getGamesMetaLite(db, ids), getLovedFor(db, ids)])
  const out: GenreGame[] = []
  for (const r of rows) {
    if (out.length >= HUB_PAGE) break
    const meta = metas.get(r.appid)
    // Без строки меты отбор по ней не проверить — такой игры подборка не обещает
    if (opts.keep && (!meta || !opts.keep(meta))) continue
    const about = meta?.shortDescription?.trim()
    out.push({
      appid: r.appid,
      name: r.name,
      headerImage: r.headerImage,
      art: r.art,
      reviews: reviewsBrief(meta?.reviewsPercent, meta?.reviewsTotal),
      session: meta ? sessionTrait(meta) : null,
      loved: loved.get(r.appid) ?? [],
      about: about && isRussianText(about) ? about : null,
      invite: Boolean(opts.invite && meta && seedable(meta)),
    })
  }
  return out
}

async function readGenre(tag: string): Promise<GenreGame[]> {
  const db = await getDb()
  // Тот же запрос и тот же порог, что у полки хаба, — одним тегом: план
  // проверен в lib/queryplan («хаб игр»), и «для кого жанр главный» здесь
  // значит то же, что на /games
  const rows = await topGamesByTags(db, [tag], { minWeight: HUB_MIN_WEIGHT, perTag: HUB_PAGE })
  return enrich(db, rows)
}

/**
 * Что выбрасывает подборка уже по строке игры (HubFacet.drop).
 *
 * «Матч» — словами карточки: sessionTrait называет заход «Матчем» или
 * «Сессией», и «на 20 минут» берёт только «Сессию». Своё правило здесь
 * разошлось бы с карточкой — подборка обещала бы короткий заход, а карточка
 * той же игры называла бы его матчем.
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
 * подходящей игре), а не скан таблицы; раз в сутки, на ISR.
 */
const FACET_FETCH = HUB_PAGE * 2

async function readFacet(facet: HubFacet): Promise<GenreGame[]> {
  const db = await getDb()
  const keep = keeper(facet)
  const rows = await topGamesByFacet(db, facet.query, keep ? FACET_FETCH : HUB_PAGE)
  return enrich(db, rows, { keep, invite: facet.party })
}

/**
 * Страница жанра или подборки: игры по числу отзывов.
 *
 * null — такого адреса нет (страница отдаёт 404). Пустой список — только на
 * сборке без базы, как у хаба (app/games/page.tsx, loadHub): при перегенерации
 * на проде ошибка уходит наружу намеренно, и ISR оставляет прошлую версию, а
 * не кэширует пустую страницу на сутки.
 *
 * cache — метаданные, страница и её JSON-LD читают один раз на запрос.
 */
export const loadGenre = cache(async (slug: string): Promise<Genre | null> => {
  const tag = hubTagOf(slug)
  const facet = tag ? null : hubFacetOf(slug)
  if (!tag && !facet) return null
  const head = tag
    ? { kind: 'genre' as const, tag, slug, title: HUB_GENRES[tag].title }
    : { kind: 'facet' as const, facet: facet!, slug, title: facet!.title }
  try {
    return { ...head, games: await (tag ? readGenre(tag) : readFacet(facet!)) }
  } catch (err) {
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw err
    // Одной строкой: страниц три десятка, и столько стеков подряд заслоняли бы лог сборки
    console.error(`games/${slug}: каталог недоступен на сборке, страница собрана пустой —`, String(err))
    return { ...head, games: [] }
  }
})
