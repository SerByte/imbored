/**
 * Страница пересказа патча — /game/<appid>/news/<gid>.
 *
 * Русские пересказы патчей — единственный текст проекта, которого нет больше
 * нигде: Steam отдаёт пост как есть, агрегаторы его переписывают, а tldr
 * здесь собран один раз кроном новостей и лежит в news_items. Своего адреса
 * у него не было: пересказ жил строкой ленты /whatsnew и раскрывашкой на
 * карточке игры, а ссылка из обоих мест вела наружу, в Steam. Запрос вида
 * «обновление CS2 19 августа что изменилось» ранжировать было нечему.
 *
 * Здесь — всё, что про страницу решается без базы и без Next: адрес, проверка
 * gid, заголовок, описание, индексировать ли. Модуль клиентобезопасный: его
 * читают островки ленты и карточки, чтобы построить ссылку.
 */
import { clip, DESCRIPTION_MAX } from './clip'
import { stripGameName } from './patchtitle'
import { blocksToText, type NewsBlock } from './steamhtml'

/**
 * Каким бывает gid. Приходит строкой из чужого ответа Steam (хвост
 * permalink'а поста) и едет в адрес страницы и в SQL параметром — мусор
 * произвольной длины не пускаем ни туда, ни туда. То же правило раньше жило
 * литералом в app/api/news.
 */
const GID = /^[A-Za-z0-9_-]{1,64}$/

export function isNewsGid(gid: unknown): gid is string {
  return typeof gid === 'string' && GID.test(gid)
}

/** Адрес страницы патча. gid под GID кодирования не требует, но адрес строится один раз и здесь */
export function newsPath(appid: number, gid: string): string {
  return `/game/${appid}/news/${encodeURIComponent(gid)}`
}

/**
 * Окно карты сайта: крупные патчи за последние девяносто дней. Старше —
 * страницы остаются по ссылкам со страницы игры и из соседних патчей, но
 * краулера туда специально не зовём: «что изменилось в патче полугодовой
 * давности» ищут редко, а место в бюджете обхода у карточек игр.
 */
export const SITEMAP_NEWS_WINDOW_SEC = 90 * 86_400

/**
 * Страховка по объёму, а не бюджет: протокол держит 50 000 адресов в одном
 * файле, и первыми их занимают карточки игр (app/sitemap.ts).
 */
export const SITEMAP_NEWS_MAX = 5000

/** Заголовок патча без названия игры, которое на странице стоит строкой выше */
export function newsHeading(title: string, gameName: string | null | undefined): string {
  return gameName ? stripGameName(title, gameName) : title.trim()
}

/**
 * <title> страницы: игра, патч и вопрос, ради которого её ищут.
 *
 * Имя игры впереди, потому что с ним приходит запрос («обновление CS2…»), а
 * заголовок Steam начинается с него лишь у каждого пятого поста (замер в
 * lib/patchtitle: 19 из 107) — остальные вида «Патч 2.31» сами по себе
 * ничего не называют.
 */
export function newsPageTitle(title: string, gameName: string | null | undefined): string {
  const heading = newsHeading(title, gameName)
  return gameName ? `${gameName}: ${heading} — что изменилось` : `${heading} — что изменилось`
}

/**
 * meta description: пересказ, если он есть, иначе начало самого поста.
 *
 * Пересказ по правилу крона не длиннее 180 символов — чуть больше, чем
 * показывает выдача, — и обрезается тем же clip, что описание карточки игры:
 * по слову, с многоточием, целым предложением, если влезает.
 */
export function newsDescription(
  item: { title: string; tldr?: string; blocks: NewsBlock[] },
  gameName: string | null | undefined,
): string {
  const tldr = item.tldr?.replace(/\s+/g, ' ').trim()
  if (tldr) return clip(tldr, DESCRIPTION_MAX) ?? tldr.slice(0, DESCRIPTION_MAX)
  const body = blocksToText(item.blocks, 600).replace(/[•\s]+/g, ' ').trim()
  if (body) return clip(body, DESCRIPTION_MAX) ?? body.slice(0, DESCRIPTION_MAX)
  const fallback = `${newsPageTitle(item.title, gameName)}.`
  return clip(fallback, DESCRIPTION_MAX) ?? fallback.slice(0, DESCRIPTION_MAX)
}

/**
 * Пускать ли страницу в индекс.
 *
 * Только с пересказом: без него страница — копия поста Steam, и в выдаче
 * она спорила бы с оригиналом, проигрывая ему по определению. И только у
 * живой игры каталога — по той же логике, по какой карточка мёртвой игры
 * стоит с noindex (app/game/[appid]/page.tsx): патч игры, которую мы сами не
 * советуем, — не то, что стоит находить поиском.
 *
 * Без индекса страница остаётся открытой по ссылке: с неё ведут «Оригинал в
 * Steam» и карточка игры, а follow у robots остаётся.
 */
export function newsIndexable(tldr: string | null | undefined, listed: boolean): boolean {
  return Boolean(tldr?.trim()) && listed
}
