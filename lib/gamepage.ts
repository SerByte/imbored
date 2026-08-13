import { fetchAppDetails, fetchStoreItems, mergeMeta } from './catalog'
import {
  getGameJson,
  getGameMeta,
  getGameNews,
  setGameJson,
  upsertGameMeta,
  type StoredNews,
} from './db'
import { claudeProsCons } from './llm'
import { fetchReviews, heuristicProsCons, type ParsedReviews } from './reviews'
import { getDb, nowSec } from './server'
import type { GameMeta } from './types'

export type GamePageData = {
  meta: GameMeta
  reviewsSummary: {
    scoreDesc: string
    totalPositive: number
    totalNegative: number
  } | null
  prosCons: { pros: string[]; cons: string[]; source: 'claude' | 'reviews' } | null
  /** патчноуты — только чтение из базы, наполняет их крон */
  news: StoredNews[]
}

/**
 * Собирает данные карточки игры: метаданные (догружая appdetails при
 * необходимости), вердикт отзывов и pros/cons (кэшируются в SQLite).
 */
export async function loadGamePage(appid: number): Promise<GamePageData | null> {
  const db = await getDb()
  const now = nowSec()

  let meta = await getGameMeta(db, appid)

  // Отрицательные appid — кураторский пул других магазинов: у Steam про них
  // ничего нет, показываем только собственные данные
  if (appid < 0) return meta ? { meta, reviewsSummary: null, prosCons: null, news: [] } : null

  if (!meta || !meta.screenshots || !meta.shortDescription) {
    const fresh = await fetchAppDetails(appid).catch(() => null)
    if (fresh) {
      if (meta && Object.keys(meta.tags).length) fresh.tags = meta.tags
      await upsertGameMeta(db, fresh, now)
      meta = fresh
    }
  }
  if (!meta) return null

  if (!Object.keys(meta.tags).length) {
    // SteamSpy отдаёт 403 с серверных IP — теги берём из GetItems
    const [fromStore] = await fetchStoreItems([appid]).catch(() => [])
    if (fromStore && Object.keys(fromStore.tags).length) {
      meta = mergeMeta(meta, fromStore)
      await upsertGameMeta(db, meta, now)
    }
  }

  let reviewsSummary = (await getGameJson(db, appid, 'reviews_summary_json')) as
    | GamePageData['reviewsSummary']
    | null
  let prosCons = (await getGameJson(db, appid, 'pros_cons_json')) as GamePageData['prosCons'] | null

  if (!reviewsSummary || !prosCons) {
    const parsed: ParsedReviews | null = await fetchReviews(appid).catch(() => null)
    if (parsed) {
      reviewsSummary = {
        scoreDesc: parsed.scoreDesc,
        totalPositive: parsed.totalPositive,
        totalNegative: parsed.totalNegative,
      }
      await setGameJson(db, appid, 'reviews_summary_json', reviewsSummary)

      const fromClaude = await claudeProsCons(meta.name, parsed.reviews)
      if (fromClaude && (fromClaude.pros.length || fromClaude.cons.length)) {
        prosCons = { ...fromClaude, source: 'claude' }
      } else {
        const h = heuristicProsCons(parsed.reviews, 4)
        prosCons = h.pros.length || h.cons.length ? { ...h, source: 'reviews' } : null
      }
      if (prosCons) await setGameJson(db, appid, 'pros_cons_json', prosCons)
    }
  }

  // Только чтение: наполняет патчноуты крон. Ходить за ними в сеть прямо
  // здесь нельзя — страница публичная и обходится краулером по всему
  // пространству appid, это был бы усилитель запросов к Steam.
  const news = await getGameNews(db, appid, 8)

  return { meta, reviewsSummary, prosCons, news }
}
