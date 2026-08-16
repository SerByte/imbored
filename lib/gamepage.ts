import {
  getGameJson,
  getGameMeta,
  getGameNews,
  topGamesByTag,
  type SimilarGame,
  type StoredNews,
} from './db'
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
  /** соседи по самому характерному тегу; пусто, если тегов нет */
  similar: SimilarGame[]
  /** по какому тегу они подобраны — он же стоит в заголовке блока */
  similarTag: string | null
}

/**
 * Самый характерный тег игры.
 *
 * Вес в tags_json — это характерность (доля от максимума), а не популярность,
 * поэтому «первый по весу» и означает «чем эта игра является больше всего».
 * Тай-брейк по имени обязателен: страница кэшируется на сутки и пререндерится,
 * и блок «похожие» не должен меняться от того, в каком порядке Object.entries
 * вернул ключи после очередной пересборки каталога.
 */
export function topTagOf(meta: GameMeta): string | null {
  const entries = Object.entries(meta.tags ?? {})
  if (!entries.length) return null
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return entries[0][0]
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
  // Соседей ищем и для чужих магазинов: тег у такой записи есть, а вот патчей
  // и отзывов Steam про неё нет — поэтому блок «похожие» стоит ДО раннего
  // возврата, а не после
  const topTag = topTagOf(meta)
  const similarOf = async () => (topTag ? topGamesByTag(db, topTag, appid) : [])

  if (appid < 0) {
    return {
      meta,
      reviewsSummary: null,
      prosCons: null,
      news: [],
      similar: await similarOf(),
      similarTag: topTag,
    }
  }

  const [reviewsSummary, stored, news, similar] = await Promise.all([
    getGameJson(db, appid, 'reviews_summary_json') as Promise<GamePageData['reviewsSummary']>,
    getGameJson(db, appid, 'pros_cons_json') as Promise<GamePageData['prosCons']>,
    getGameNews(db, appid, 8),
    similarOf(),
  ])

  /*
   * Наружу отдаём ТОЛЬКО собранное моделью.
   *
   * Эвристический вариант — это первые предложения самых залайканных отзывов
   * Steam, как есть. На витрине это выглядело так: китайский, испанский,
   * зацензуренный мат и прямая непристойность в блоке «за что любят» — на
   * русскоязычной странице, лежащей в карте сайта. Отбор по числу голосов
   * этого не чинит, скорее наоборот: залайкивают как раз шутки.
   *
   * Правило стоит здесь, а не в разметке, чтобы его нельзя было обойти новым
   * потребителем и чтобы оно было покрыто тестом.
   *
   * В базе эвристику при этом храним: source: 'reviews' и есть тот маркер, по
   * которому карточка вернётся в очередь на пересборку моделью (см.
   * claimPageEnrichBatch, redoHeuristic).
   */
  const prosCons = stored?.source === 'claude' ? stored : null

  return { meta, reviewsSummary, prosCons, news, similar, similarTag: topTag }
}
