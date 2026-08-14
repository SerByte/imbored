import { getGameJson, getGameMeta, getGameNews, type StoredNews } from './db'
import { getDb } from './server'
import type { GameMeta } from './types'

export type GamePageData = {
  meta: GameMeta
  reviewsSummary: {
    scoreDesc: string
    totalPositive: number
    totalNegative: number
  } | null
  prosCons: { pros: string[]; cons: string[]; source: 'claude' | 'reviews' } | null
  news: StoredNews[]
}

/**
 * Собирает данные карточки игры. ТОЛЬКО ЧТЕНИЕ ИЗ БАЗЫ — ни одного сетевого
 * вызова и ни одного обращения к модели.
 *
 * Это главное правило страницы, и оно стоило дорого, пока не соблюдалось.
 * Раньше здесь на промахе кэша вызывались appdetails, appreviews и Claude.
 * Страница публичная, кэша у неё не было, а в каталоге 6000 живых игр, у
 * которых ни один из этих полей не был заполнен, — то есть один проход
 * поискового краулера означал 6000 вызовов модели и 12000 запросов к Steam.
 * Злоумышленник для этого не нужен, достаточно карты сайта.
 *
 * Ровно это правило уже было сформулировано двадцатью строками ниже для
 * патчноутов — просто не применено к остальным полям. Теперь всё, что требует
 * сети, живёт в lib/pagejob.ts и ходит по расписанию с бюджетом и темпом.
 *
 * Следствие, с которым надо считаться: игры, до которой очередь ещё не дошла,
 * карточка покажет без скриншотов и без pros/cons. Это правильный компромисс —
 * неполная страница дешевле неограниченного счёта.
 */
export async function loadGamePage(appid: number): Promise<GamePageData | null> {
  const db = await getDb()

  const meta = await getGameMeta(db, appid)
  // Незнакомый appid — это и есть тот случай, ради которого всё написано:
  // краулер, перебирающий пространство идентификаторов, должен получать 404
  // после одного чтения из базы, а не запускать наполнение каталога.
  if (!meta) return null

  // Отрицательные appid — кураторский пул других магазинов: у Steam про них
  // ничего нет, показываем только собственные данные
  if (appid < 0) return { meta, reviewsSummary: null, prosCons: null, news: [] }

  const [reviewsSummary, prosCons, news] = await Promise.all([
    getGameJson(db, appid, 'reviews_summary_json') as Promise<GamePageData['reviewsSummary']>,
    getGameJson(db, appid, 'pros_cons_json') as Promise<GamePageData['prosCons']>,
    getGameNews(db, appid, 8),
  ])

  return { meta, reviewsSummary, prosCons, news }
}
