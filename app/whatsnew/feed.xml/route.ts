import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { getGamesMetaLite, type StoredNews } from '@/lib/db'
import { newsDescription, newsPageTitle, newsPath } from '@/lib/newspage'
import { rssFeed } from '@/lib/rss'
import { appBaseUrl, getDb, nowSec } from '@/lib/server'
import { cachedMajorFeed } from '@/lib/whatsnewcache'
import { FEED_LIMIT, FEED_RANK_FLOOR } from '@/lib/whatsnewfeed'

/**
 * RSS крупных патчей — та же общая лента, что видит гость на /whatsnew.
 *
 * Тот же кэш и те же числа (cachedMajorFeed, FEED_LIMIT, FEED_RANK_FLOOR):
 * лента в ридере и страница не расходятся, и оба крона уже сбрасывают этот
 * кэш по тегу news:major, когда появляется новое. Сама лента — статическая
 * с перегенерацией раз в десять минут: GET-ручки по умолчанию не кэшируются
 * вовсе (docs: route handlers, Caching), и каждый опрос ридера будил бы
 * функцию и базу. Число — литералом: revalidate обязан читаться статически.
 *
 * Адреса — от appBaseUrl, а не из запроса: под force-static заголовки
 * запроса пустые.
 */
export const dynamic = 'force-static'
export const revalidate = 600

async function readFeed(): Promise<{ items: StoredNews[]; names: Map<number, string> }> {
  try {
    const items = await cachedMajorFeed(FEED_LIMIT, FEED_RANK_FLOOR)
    const metas = await getGamesMetaLite(
      await getDb(),
      items.map((i) => i.appid),
    )
    return { items, names: new Map([...metas].map(([id, m]) => [id, m.name])) }
  } catch (err) {
    // На сборке без базы — пустой канал, как у хаба игр. При перегенерации
    // ошибка уходит наружу: ISR оставит прошлую ленту, а не закэширует пустую
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw err
    console.error('whatsnew/feed: лента недоступна на сборке, канал собран пустым —', String(err))
    return { items: [], names: new Map() }
  }
}

export async function GET(): Promise<Response> {
  const base = appBaseUrl()
  const { items, names } = await readFeed()
  const xml = rssFeed({
    title: 'Что нового — imbored',
    link: `${base}/whatsnew`,
    self: `${base}/whatsnew/feed.xml`,
    description: 'Крупные патчи популярных игр — коротко и по-русски.',
    builtAt: nowSec(),
    items: items.map((item) => {
      const game = names.get(item.appid)
      return {
        title: newsPageTitle(item.title, game),
        link: `${base}${newsPath(item.appid, item.gid)}`,
        publishedAt: item.publishedAt,
        description: newsDescription(item, game),
      }
    }),
  })
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } })
}
