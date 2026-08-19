import { discountOf } from './discount'
import type { Rating } from './rating'
import { STORE_LABEL } from './stores'
import type { GameMeta } from './types'

/**
 * Микроразметка карточки игры для поисковиков.
 *
 * Зачем вообще: пять тысяч страниц `/game/[appid]` — это весь органический
 * вход сайта (см. app/sitemap.ts, там пять служебных адресов и пять тысяч
 * игровых). У каждой из них уже есть то, ради чего Google рисует расширенный
 * сниппет — доля положительных отзывов, их число и цена, — но лежало это
 * только в вёрстке, то есть для робота не существовало. Звёзды и цена прямо в
 * выдаче стоят дороже любой правки самой страницы: они меняют не то, что
 * человек увидит после клика, а то, случится ли клик.
 *
 * Главное правило модуля — РАЗМЕТКА НЕ ГОВОРИТ БОЛЬШЕ, ЧЕМ СТРАНИЦА.
 * Расхождение видимого и размеченного Google считает нарушением и снимает
 * расширенный сниппет целиком, поэтому:
 *   - процент берётся тот же и округляется так же, как в positivePercent;
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
  author?: Org
  publisher?: Org
  aggregateRating?: {
    '@type': 'AggregateRating'
    ratingValue: number
    bestRating: number
    worstRating: number
    ratingCount: number
  }
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
  /** уже сведённая оценка — та же, что рисует кольцо на странице; см. lib/rating */
  rating: Rating | null
  /** абсолютный адрес сайта — schema.org требует полных ссылок */
  baseUrl: string
  /** ISO 4217 региона цен; см. currencyOf */
  currency: string
  now: number
}

/**
 * Категории Steam -> GamePlayMode схемы.
 *
 * Порядок задан здесь, а не приходит из meta.categories, и это важно: страница
 * кэшируется на сутки и пререндерится, а порядок категорий в ответе Steam
 * между пересборками каталога не гарантирован. Разметка не должна меняться от
 * того, в каком порядке они легли в базу.
 */
const PLAY_MODES: Array<[number[], string]> = [
  [[2], 'SinglePlayer'],
  [[1], 'MultiPlayer'],
  [[9, 38], 'CoOp'],
]

/**
 * Steam-регион цен -> код валюты.
 *
 * Нужен только разметке: витрина рисует цену через formatPrice, который
 * доллар зашивает (модуль клиентский и до process.env не дотягивается).
 * Пока STEAM_STORE_CC не трогали, оба места говорят одно и то же; расходиться
 * они начнут ровно тогда, когда регион сменят — и чинить тогда придётся
 * formatPrice, а не это.
 */
const CURRENCY: Record<string, string> = {
  us: 'USD', ru: 'RUB', eu: 'EUR', de: 'EUR', fr: 'EUR', uk: 'GBP', gb: 'GBP',
  ua: 'UAH', kz: 'KZT', tr: 'TRY', pl: 'PLN', br: 'BRL', jp: 'JPY', cn: 'CNY',
  ca: 'CAD', au: 'AUD', in: 'INR',
}

export function currencyOf(cc: string | undefined): string {
  return CURRENCY[(cc ?? '').toLowerCase()] ?? 'USD'
}

export function gameJsonLd({
  meta,
  rating,
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
  // страница пререндерится и кэшируется на сутки, а порядок ключей после
  // очередной пересборки каталога не гарантирован.
  const genre = meta.genres.length
    ? meta.genres
    : Object.entries(meta.tags ?? {})
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, TAGS_AS_GENRE)
        .map(([t]) => t)
  if (genre.length) ld.genre = genre

  const modes = PLAY_MODES.filter(([ids]) => ids.some((id) => meta.categories.includes(id))).map(
    ([, mode]) => mode,
  )
  if (modes.length) ld.playMode = modes

  // Год, а не дата: в базе лежит releaseDate в локали Steam («21 Aug, 2012»),
  // разбирать её обратно в ISO незачем — releaseYear уже разобран каталогом,
  // а голый год schema.org принимает как частичный ISO 8601.
  if (meta.releaseYear) ld.datePublished = String(meta.releaseYear)
  if (meta.developer) ld.author = { '@type': 'Organization', name: meta.developer }
  if (meta.publisher) ld.publisher = { '@type': 'Organization', name: meta.publisher }

  if (rating) {
    ld.aggregateRating = {
      '@type': 'AggregateRating',
      // Шкала 0–100, а не пересчёт в пять звёзд: у нас доля положительных
      // отзывов, а не средний балл. Google нормирует сам по bestRating и
      // worstRating, и честная шкала ему для этого достаточна.
      ratingValue: rating.percent,
      bestRating: 100,
      worstRating: 0,
      ratingCount: rating.total,
    }
  }

  const offers = offersOf(meta, currency, now)
  if (offers) ld.offers = offers

  return ld
}

function offersOf(meta: GameMeta, currency: string, now: number): GameLd['offers'] {
  // Free-to-play приезжает без price_final вовсе — у Steam этого поля для
  // таких игр нет. Ноль здесь не догадка: страница в этом же случае рисует
  // «бесплатно», и разметка обязана говорить то же самое.
  if (meta.priceFinal === undefined && !meta.isFree) return undefined

  const deal = discountOf(meta, now)
  /*
   * isFree СИЛЬНЕЕ цены, и порядок тут не вкусовой — он повторяет PriceTag,
   * который решает то же самое для страницы: `if (isFree || priceFinal === 0)`
   * стоит у него первой строкой.
   *
   * Случай не выдуманный, он найден на живом деплое: у Counter-Strike 2 в
   * базе одновременно is_free = 1 и price_final = 1499 — это цена Prime, а
   * не игры. Страница показывала «бесплатно», разметка успевала сказать
   * «$14.99», и получалось ровно то расхождение видимого и размеченного, за
   * которое Google снимает расширенный сниппет целиком.
   */
  const cents = meta.isFree ? 0 : deal ? deal.finalCents : (meta.priceFinal ?? 0)

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
