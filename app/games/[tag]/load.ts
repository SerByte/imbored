import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { cache } from 'react'
import type { GameArtUrls } from '@/lib/art'
import { getGamesMetaLite, getLovedFor, topGamesByTags } from '@/lib/db'
import { HUB_GENRES, HUB_MIN_WEIGHT, HUB_PAGE, hubTagOf } from '@/lib/gamehub'
import { isRussianText } from '@/lib/gamepage'
import { reviewsBrief, sessionTrait, type GameTrait, type ReviewsBrief } from '@/lib/gametraits'
import { getDb } from '@/lib/server'

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
  return rows.map((r) => {
    const meta = metas.get(r.appid)
    const about = meta?.shortDescription?.trim()
    return {
      appid: r.appid,
      name: r.name,
      headerImage: r.headerImage,
      art: r.art,
      reviews: reviewsBrief(meta?.reviewsPercent, meta?.reviewsTotal),
      session: meta ? sessionTrait(meta) : null,
      loved: loved.get(r.appid) ?? [],
      about: about && isRussianText(about) ? about : null,
    }
  })
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
