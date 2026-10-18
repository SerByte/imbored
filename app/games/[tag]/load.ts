import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { cache } from 'react'
import type { GameArtUrls } from '@/lib/art'
import { getGamesMetaLite, getLovedFor, topGamesByTags } from '@/lib/db'
import { HUB_GENRES, HUB_MIN_WEIGHT, HUB_PAGE, hubTagOf } from '@/lib/gamehub'
import { isRussianText } from '@/lib/gamepage'
import { reviewsBrief, sessionTrait, shownReviews, type GameTrait, type ReviewsBrief } from '@/lib/gametraits'
import { getDb } from '@/lib/server'

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
  /** Описание витрины, если оно по-русски, — когда «за что любят» ещё не собрано */
  about: string | null
}

export type Genre = { tag: string; slug: string; title: string; games: GenreGame[] }

async function readGenre(tag: string): Promise<GenreGame[]> {
  const db = await getDb()
  // Тот же запрос и тот же порог, что у полки хаба, — одним тегом: план
  // проверен в lib/queryplan («хаб игр»), и «для кого жанр главный» здесь
  // значит то же, что на /games
  const rows = await topGamesByTags(db, [tag], { minWeight: HUB_MIN_WEIGHT, perTag: HUB_PAGE })
  const ids = rows.map((r) => r.appid)
  const [metas, loved] = await Promise.all([getGamesMetaLite(db, ids), getLovedFor(db, ids)])
  const tiles = rows.map((r) => {
    const meta = metas.get(r.appid)
    const about = meta?.shortDescription?.trim()
    const shown = meta ? shownReviews(meta) : null
    const game: GenreGame = {
      appid: r.appid,
      name: r.name,
      headerImage: r.headerImage,
      art: r.art,
      reviews: reviewsBrief(shown?.percent, shown?.total),
      session: meta ? sessionTrait(meta) : null,
      loved: loved.get(r.appid) ?? [],
      about: about && isRussianText(about) ? about : null,
    }
    return { game, total: shown?.total ?? null }
  })
  return byShownTotal(tiles)
}

/**
 * Порядок плиток — по тем отзывам, что на них напечатаны.
 *
 * Отбирает игры жанра topGamesByTags, и по англоязычному reviews_total: та же
 * шкала, что у порядка пула и у соседних полок хаба, и менять её здесь значило
 * бы, что /games и /games/<slug> собирают разный верх. Но плитка печатает все
 * языки (shownReviews), номер места стоит в её углу, а шапка обещает «порядок
 * — по числу отзывов в Steam». У игр, которые больше хвалят не по-английски
 * (китайские и японские хиты), доля английских совсем другая, и по порядку
 * отбора полка показала бы №1 «из 400 тыс.» прямо над №2 «из 1 млн» — то же
 * «одно из чисел выдумано», от которого и заведено одно правило показа.
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
 * Страница жанра: игры, для которых жанр главный, по числу отзывов.
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
  if (!tag) return null
  const { title } = HUB_GENRES[tag]
  try {
    return { tag, slug, title, games: await readGenre(tag) }
  } catch (err) {
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw err
    // Одной строкой: страниц тридцать, и тридцать стеков подряд заслоняли бы лог сборки
    console.error(`games/${slug}: каталог недоступен на сборке, страница собрана пустой —`, String(err))
    return { tag, slug, title, games: [] }
  }
})
