import { cache } from 'react'
import { getNewsPage } from '@/lib/db'
import { isEnglishText } from '@/lib/englishtext'
import type { Locale } from '@/lib/i18n'
import { isStoredPatch } from '@/lib/news'
import { isNewsGid, newsHeading, newsTitleOn } from '@/lib/newspage'
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
 * «Не патч» решается по нынешнему правилу, а не только по записанному kind
 * (isStoredPatch): дорожная карта, записанная патчем до правки
 * классификатора, иначе стояла бы страницей «— что изменилось» до переопроса
 * игры, а то и всегда. Вердикт модели «не патч» (scale 'none') приходит сюда
 * уже как kind 'news' — его читает rowToNews в lib/db. Правило смотрит в
 * заголовок и тело издателя — до перевода, одно на оба языка.
 *
 * Общий для головы и самой страницы: заголовок вкладки, превью в чате и h1
 * обязаны говорить об одном посте одно. cache — generateMetadata и сама
 * страница рендерят один запрос, база читается однажды; язык — в ключе
 * вместе с адресом.
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
  if (!page || !isStoredPatch(page.item)) return null
  if (locale !== 'en') return page
  const { tldrEn, blocks } = page.item
  const item = { ...page.item, blocks: isEnglishText(blocksToText(blocks, 600)) ? blocks : [] }
  delete item.tldr
  delete item.tldrEn
  if (tldrEn) item.tldr = tldrEn
  return { ...page, item }
})

/**
 * Заголовок патча на языке страницы без названия игры, которое стоит рядом, —
 * один для h1, последней крошки и JSON-LD.
 *
 * Общий «{Game} update» — то, что newsTitleOn даёт посту без своего
 * английского заголовка, — не режется: название игры в нём и есть весь
 * заголовок, и newsHeading оставил бы голое «Update» в h1, в крошках и в
 * выдаче. Русский двойник того же поста, «Обновление Counter-Strike 2», цел
 * по той же причине: название в конце, и stripGameName его не трогает.
 * Общий заголовок — ответ newsTitleOn для поста без заголовка, а не своя
 * копия шаблона: сменится шаблон — сменится и проверка.
 */
export function patchHeading(
  item: { title: string; titleEn?: string | null },
  gameName: string | null | undefined,
  locale: Locale = 'ru',
): string {
  const title = newsTitleOn(item, gameName, locale)
  if (locale === 'en' && title === newsTitleOn({ title: '' }, gameName, locale)) return title
  return newsHeading(title, gameName)
}
