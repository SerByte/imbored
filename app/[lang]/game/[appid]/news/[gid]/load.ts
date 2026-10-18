import { cache } from 'react'
import { getNewsPage } from '@/lib/db'
import { isNewsGid } from '@/lib/newspage'
import { getDb } from '@/lib/server'

/**
 * Пост с игрой или null — на всё, чего страницы нет: кривой appid или gid,
 * поста нет в базе, пост не патч.
 *
 * Не патч — тоже 404: в news_items лежат и распродажи с анонсами (их
 * отсеивает классификатор lib/news), но ни лента, ни карточка игры на них не
 * ссылаются, и выставлять их отдельными страницами незачем.
 *
 * Общий для страницы и её карточки в чате (opengraph-image.tsx): заголовок
 * вкладки и превью обязаны говорить об одном посте одно. cache —
 * generateMetadata и сама страница рендерят один запрос, база читается
 * однажды.
 */
export const loadPatch = cache(async (rawAppid: string, rawGid: string) => {
  const appid = Number(rawAppid)
  if (!Number.isInteger(appid) || appid <= 0 || !isNewsGid(rawGid)) return null
  const page = await getNewsPage(await getDb(), appid, rawGid)
  return page && page.item.kind === 'patch' ? page : null
})
