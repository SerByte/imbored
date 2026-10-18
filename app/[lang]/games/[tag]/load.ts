import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { cache } from 'react'
import type { GameArtUrls } from '@/lib/art'
import { getGamesMetaLite, getLovedFor, topGamesByTags } from '@/lib/db'
import { descriptionFor } from '@/lib/gamedesc'
import { HUB_MIN_WEIGHT, HUB_PAGE, hubTagOf, hubTitle } from '@/lib/gamehub'
import { isRussianText } from '@/lib/gamepage'
import { reviewsBrief, sessionTrait, type GameTrait, type ReviewsBrief } from '@/lib/gametraits'
import type { Locale } from '@/lib/i18n'
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
  /**
   * Описание витрины на языке страницы, когда «за что любят» ещё не собрано:
   * на русской — только русское, на английской — только английское
   */
  about: string | null
}

export type Genre = { tag: string; slug: string; title: string; games: GenreGame[] }

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
  const ids = rows.map((r) => r.appid)
  // «За что любят» — слот своего языка: на /en нет английского — нет строки
  const [metas, loved] = await Promise.all([getGamesMetaLite(db, ids), getLovedFor(db, ids, locale)])
  return rows.map((r) => {
    const meta = metas.get(r.appid)
    return {
      appid: r.appid,
      name: r.name,
      headerImage: r.headerImage,
      art: r.art,
      reviews: reviewsBrief(meta?.reviewsPercent, meta?.reviewsTotal, locale),
      session: meta ? sessionTrait(meta, locale) : null,
      loved: loved.get(r.appid) ?? [],
      about: aboutOn(meta, locale),
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
 * locale — язык страницы: заголовок (hubTitle), строки отзывов и сессии,
 * «за что любят» и описание витрины. Список игр и порядок от языка не
 * зависят — у /en/games/<slug> те же игры, что у русской.
 *
 * cache — метаданные, страница и её JSON-LD читают один раз на запрос (ключ —
 * пара slug и язык).
 */
export const loadGenre = cache(async (slug: string, locale: Locale = 'ru'): Promise<Genre | null> => {
  const tag = hubTagOf(slug)
  if (!tag) return null
  const title = hubTitle(tag, locale)
  try {
    return { tag, slug, title, games: await readGenre(tag, locale) }
  } catch (err) {
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw err
    // Одной строкой: страниц тридцать, и тридцать стеков подряд заслоняли бы лог сборки
    console.error(`games/${slug}: каталог недоступен на сборке, страница собрана пустой —`, String(err))
    return { tag, slug, title, games: [] }
  }
})
