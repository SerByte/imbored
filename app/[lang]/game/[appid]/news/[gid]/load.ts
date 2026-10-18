import { cache } from 'react'
import { getNewsPage } from '@/lib/db'
import { isEnglishText } from '@/lib/englishtext'
import type { Locale } from '@/lib/i18n'
import { isNewsGid } from '@/lib/newspage'
import { getDb } from '@/lib/server'
import { blocksToText } from '@/lib/steamhtml'

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
 * однажды; язык — в ключе вместе с адресом.
 *
 * НА ЯЗЫКЕ СТРАНИЦЫ. На /en item.tldr — английский пересказ (StoredNews.tldrEn)
 * или его нет вовсе: русского пересказа на /en нет (docs/i18n.md, п. 8), и
 * дальше — в «In short», description, индекс и JSON-LD — идёт одно поле
 * своего языка (newsDescription, newsIndexable и patchArticleLd читают
 * item.tldr). Тело на /en — только английское, тем же правилом, что ридер /en
 * (getRssFeedForApps) и начало поста в newsDescription: isEnglishText над
 * первыми 600 знаками. Иначе блоков нет, и страница говорит, что оригинал в
 * Steam. Заголовок не трогается: title и titleEn едут как прочитаны, а
 * подпись строит newsTitleOn у того, кто её рисует, — так её же построит и
 * JSON-LD. Русская страница получает пост как есть.
 */
export const loadPatch = cache(async (rawAppid: string, rawGid: string, locale: Locale = 'ru') => {
  const appid = Number(rawAppid)
  if (!Number.isInteger(appid) || appid <= 0 || !isNewsGid(rawGid)) return null
  const page = await getNewsPage(await getDb(), appid, rawGid)
  if (!page || page.item.kind !== 'patch') return null
  if (locale !== 'en') return page
  const { tldrEn, blocks } = page.item
  const item = { ...page.item, blocks: isEnglishText(blocksToText(blocks, 600)) ? blocks : [] }
  delete item.tldr
  delete item.tldrEn
  if (tldrEn) item.tldr = tldrEn
  return { ...page, item }
})
