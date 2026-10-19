/**
 * Язык главной: кого «/» уводит на /en.
 *
 * Английский — язык по умолчанию для нового гостя, русский — для гостя из
 * СНГ и для того, чей браузер читает по-русски охотнее, чем по-английски.
 * Адреса при этом прежние: русский — без префикса, английский — под /en.
 *
 * Решают два места, по порядку:
 *
 *   1. Кука lang=en — правило redirects из next.config (homeLocaleRedirects
 *      ниже). Явный выбор в переключателе (components/LocaleSwitch) или вход
 *      с английской версии (app/api/auth/steam/return,
 *      components/landing/ConnectCard). Условия has и missing CDN Vercel
 *      проверяет сам, без функции. Кука lang=ru никуда не уводит: «/» и есть
 *      русская главная.
 *   2. Первый вход без выбора — proxy.ts и homeLocaleFor ниже: краулер
 *      остаётся, гость из СНГ остаётся, браузер, который ставит русский выше
 *      английского, остаётся, остальных — на /en.
 *
 * Модуль без Next и без базы — его читает next.config.ts ещё до сборки (как
 * lib/i18nroutes.ts), а proxy.ts — на каждом своём вызове.
 *
 * Только вход, а не ходьба по сайту. Запрос роутера (RSC, префетч логотипа)
 * и переход со своей же страницы не уводятся: человек читал русскую
 * карточку игры, пришедшую из поиска, нажал логотип — и обязан попасть на
 * русскую главную, а не сменить язык на полпути. Браузер помечает такие
 * запросы сам: у fetch роутера заголовок RSC, у перехода со своей страницы —
 * Sec-Fetch-Site: same-origin. Вход — закладка, ввод адреса, ссылка извне,
 * запуск приложения с домашнего экрана (start_url манифеста — «/»).
 *
 * Страна и браузер — только без сессии. Кука lang появилась вместе с
 * английской версией, у тех, кто входил раньше, её нет — а вошедшие раньше
 * входили на русском. Без этого условия каждый такой человек вне СНГ на
 * следующем же входе уезжал бы на /en, и приложение на домашнем экране — на
 * каждом запуске. Вошедшего с английской версии уводит его кука lang=en.
 * Это условие — в matcher прокси (proxy.ts), а не здесь.
 *
 * 307, и строка запроса едет сама: /?next=%2Fplay приезжает на /en?next=%2Fplay.
 */
import { LANG_COOKIE, preferredLocale } from './i18n'

type Condition = { type: 'header' | 'cookie'; key: string; value?: string }
type Redirect = {
  source: string
  destination: string
  permanent: boolean
  has?: Condition[]
  missing?: Condition[]
}

/** Запрос роутера или переход со своей страницы — не вход на сайт */
const WALKING: Condition[] = [
  { type: 'header', key: 'rsc' },
  { type: 'header', key: 'sec-fetch-site', value: 'same-origin' },
]

/** Правило next.config: кука lang=en уводит «/» на /en — при любом браузере и с сессией тоже */
export function homeLocaleRedirects(): Redirect[] {
  return [
    {
      source: '/',
      has: [{ type: 'cookie', key: LANG_COOKIE, value: 'en' }],
      missing: WALKING,
      destination: '/en',
      permanent: false,
    },
  ]
}

/*
 * Страны, гостю из которых «/» показывает русскую главную, даже если браузер
 * у него английский (частая настройка и у русскоязычных). Коды ISO 3166-1
 * alpha-2 — так их пишет Vercel в x-vercel-ip-country.
 *
 * Члены СНГ и Туркменистан — ассоциированный участник. Украины и Грузии здесь
 * нет: они не в СНГ. Добавить их — одна строка: 'UA', 'GE'.
 */
export const CIS_COUNTRIES: readonly string[] = ['RU', 'BY', 'KZ', 'KG', 'AM', 'AZ', 'TJ', 'UZ', 'MD', 'TM']

/**
 * Краулер или бот превью ссылок: поисковики, соцсети, мессенджеры, SEO-сканеры
 * — и общий хвост bot/crawl/spider/preview/fetch для тех, кого в списке нет.
 * «/» им — та главная, что лежит по адресу, без редиректа.
 */
const CRAWLER =
  /googlebot|google-inspectiontool|bingbot|yandex|duckduckbot|baiduspider|slurp|applebot|petalbot|facebookexternalhit|meta-externalagent|twitterbot|telegrambot|vkshare|discordbot|whatsapp|linkedinbot|slackbot|semrushbot|ahrefsbot|mj12bot|bot|crawl|spider|preview|fetch/i

/**
 * Куда увести первый вход на «/»: 'en' — 307 на /en, null — остаться на
 * русской главной. Чистая функция; зовёт её proxy.ts, который стоит на «/»
 * только для такого входа (matcher там же: документ, без куки lang и без
 * сессии, не запрос роутера и не переход со своей страницы).
 *
 * По порядку:
 *   1. Краулер или бот превью — null. Им «/» отдаёт то, что лежит по адресу.
 *   2. Без Accept-Language (или пустой) — null. Браузер шлёт его всегда, а
 *      многие краулеры — нет.
 *   3. Страна из CIS_COUNTRIES — null: русский, какой бы ни был браузер.
 *   4. Браузер ставит русский выше английского (preferredLocale) — null:
 *      «uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7» читает по-русски и вне СНГ.
 *   5. Остальные — 'en': английский браузер, немецкий, китайский…
 *
 * country — x-vercel-ip-country. Без него (next start локально, не Vercel)
 * решает браузер.
 */
export function homeLocaleFor({
  acceptLanguage,
  country,
  userAgent,
}: {
  acceptLanguage?: string | null
  country?: string | null
  userAgent?: string | null
}): 'en' | null {
  if (userAgent && CRAWLER.test(userAgent)) return null
  if (!acceptLanguage?.trim()) return null
  if (country && CIS_COUNTRIES.includes(country.trim().toUpperCase())) return null
  if (preferredLocale({ acceptLanguage }) === 'ru') return null
  return 'en'
}
