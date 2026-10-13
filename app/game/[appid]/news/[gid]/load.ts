import { cache } from 'react'
import { getNewsPage } from '@/lib/db'
import { isStoredPatch } from '@/lib/news'
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
 * «Не патч» решается по нынешнему правилу, а не только по записанному kind
 * (isStoredPatch): дорожная карта, записанная патчем до правки
 * классификатора, иначе стояла бы страницей «— что изменилось» до переопроса
 * игры, а то и всегда. Вердикт модели «не патч» (scale 'none') приходит сюда
 * уже как kind 'news' — его читает rowToNews в lib/db.
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
  return page && isStoredPatch(page.item) ? page : null
})
