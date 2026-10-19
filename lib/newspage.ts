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
import { isEnglishText } from './englishtext'
import { dateLabel } from './freshness'
import { fmtDate, lp, tr, type Locale } from './i18n'
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

/**
 * Адрес патча с меткой воронки — для «Поделиться» (как pickShareUrl у выбора).
 * На языке страницы: с /en делятся английской страницей, а не русской.
 */
export function patchShareUrl(origin: string, appid: number, gid: string, locale: Locale = 'ru'): string {
  return withRef(`${origin}${lp(locale, newsPath(appid, gid))}`, 'patch')
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
 * Заголовок поста на языке страницы — то, что передаётся дальше как title:
 * в newsHeading, newsPageTitle, строку ленты и карточку игры (cardNews).
 *
 * ru — заголовок издателя как есть. en, по убыванию надёжности:
 *   1. titleEn — перевод модели (claudeNewsDigest пишет его только для
 *      заголовка с кириллицей, колонка title_en);
 *   2. сам заголовок, если он годится для /en (isEnglishText) или в нём нет
 *      ни одной буквы («1.0.3» языка не имеет);
 *   3. общий «{Game} update» — русского, китайского или немецкого заголовка
 *      на /en нет (docs/i18n.md, п. 9), а пустой строки у ссылки быть не
 *      должно. Без названия игры — просто «Update». Номер версии или сезона
 *      из заголовка издателя (patchToken) общий заголовок сохраняет:
 *      «Обновление 7.41d» — «Dota 2 update 7.41d», «Сезон 5» — «Destiny 2
 *      season 5 update». Без него все патчи игры с русским заголовком
 *      читались одной строкой — в ленте, в «Других патчах» и в h1.
 * Повторный вызов на результате ничего не меняет: каждый вариант английский,
 * а номер в общем заголовке находится в нём же снова.
 */
export function newsTitleOn(
  item: { title: string; titleEn?: string | null },
  gameName: string | null | undefined,
  locale: Locale = 'ru',
): string {
  if (locale !== 'en') return item.title
  const translated = item.titleEn?.trim()
  if (translated) return translated
  if (isEnglishText(item.title) || (item.title.trim() && !/\p{L}/u.test(item.title))) return item.title
  const name = gameName?.trim()
  const token = patchToken(item.title, name)
  if (token?.kind === 'season') return name ? `${name} season ${token.value} update` : `Season ${token.value} update`
  const generic = name ? `${name} update` : 'Update'
  return token ? `${generic} ${token.value}` : generic
}

/**
 * Номер версии: цифры через точку («7.41d», «3.0.436», «0.93L») или с «v» /
 * «ver» впереди («v0.9.6», «ver1.1.4», «v12»), буква в хвосте — часть номера.
 * Границы — не буква и не цифра: «2» из «Counter-Strike 2» номером не
 * считается, а название игры вырезается до поиска (withoutGameName).
 */
const VERSION_RE = /(?<![\p{L}\p{N}.])(?:(?:v|ver\.?)\d+(?:\.\d+)*|\d+(?:\.\d+)+)[a-z]?(?![\p{L}\p{N}]|\.\d)/giu

/**
 * Дата через точки — «12.08.2026», «03.12.25»: день, месяц и год из двух или
 * четырёх цифр. Это не версия: по-английски «12.08» читается и восьмым
 * декабря, а дату <title> патча ставит сам (newsPageTitle, коротким месяцем).
 */
const DOTTED_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/

function isDottedDate(token: string): boolean {
  const m = DOTTED_DATE_RE.exec(token)
  if (!m) return false
  const [day, month] = [Number(m[1]), Number(m[2])]
  return day >= 1 && day <= 31 && month >= 1 && month <= 12
}

/** Сезон: «Сезон 5», «5-й сезон», «начало сезона 12», «Season 5» */
const SEASON_RE = /(?<![\p{L}\p{N}])(?:(?:сезон[а-яё]{0,2}|season)\s*(\d{1,3})|(\d{1,3})(?:-?[а-яё]{1,2})?\s+сезон[а-яё]{0,2})(?![\p{L}\p{N}])/iu

/**
 * Что различает патчи игры в заголовке на любом языке — номер версии, иначе
 * номер сезона; null — ничего такого нет. Для общего «{Game} update»
 * (newsTitleOn): номер — не перевод, и в английском заголовке он тот же.
 */
export function patchToken(
  title: string,
  gameName?: string | null,
): { kind: 'version' | 'season'; value: string } | null {
  const text = withoutGameName(title, gameName)
  for (const [version] of text.matchAll(VERSION_RE)) {
    if (!isDottedDate(version)) return { kind: 'version', value: version }
  }
  const season = SEASON_RE.exec(text)
  const n = season?.[1] ?? season?.[2]
  return n ? { kind: 'season', value: String(Number(n)) } : null
}

/**
 * Заголовок патча на языке страницы без названия игры, которое стоит рядом, —
 * один для h1, карточки в чате, headline статьи и последней крошки.
 *
 * Общий «{Game} update» — ответ newsTitleOn посту без своего английского
 * заголовка — не режется: название игры в нём и есть весь заголовок, и
 * newsHeading оставил бы голое «Update» в h1, на карточке, в выдаче и в
 * крошках. С номером («Dota 2 update 7.41d») режется, как любой заголовок с
 * названием впереди: «Update 7.41d» — уже не пустое слово. Русский двойник
 * того же поста, «Обновление Counter-Strike 2», цел по той же причине:
 * название в конце, и stripGameName его не трогает. Общий заголовок —
 * ответ newsTitleOn для поста без заголовка, а не своя копия шаблона:
 * сменится шаблон — сменится и проверка. Русская страница — ровно
 * newsHeading, как было.
 */
export function patchHeading(
  item: { title: string; titleEn?: string | null },
  gameName: string | null | undefined,
  locale: Locale = 'ru',
): string {
  return headingOn(newsTitleOn(item, gameName, locale), gameName, locale)
}

/**
 * newsHeading, кроме общего «{Game} update» на /en — он целый (см.
 * patchHeading). title — уже ответ newsTitleOn. Одно правило на h1 и
 * <title>: иначе <title>, og:title и RSS резали бы его до «Update» и ставили
 * игру обратно через двоеточие — «Counter-Strike 2: Update», когда h1 и
 * карточка говорят «Counter-Strike 2 update».
 */
function headingOn(title: string, gameName: string | null | undefined, locale: Locale): string {
  if (locale === 'en' && title === newsTitleOn({ title: '' }, gameName, locale)) return title
  return newsHeading(title, gameName)
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
 *
 * По-английски — те же правила и «— what changed» (глоссарий docs/i18n.md).
 * Дата там — в скобках и коротким месяцем, как у остальных дат английской
 * версии: «Update (Aug 3, 2026)». Не «from Aug 3»: у заголовка из обычных
 * слов («Improved control options from Aug 3») предлог прилип бы к
 * последнему слову. Общий «{Game} update» (пост без английского заголовка)
 * не режется, как в h1 (headingOn): название в нём уже есть, и впереди оно
 * не повторяется — «Counter-Strike 2 update (Aug 12, 2026) — what changed».
 */
export function newsPageTitle(
  title: string,
  gameName: string | null | undefined,
  publishedAt?: number,
  locale: Locale = 'ru',
): string {
  const heading = headingOn(title, gameName, locale)
  const rest = withoutGameName(heading, gameName)
  const spelled = withoutGameName(heading, gameName, { caseSensitive: true }) !== heading
  const named = gameName && !spelled ? `${gameName}: ${heading}` : heading
  const dated = publishedAt !== undefined && !/\d/.test(rest)
  const date = dated
    ? tr(locale, {
        ru: ` от ${dateLabel(publishedAt, { year: true })}`,
        en: ` (${fmtDate('en', publishedAt, { month: 'short', day: 'numeric', year: 'numeric' })})`,
      })
    : ''
  return `${named}${date}${tr(locale, { ru: ' — что изменилось', en: ' — what changed' })}`
}

/**
 * meta description: пересказ, если он есть, иначе начало самого поста.
 *
 * Пересказ по правилу крона не длиннее 180 символов — чуть больше, чем
 * показывает выдача, — и обрезается тем же clip, что описание карточки игры:
 * по слову, с многоточием, целым предложением, если влезает.
 *
 * locale — язык страницы, и item.tldr вызывающий передаёт на нём (на /en —
 * английский пересказ). Начало поста на /en идёт, только если оно
 * английское (isEnglishText, docs/i18n.md, п. 9): издатель бывает пишет
 * патчноут по-русски, по-немецки или по-китайски, а чужой язык в английском
 * сниппете хуже заголовка. Заголовок запасного варианта — newsTitleOn: на
 * /en это titleEn или «{Game} update», а не русский заголовок издателя.
 */
export function newsDescription(
  item: { title: string; titleEn?: string | null; tldr?: string; blocks: NewsBlock[] },
  gameName: string | null | undefined,
  locale: Locale = 'ru',
): string {
  const tldr = item.tldr?.replace(/\s+/g, ' ').trim()
  if (tldr) return clip(tldr, DESCRIPTION_MAX) ?? tldr.slice(0, DESCRIPTION_MAX)
  const body = blocksToText(item.blocks, 600).replace(/[•\s]+/g, ' ').trim()
  if (body && (locale !== 'en' || isEnglishText(body))) {
    return clip(body, DESCRIPTION_MAX) ?? body.slice(0, DESCRIPTION_MAX)
  }
  const fallback = `${newsPageTitle(newsTitleOn(item, gameName, locale), gameName, undefined, locale)}.`
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
 *    Steam, gid под GID. «Патч» здесь — записанный kind: тела у строки нет,
 *    и сверить её с нынешним правилом классификатора, как loadPatch
 *    (isStoredPatch в lib/news), этот модуль не может. Карточка игры такие
 *    строки отсеивает раньше, в loadGamePage; лента /whatsnew — после
 *    переопроса игры;
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
