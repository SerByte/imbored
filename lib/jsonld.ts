import { discountOf, trustedPrice } from './discount'
import { DEFAULT_LOCALE, htmlLang, lp, tr, type Locale } from './i18n'
import { newsHeading, newsPath } from './newspage'
import { OG_SITE, siteDescription } from './site'
import { STORE_LABEL } from './stores'
import { tagLabel } from './tagsru'
import { isRussianText } from './textlang'
import type { GameMeta } from './types'

/**
 * Микроразметка карточки игры для поисковиков.
 *
 * Зачем вообще: пять тысяч страниц `/game/[appid]` — это весь органический
 * вход сайта (см. app/sitemap.ts, там пять служебных адресов и пять тысяч
 * игровых). Цена, жанры, разработчик и путь через жанр лежали только в
 * вёрстке, то есть для робота не существовали. Цена прямо в выдаче стоит
 * дороже любой правки самой страницы: она меняет не то, что человек увидит
 * после клика, а то, случится ли клик.
 *
 * ОЦЕНКИ ЗДЕСЬ НЕТ, И ЭТО РЕШЕНИЕ, А НЕ ПРОПУСК. Был aggregateRating из доли
 * положительных отзывов Steam — ради звёзд в выдаче. Но правила Google для
 * review snippet прямо запрещают размечать оценки, собранные на другом сайте:
 * рейтинг обязан приходить от посетителей самой страницы, а мы пересказываем
 * Steam. Звёзд такая разметка не получает, а на пяти тысячах шаблонных
 * страниц это ровно узор ручной санкции за «spammy structured markup» — она
 * снимает расширенные сниппеты со всего сайта, вместе с крошками и статьями
 * патчей. Кольцо отзывов на странице остаётся: правило про разметку, а не про
 * видимое. Вернуть оценку можно будет только свою, собранную здесь же.
 *
 * Главное правило модуля — РАЗМЕТКА НЕ ГОВОРИТ БОЛЬШЕ, ЧЕМ СТРАНИЦА.
 * Расхождение видимого и размеченного Google считает нарушением и снимает
 * расширенный сниппет целиком, поэтому:
 *   - цена проходит через discountOf — ту же проверку срока годности замера,
 *     что и витрина, иначе в выдаче повисла бы скидка, которой на странице
 *     уже нет;
 *   - ничего, чего на странице нет, здесь не появляется.
 *
 * Чистая функция без обращения к базе и окружению: страница уже прочитала всё
 * это для собственной отрисовки, второй раз читать незачем.
 */

type Org = { '@type': 'Organization'; name: string }

export type GameLd = {
  '@context': 'https://schema.org'
  '@type': 'VideoGame'
  name: string
  url: string
  gamePlatform: 'PC'
  description?: string
  image?: string
  genre?: string[]
  playMode?: string[]
  datePublished?: string
  /** 'ru' — только когда Steam отметил русский и только на русской странице; см. gameJsonLd */
  inLanguage?: 'ru'
  author?: Org
  publisher?: Org
  offers?: {
    '@type': 'Offer'
    price: string
    priceCurrency: string
    availability: string
    seller: Org
    url?: string
    priceValidUntil?: string
  }
}

/**
 * Сколько тегов уходит в genre, если своих жанров у игры нет.
 *
 * Восемь — не круглое число, а ровно столько чипсов рисует герой карточки
 * (см. topTags в app/game/[appid]/page.tsx). Разметка обязана совпадать с
 * видимым, поэтому и список, и его длина берутся оттуда.
 */
const TAGS_AS_GENRE = 8

/**
 * Абсолютный адрес страницы на языке разметки: '/game/730' → …/en/game/730.
 *
 * Разметка /en-страницы обязана называть ту же страницу, что её canonical
 * (localeAlternates в lib/site.ts): url и mainEntityOfPage на русский адрес
 * при canonical на английский — две разные страницы для робота. Тексты
 * разметки (названия крошек) — те же, что видит человек, и переводятся
 * вместе со страницей.
 */
function at(baseUrl: string, locale: Locale, path: string): string {
  return `${baseUrl}${lp(locale, path)}`
}

/** «Игры по жанрам» — та же подпись, что в видимой строке пути (глоссарий docs/i18n.md) */
function genresCrumb(locale: Locale): string {
  return tr(locale, { ru: 'Игры по жанрам', en: 'Games by genre' })
}

/**
 * Описание игры для разметки на языке страницы. Русская страница — как было:
 * short_description как лежит. Английская — только нерусское: на /en
 * страница русского описания не показывает, а разметка не говорит больше
 * страницы.
 *
 * Временная замена descriptionFor (lib/gamedesc) — та же, что в
 * gameDescription (lib/gamepage): когда чтение карточки отдаст английское
 * описание отдельным полем, обе ветки возьмут его оттуда.
 */
function ldDescription(meta: Pick<GameMeta, 'shortDescription'>, locale: Locale): string | undefined {
  const text = meta.shortDescription
  if (!text) return undefined
  return locale === 'en' && isRussianText(text) ? undefined : text
}

export type GameLdInput = {
  meta: GameMeta
  /** абсолютный адрес сайта — schema.org требует полных ссылок */
  baseUrl: string
  /** язык страницы: адреса в разметке — на нём (по умолчанию ru) */
  locale?: Locale
  /**
   * ISO 4217 региона цен — regionCurrency(priceRegion()) из lib/steamregion.
   * Цена в мете всегда этого региона: чужую rowToMeta не отдаёт вовсе.
   */
  currency: string
  now: number
}

/**
 * Категории Steam -> GamePlayMode схемы.
 *
 * Порядок задан здесь, а не приходит из meta.categories, и это важно: страница
 * кэшируется на неделю и пререндерится, а порядок категорий в ответе Steam
 * между пересборками каталога не гарантирован. Разметка не должна меняться от
 * того, в каком порядке они легли в базу.
 */
const PLAY_MODES: Array<[number[], string]> = [
  [[2], 'SinglePlayer'],
  [[1], 'MultiPlayer'],
  [[9, 38], 'CoOp'],
]

export function gameJsonLd({
  meta,
  baseUrl,
  locale = DEFAULT_LOCALE,
  currency,
  now,
}: GameLdInput): GameLd {
  const ld: GameLd = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: meta.name,
    url: at(baseUrl, locale, `/game/${meta.appid}`),
    // Каталог — только PC-игры: и Steam, и кураторский пул других магазинов.
    gamePlatform: 'PC',
  }

  const description = ldDescription(meta, locale)
  if (description) ld.description = description
  const image = meta.art?.header2x ?? meta.art?.header ?? meta.headerImage
  if (image) ld.image = image
  // Жанры Steam, а если их нет — те же теги, что нарисованы чипсами в герое.
  //
  // Ветка не теоретическая: в проде genres_json пуст почти везде (каталог
  // собирается из поиска магазина, а тот жанров не отдаёт), зато теги есть у
  // всех — «Souls-like», «Open World», «Dark Fantasy». Без запасного варианта
  // genre не появлялся бы вовсе там, где на странице стоит восемь чипсов.
  //
  // Тай-брейк по имени обязателен по той же причине, что и в topTagOf:
  // страница пререндерится и кэшируется на неделю, а порядок ключей после
  // очередной пересборки каталога не гарантирован.
  //
  // Теги — подписями на языке страницы (tagLabel), как на чипсах: разметка
  // обязана совпадать с видимым. Порядок — по английским ключам, до перевода,
  // как у страницы.
  //
  // Жанры Steam у игры русские (appdetails с l=russian) — русской странице
  // они годятся, а английской нет: там genre — всегда теги, их ключи и есть
  // английские подписи чипсов.
  const fromTags = () =>
    Object.entries(meta.tags ?? {})
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TAGS_AS_GENRE)
      .map(([t]) => tagLabel(t, locale))
  const genre = meta.genres.length && locale !== 'en' ? meta.genres : fromTags()
  if (genre.length) ld.genre = genre

  const modes = PLAY_MODES.filter(([ids]) => ids.some((id) => meta.categories.includes(id))).map(
    ([, mode]) => mode,
  )
  if (modes.length) ld.playMode = modes

  // Год, а не дата: в базе лежит releaseDate в локали Steam («21 Aug, 2012»),
  // разбирать её обратно в ISO незачем — releaseYear уже разобран каталогом,
  // а голый год schema.org принимает как частичный ISO 8601.
  if (meta.releaseYear) ld.datePublished = String(meta.releaseYear)
  /*
   * Русский в игре — из той же ступени, что строка «Русский: …» на странице
   * (languageTrait в lib/gametraits), но условия у них разные: строка — когда
   * Steam ответил (в том числе «нет»), inLanguage — только когда ответ «есть».
   * Любая отметка Steam — интерфейс, субтитры или озвучка — значит, что
   * содержимое игры есть по-русски.
   *
   * При «нет» поля нет: других языков игры мы не храним, а «русского нет» не
   * повод назвать какой-то другой — inLanguage со списком наугад был бы ровно
   * той разметкой, которая говорит больше страницы.
   *
   * На /en поля нет тоже: строки «Русский» там нет (languageTrait на en —
   * null), а английского языка игры мы не знаем.
   */
  if (locale !== 'en' && meta.ruLang !== undefined && meta.ruLang > 0) ld.inLanguage = 'ru'
  if (meta.developer) ld.author = { '@type': 'Organization', name: meta.developer }
  if (meta.publisher) ld.publisher = { '@type': 'Organization', name: meta.publisher }

  // aggregateRating сюда не возвращать — почему, в докблоке модуля
  const offers = offersOf(meta, currency, now)
  if (offers) ld.offers = offers

  return ld
}

function offersOf(meta: GameMeta, currency: string, now: number): GameLd['offers'] {
  // «Не продаётся в российском Steam» — предложения нет, в том числе
  // бесплатного: InStock про игру, которую в этом регионе не взять, был бы
  // неправдой. Видимое на странице говорит то же — PriceTag ставит «не
  // продаётся» раньше «бесплатно» (lib/pricetag.test.ts)
  if (meta.storeHidden) return undefined
  // Free-to-play приезжает без price_final вовсе — у Steam этого поля для
  // таких игр нет. Ноль здесь не догадка: страница в этом же случае рисует
  // «бесплатно», и разметка обязана говорить то же самое.
  if (meta.priceFinal === undefined && !meta.isFree) return undefined

  /*
   * Цене, которой не верит витрина, не место и в выдаче — тем более там.
   *
   * При протухшей скидке price_final это акционное число без акции: у Heavy
   * Rain в базе стояло $0.99 при настоящих $19.99. Показать такое человеку
   * плохо, а отдать поисковику — хуже: Offer живёт в индексе дольше страницы
   * и попадает в сниппет, по которому кликают.
   *
   * Проверка — на момент рендера, а карточка живёт в кэше неделю. Поэтому
   * скидку, погасшую уже после рендера, из разметки убирает не она, а крон
   * карточек: сбрасывает адрес, когда срок доверия вышел (revalidateEndedDeals
   * в lib/gamecache).
   */
  const trusted = meta.isFree ? 0 : trustedPrice(meta, now)
  if (trusted === null) return undefined
  /*
   * Ноль без isFree — не «бесплатно», а «цены нет». Поиск магазина кладёт «0»
   * в data-price-final игре, которую не продают вовсе (делист, снята с
   * продажи): так в базе лежат Ori and the Blind Forest и Call of Duty, с
   * пустым is_free. Герой страницы рисует строку цены только при
   * `isFree || storeHidden || price > 0` (app/game/[appid]/page.tsx), то есть
   * о таких играх молчит, — а разметка говорила «0.00, в наличии», и в выдаче
   * платная игра выходила бесплатной.
   *
   * Сюда же раздача −100%: discountOf отдаёт её скидкой с finalCents 0, но
   * страница по тому же условию прячет строку целиком, вместе с процентом и
   * сроком. Разметка идёт за видимым, а не за скидкой. Совпадение двух сторон
   * сторожит app/game/[appid]/page.test.ts на отрисованной странице.
   */
  if (!meta.isFree && trusted <= 0) return undefined

  const deal = discountOf(meta, now)
  /*
   * isFree СИЛЬНЕЕ цены, и порядок тут не вкусовой — он повторяет PriceTag,
   * который решает то же самое для страницы: `if (isFree || priceFinal === 0)`
   * стоит у него раньше цены, сразу за «не продаётся» (оно отсеяно выше).
   * Ветка «priceFinal === 0» у PriceTag героя не касается: ноль без isFree
   * до него не доходит — ни здесь (отсеян выше), ни на странице.
   *
   * Случай не выдуманный, он найден на живом деплое: у Counter-Strike 2 в
   * базе одновременно is_free = 1 и price_final = 1499 — это цена Prime, а
   * не игры. Страница показывала «бесплатно», разметка успевала сказать
   * «$14.99», и получалось ровно то расхождение видимого и размеченного, за
   * которое Google снимает расширенный сниппет целиком.
   */
  const cents = meta.isFree ? 0 : deal ? deal.finalCents : trusted

  const url =
    meta.storeUrl ?? (meta.appid > 0 ? `https://store.steampowered.com/app/${meta.appid}/` : undefined)

  return {
    '@type': 'Offer',
    price: (cents / 100).toFixed(2),
    priceCurrency: currency,
    availability: 'https://schema.org/InStock',
    // Продаём не мы, и разметка не должна давать повод так подумать: оффер
    // принадлежит магазину, ссылка ведёт туда же. Без seller тот же набор
    // полей читается как «этот сайт продаёт игру за $59.99».
    seller: { '@type': 'Organization', name: STORE_LABEL[meta.store ?? ''] ?? 'Steam' },
    ...(url ? { url } : {}),
    // Срок ставим только названный самим Steam. Без него discountOf держит
    // скидку на доверии к возрасту замера, а такому сроку в выдаче не место:
    // priceValidUntil — это обещание, а не оценка.
    ...(deal?.endsAt !== undefined
      ? { priceValidUntil: new Date(deal.endsAt * 1000).toISOString().slice(0, 10) }
      : {}),
  }
}

export type BreadcrumbLd = {
  '@context': 'https://schema.org'
  '@type': 'BreadcrumbList'
  itemListElement: Array<{ '@type': 'ListItem'; position: number; name: string; item: string }>
}

/**
 * Хлебные крошки карточки: главная → «Игры по жанрам» → жанр → игра.
 *
 * Жанр — главный жанр игры (lib/gamehub primaryGenre), и путь через него
 * страница показывает сама, строкой над названием: разметка не говорит
 * больше, чем страница. Главного жанра нет — нет и строки, и крошки
 * остаются двумя уровнями: главная (логотип в шапке) → игра.
 */
export function gameBreadcrumbLd({
  meta,
  baseUrl,
  locale = DEFAULT_LOCALE,
  genre = null,
}: {
  meta: GameMeta
  baseUrl: string
  locale?: Locale
  /** Видимый путь над названием: заголовок страницы жанра (hubTitle на языке страницы) и её адрес */
  genre?: { title: string; path: string } | null
}): BreadcrumbLd {
  const trail = genre
    ? [
        { name: genresCrumb(locale), item: at(baseUrl, locale, '/games') },
        { name: genre.title, item: at(baseUrl, locale, genre.path) },
      ]
    : []
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { name: 'imbored', item: at(baseUrl, locale, '/') },
      ...trail,
      { name: meta.name, item: at(baseUrl, locale, `/game/${meta.appid}`) },
    ].map((step, i) => ({ '@type': 'ListItem' as const, position: i + 1, ...step })),
  }
}

/**
 * Хлебные крошки страницы жанра: главная → «Игры по жанрам» → жанр.
 *
 * Три уровня здесь честные: страница показывает этот путь сама, строкой над
 * заголовком, а главная — логотип в шапке. Имя жанра — заголовок страницы
 * («Рогалики», на /en — «Roguelikes»: hubTitle), тот же, что стоит в видимой
 * строке.
 */
export function genreBreadcrumbLd({
  title,
  path,
  baseUrl,
  locale = DEFAULT_LOCALE,
}: {
  title: string
  path: string
  baseUrl: string
  locale?: Locale
}): BreadcrumbLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'imbored', item: at(baseUrl, locale, '/') },
      { '@type': 'ListItem', position: 2, name: genresCrumb(locale), item: at(baseUrl, locale, '/games') },
      { '@type': 'ListItem', position: 3, name: title, item: at(baseUrl, locale, path) },
    ],
  }
}

export type ItemListLd = {
  '@context': 'https://schema.org'
  '@type': 'ItemList'
  name: string
  numberOfItems: number
  itemListElement: Array<{ '@type': 'ListItem'; position: number; url: string; name: string }>
}

/**
 * Список игр жанра — тем же порядком и тем же числом, что на странице.
 *
 * Только адрес и название: всё остальное (отзывы, цена) у каждой игры своё и
 * размечено на её карточке. Здесь это повтором было бы вторым источником тех
 * же чисел — а разметка обязана совпадать со страницей, где их показывают.
 */
export function genreItemListLd({
  title,
  games,
  baseUrl,
  locale = DEFAULT_LOCALE,
}: {
  title: string
  games: ReadonlyArray<{ appid: number; name: string }>
  baseUrl: string
  locale?: Locale
}): ItemListLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: title,
    numberOfItems: games.length,
    itemListElement: games.map((g, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: at(baseUrl, locale, `/game/${g.appid}`),
      name: g.name,
    })),
  }
}

/** Пост патча — столько, сколько знает страница патча */
type PatchLdItem = {
  appid: number
  gid: string
  title: string
  url: string
  publishedAt: number
  tldr?: string | null
  imageUrl?: string | null
}

export type NewsArticleLd = {
  '@context': 'https://schema.org'
  '@type': 'NewsArticle'
  headline: string
  url: string
  mainEntityOfPage: string
  datePublished: string
  /** Язык текста статьи: язык пересказа, а без пересказа — язык страницы */
  inLanguage: string
  description?: string
  image?: string[]
  about?: { '@type': 'VideoGame'; name: string; url: string }
  isBasedOn: string
  author: { '@type': 'Organization'; name: string; url: string }
  publisher: { '@type': 'Organization'; name: string; url: string }
}

/**
 * Патч как статья: заголовок, дата, пересказ, кадр, игра и оригинал.
 *
 * Каждое поле — то, что страница показывает: заголовок — тот же, что в h1
 * (newsHeading), описание — «Коротко», только если пересказ есть, кадр —
 * только если он стоит на странице, isBasedOn — «Оригинал в Steam». Автор и
 * издатель — imbored: страница — наш пересказ поста, а не сам пост, и у
 * текста издателя ниже подписи нет.
 *
 * item.tldr — пересказ на языке страницы: на /en это английский пересказ
 * (tldr_en), и без него описания в разметке нет — как нет и «In short» на
 * странице. Пока чтение патча его не отдаёт, /en передаёт русский пересказ —
 * и разметка повторяет страницу: description русский, inLanguage 'ru'.
 */
export function patchArticleLd({
  item,
  game,
  baseUrl,
  locale = DEFAULT_LOCALE,
}: {
  item: PatchLdItem
  game: { name: string } | null
  baseUrl: string
  locale?: Locale
}): NewsArticleLd {
  const url = at(baseUrl, locale, newsPath(item.appid, item.gid))
  const site = { '@type': 'Organization' as const, name: OG_SITE.siteName, url: `${baseUrl}/` }
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: newsHeading(item.title, game?.name),
    url,
    mainEntityOfPage: url,
    datePublished: new Date(item.publishedAt * 1000).toISOString(),
    // Язык ТЕКСТА статьи. Текст статьи — наш пересказ, и язык ему судит он
    // сам, а не адрес страницы: пока чтение патча не отдаёт tldr_en (W2-news),
    // /en получает русский пересказ, и «en» назвало бы английским русский
    // текст description. Русский пересказ — 'ru' на любой странице; любой
    // другой и его отсутствие — язык страницы: без пересказа текст статьи —
    // подписи страницы, а заголовок поста издатель пишет на своём языке, и
    // язык нашего текста он не решает. На /ru это 'ru' всегда, как и было
    inLanguage: isRussianText(item.tldr?.trim()) ? 'ru' : htmlLang(locale),
    ...(item.tldr?.trim() ? { description: item.tldr.trim() } : {}),
    ...(item.imageUrl ? { image: [item.imageUrl] } : {}),
    ...(game ? { about: { '@type': 'VideoGame', name: game.name, url: at(baseUrl, locale, `/game/${item.appid}`) } } : {}),
    isBasedOn: item.url,
    author: site,
    publisher: site,
  }
}

/**
 * Крошки патча: главная → игра → патч — ровно та ссылка назад, что стоит над
 * заголовком. Игры нет в каталоге — нет и ссылки на неё: два уровня.
 */
export function patchBreadcrumbLd({
  item,
  game,
  baseUrl,
  locale = DEFAULT_LOCALE,
}: {
  item: PatchLdItem
  game: { name: string } | null
  baseUrl: string
  locale?: Locale
}): BreadcrumbLd {
  const steps = [
    { name: 'imbored', item: at(baseUrl, locale, '/') },
    ...(game ? [{ name: game.name, item: at(baseUrl, locale, `/game/${item.appid}`) }] : []),
    { name: newsHeading(item.title, game?.name), item: at(baseUrl, locale, newsPath(item.appid, item.gid)) },
  ]
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: steps.map((step, i) => ({ '@type': 'ListItem' as const, position: i + 1, ...step })),
  }
}

export type WebSiteLd = {
  '@context': 'https://schema.org'
  '@type': 'WebSite'
  name: string
  url: string
  inLanguage: string
  description: string
}

/**
 * Сайт как сущность — только на главной.
 *
 * Без него имя сайта в выдаче Google берёт откуда придётся — из og:site_name
 * строчными или из домена. Описание — то же, что в метаданных корня
 * (siteDescription), а не своя формулировка: две копии обещания уже однажды
 * разъехались, см. lib/site.ts.
 *
 * На языке главной: /en — английская версия сайта со своим адресом, языком и
 * описанием, как её canonical и <html lang>.
 */
export function websiteJsonLd(baseUrl: string, locale: Locale = DEFAULT_LOCALE): WebSiteLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: OG_SITE.siteName,
    url: at(baseUrl, locale, '/'),
    inLanguage: htmlLang(locale),
    description: siteDescription(locale),
  }
}

/**
 * JSON для <script type="application/ld+json">.
 *
 * Экранирование угловых скобок обязательно и не является перестраховкой:
 * название игры приезжает из Steam как есть, а JSON.stringify «<» не трогает.
 * Игра с «</script>» в названии закрыла бы тег и всё, что после него, браузер
 * разобрал бы как разметку страницы.
 */
export function ldScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}
