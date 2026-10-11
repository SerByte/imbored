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
import { dateLabel } from './freshness'
import { stripGameName, withoutGameName } from './patchtitle'
import { blocksToText, type NewsBlock } from './steamhtml'
import { withRef } from './track'

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

/** Адрес патча с меткой воронки — для «Поделиться» (как pickShareUrl у выбора) */
export function patchShareUrl(origin: string, appid: number, gid: string): string {
  return withRef(`${origin}${newsPath(appid, gid)}`, 'patch')
}

/**
 * Окно карты сайта: крупные патчи за последние девяносто дней. Старше —
 * страница остаётся по ссылкам, пока патч среди последних у своей игры:
 * заголовком на карточке игры (восемь последних, в серверной разметке — см.
 * indexedNewsPath) и в «Других патчах» на страницах остальных (шесть
 * последних). Краулера туда специально не зовём: «что изменилось в патче
 * полугодовой давности» ищут редко, а место в бюджете обхода у карточек игр.
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
 * ничего не называют. Впереди — только если его нет в самом заголовке:
 * «Counter-Strike 2: Обновление Counter-Strike 2» — это одно имя дважды.
 *
 * «Есть в заголовке» — С УЧЁТОМ РЕГИСТРА, как пишется имя собственное. Многие
 * игры названы обычными словами — Control, Inside, Raft, Prey, Thief, — и без
 * регистра «Improved control options» сходил за заголовок с именем игры:
 * <title>, og:title, карточка «Поделиться» и RSS теряли «Control:» впереди,
 * то есть ровно то, с чего начинается запрос. Что остаётся неразличимым —
 * заголовок, где С Заглавной Каждое Слово («Improved Control Options»): там
 * слово от имени не отличить, и имя впереди не повторяется. Цифрам и дате
 * регистр по-прежнему не важен — их решает rest.
 *
 * ДАТА — КОГДА ЗАГОЛОВОК ПАТЧИ ИГРЫ НЕ РАЗЛИЧАЕТ. Valve выпускает каждое
 * обновление CS2 под одной строкой «Обновление Counter-Strike 2»: в локальной
 * базе их восемнадцать подряд, и все страницы патчей верхней игры каталога (а
 * значит, и верха карты сайта) получали один <title>, og:title и заголовок в
 * RSS. В выдаче и ридерах это выглядело одной страницей, повторённой много
 * раз, и Google такие заголовки переписывает сам. Признак «различает» — цифра в
 * заголовке без названия игры: номер версии («Патч 2.31») или дата («Release
 * Notes for 9/25/2026») — а «2» из «Counter-Strike 2» версией не является.
 * Дата — та же, что на карточке патча (dateLabel с годом, зона закреплена).
 *
 * publishedAt необязателен: без него заголовок прежний. h1, крошки и
 * headline статьи дату не получают — под h1 она и так стоит строкой
 * (NewsDate), а у статьи есть datePublished.
 */
export function newsPageTitle(
  title: string,
  gameName: string | null | undefined,
  publishedAt?: number,
): string {
  const heading = newsHeading(title, gameName)
  const rest = withoutGameName(heading, gameName)
  const spelled = withoutGameName(heading, gameName, { caseSensitive: true }) !== heading
  const named = gameName && !spelled ? `${gameName}: ${heading}` : heading
  const dated = publishedAt !== undefined && !/\d/.test(rest)
  return `${named}${dated ? ` от ${dateLabel(publishedAt, { year: true })}` : ''} — что изменилось`
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

/**
 * Адрес страницы патча для заголовка строки — или null, если ссылку давать
 * не нужно.
 *
 * Заголовок патча на карточке игры и в ленте /whatsnew — обычная ссылка в
 * серверном HTML. Раньше ссылка на страницу патча была только внутри
 * раскрытой строки, а раскрывает строку клиент, и в HTML её не было вовсе:
 * замер на проде — на карточке Elden Ring ноль ссылок вида /game/…/news/…,
 * хотя её патч стоит в карте сайта. Страницы патчей держались на одной
 * карте сайта, а та знает только девяносто дней.
 *
 * Ссылку получает страница, которая есть и идёт в поиск:
 *  - есть — то же, что пропускает loadPatch: патч, а не распродажа, appid
 *    Steam, gid под GID;
 *  - в поиске — newsIndexable. «Игра в каталоге» здесь — rank > 0, тот же
 *    признак, по которому патч попадает в карту сайта и в IndexNow: вес
 *    (getGameRanks) получают только игры ALIVE_POOL.
 *
 * Без пересказа страница — копия поста Steam с noindex, и звать туда
 * краулера с пяти тысяч карточек значит тратить обход на то, что он всё
 * равно выбросит. У хотфиксов пересказа не бывает вовсе: очередь пересказов
 * их не берёт. Человеку такая страница открыта как раньше — ссылкой
 * «Отдельной страницей» в раскрытой строке.
 */
export function indexedNewsPath(item: {
  appid: number
  gid: string
  kind: string
  rank: number
  tldr?: string | null
}): string | null {
  if (item.kind !== 'patch' || !(item.appid > 0) || !isNewsGid(item.gid)) return null
  return newsIndexable(item.tldr, item.rank > 0) ? newsPath(item.appid, item.gid) : null
}
