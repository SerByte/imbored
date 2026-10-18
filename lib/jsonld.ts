import { discountOf, trustedPrice } from './discount'
import { newsHeading, newsPath } from './newspage'
import { patchArchivePath } from './patcharchive'
import { OG_SITE, SITE_DESCRIPTION } from './site'
import { STORE_LABEL } from './stores'
import { tagRu } from './tagsru'
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
  /** русское название магазина — то же, что вторым рядом под заголовком */
  alternateName?: string
  url: string
  gamePlatform: 'PC'
  description?: string
  image?: string
  genre?: string[]
  playMode?: string[]
  datePublished?: string
  /** 'ru' — только когда Steam отметил русский; см. gameJsonLd */
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

export type GameLdInput = {
  meta: GameMeta
  /**
   * Русское название магазина (GamePageData.nameRu). Страница рисует его
   * вторым рядом под заголовком, разметка называет alternateName — и только
   * тогда, когда оно на странице есть (pageNameRu).
   */
  nameRu?: string | null
  /** абсолютный адрес сайта — schema.org требует полных ссылок */
  baseUrl: string
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

/**
 * Второе название, которое карточка показывает под заголовком, — или null.
 *
 * Одно правило на страницу и разметку: alternateName без строки на странице
 * — ровно та разметка, что говорит больше видимого. Совпадающее с name не
 * показываем — повтор заголовка ничего не называет.
 */
export function pageNameRu(meta: Pick<GameMeta, 'name'>, nameRu: string | null | undefined): string | null {
  const alt = nameRu?.trim()
  return alt && alt !== meta.name ? alt : null
}

export function gameJsonLd({
  meta,
  nameRu,
  baseUrl,
  currency,
  now,
}: GameLdInput): GameLd {
  const ld: GameLd = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: meta.name,
    url: `${baseUrl}/game/${meta.appid}`,
    // Каталог — только PC-игры: и Steam, и кураторский пул других магазинов.
    gamePlatform: 'PC',
  }
  /*
   * Русское название — вторым именем, а не вместо: название карточки —
   * английское, как в магазине (STORE_LANGUAGE в lib/catalog), а русское
   * у ~70 игр верха каталога («Ведьмак 3: Дикая Охота», «Призрак Цусимы»)
   * — то, как их ищут в русской выдаче. До правила двух названий (nameSql в
   * lib/db) крон карточек клал его прямо в name, и <title> с H1 этих страниц
   * были русскими; теперь они английские, а русское остаётся на странице
   * вторым рядом — и здесь.
   */
  const alt = pageNameRu(meta, nameRu)
  if (alt) ld.alternateName = alt

  if (meta.shortDescription) ld.description = meta.shortDescription
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
  // Теги — русскими подписями (tagRu), как на чипсах: разметка обязана
  // совпадать с видимым, а жанры Steam у игры и так русские (appdetails с
  // l=russian). Порядок — по английским ключам, до перевода, как у страницы.
  const genre = meta.genres.length
    ? meta.genres
    : Object.entries(meta.tags ?? {})
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, TAGS_AS_GENRE)
        .map(([t]) => tagRu(t))
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
   */
  if (meta.ruLang !== undefined && meta.ruLang > 0) ld.inLanguage = 'ru'
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
  genre = null,
}: {
  meta: GameMeta
  baseUrl: string
  /** Видимый путь над названием: заголовок страницы жанра и её адрес */
  genre?: { title: string; path: string } | null
}): BreadcrumbLd {
  const trail = genre
    ? [
        { name: 'Игры по жанрам', item: `${baseUrl}/games` },
        { name: genre.title, item: `${baseUrl}${genre.path}` },
      ]
    : []
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { name: 'imbored', item: `${baseUrl}/` },
      ...trail,
      { name: meta.name, item: `${baseUrl}/game/${meta.appid}` },
    ].map((step, i) => ({ '@type': 'ListItem' as const, position: i + 1, ...step })),
  }
}

/**
 * Хлебные крошки страницы жанра: главная → «Игры по жанрам» → жанр.
 *
 * Три уровня здесь честные: страница показывает этот путь сама, строкой над
 * заголовком, а главная — логотип в шапке. Имя жанра — заголовок страницы
 * («Рогалики»), тот же, что стоит в видимой строке.
 */
export function genreBreadcrumbLd({
  title,
  path,
  baseUrl,
}: {
  title: string
  path: string
  baseUrl: string
}): BreadcrumbLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'imbored', item: `${baseUrl}/` },
      { '@type': 'ListItem', position: 2, name: 'Игры по жанрам', item: `${baseUrl}/games` },
      { '@type': 'ListItem', position: 3, name: title, item: `${baseUrl}${path}` },
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
}: {
  title: string
  games: ReadonlyArray<{ appid: number; name: string }>
  baseUrl: string
}): ItemListLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: title,
    numberOfItems: games.length,
    itemListElement: games.map((g, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${baseUrl}/game/${g.appid}`,
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
  inLanguage: 'ru'
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
 */
export function patchArticleLd({
  item,
  game,
  baseUrl,
}: {
  item: PatchLdItem
  game: { name: string } | null
  baseUrl: string
}): NewsArticleLd {
  const url = `${baseUrl}${newsPath(item.appid, item.gid)}`
  const site = { '@type': 'Organization' as const, name: OG_SITE.siteName, url: `${baseUrl}/` }
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: newsHeading(item.title, game?.name),
    url,
    mainEntityOfPage: url,
    datePublished: new Date(item.publishedAt * 1000).toISOString(),
    inLanguage: 'ru',
    ...(item.tldr?.trim() ? { description: item.tldr.trim() } : {}),
    ...(item.imageUrl ? { image: [item.imageUrl] } : {}),
    ...(game ? { about: { '@type': 'VideoGame', name: game.name, url: `${baseUrl}/game/${item.appid}` } } : {}),
    isBasedOn: item.url,
    author: site,
    publisher: site,
  }
}

/**
 * Крошки патча: главная → игра → обновления → патч — ровно тот путь, что
 * стоит над заголовком. «Обновления» — архив обновлений игры
 * (/game/<appid>/news, lib/patcharchive): патч — одна его строка. Игры нет в
 * каталоге — нет ни её карточки, ни архива: два уровня.
 */
export function patchBreadcrumbLd({
  item,
  game,
  baseUrl,
}: {
  item: PatchLdItem
  game: { name: string } | null
  baseUrl: string
}): BreadcrumbLd {
  const steps = [
    { name: 'imbored', item: `${baseUrl}/` },
    ...(game
      ? [
          { name: game.name, item: `${baseUrl}/game/${item.appid}` },
          { name: ARCHIVE_CRUMB, item: `${baseUrl}${patchArchivePath(item.appid)}` },
        ]
      : []),
    { name: newsHeading(item.title, game?.name), item: `${baseUrl}${newsPath(item.appid, item.gid)}` },
  ]
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: steps.map((step, i) => ({ '@type': 'ListItem' as const, position: i + 1, ...step })),
  }
}

/** Имя архива в крошках — тот же текст, что в видимом пути над заголовком */
export const ARCHIVE_CRUMB = 'Обновления'

/**
 * Крошки архива обновлений игры: главная → игра → обновления — путь, который
 * архив показывает строкой над заголовком.
 */
export function archiveBreadcrumbLd({
  appid,
  gameName,
  baseUrl,
}: {
  appid: number
  gameName: string
  baseUrl: string
}): BreadcrumbLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { name: 'imbored', item: `${baseUrl}/` },
      { name: gameName, item: `${baseUrl}/game/${appid}` },
      { name: ARCHIVE_CRUMB, item: `${baseUrl}${patchArchivePath(appid)}` },
    ].map((step, i) => ({ '@type': 'ListItem' as const, position: i + 1, ...step })),
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
 * (SITE_DESCRIPTION), а не своя формулировка: две копии обещания уже однажды
 * разъехались, см. lib/site.ts.
 */
export function websiteJsonLd(baseUrl: string): WebSiteLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: OG_SITE.siteName,
    url: `${baseUrl}/`,
    inLanguage: 'ru',
    description: SITE_DESCRIPTION,
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
