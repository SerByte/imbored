/**
 * Язык главной: кого «/» уводит на /en — правилами redirects из next.config.
 *
 * Модуль без Next и без базы — его читает next.config.ts ещё до сборки (как
 * lib/i18nroutes.ts).
 *
 * Правилами конфига, а не в proxy.ts. Прокси стоит перед кэшем на КАЖДОМ
 * запросе, который совпал с его matcher, — а «/» просят и все, кто входит на
 * сайт, и префетч ссылки-логотипа в шапке на каждой странице. С «/» в matcher
 * каждый просмотр будил функцию ради ответа «оставайся», хотя главная —
 * статика, которую отдаёт CDN (bundle-budget.json, static). Условия has и
 * missing CDN Vercel проверяет сам, без функции.
 *
 * Уводят только по просьбе:
 *   • кука lang=en — явный выбор в переключателе (components/LocaleSwitch)
 *     или вход с английской версии (app/api/auth/steam/return,
 *     components/landing/ConnectCard);
 *   • английский браузер — Accept-Language ставит английский раньше
 *     русского (ENGLISH_FIRST) — и только при входе на сайт.
 *
 * Только вход, а не ходьба по сайту. Запрос роутера (RSC, префетч логотипа)
 * и переход со своей же страницы не уводятся: человек читал русскую
 * карточку игры, пришедшую из поиска, нажал логотип — и обязан попасть на
 * русскую главную, а не сменить язык на полпути. Браузер помечает такие
 * запросы сам: у fetch роутера заголовок RSC, у перехода со своей страницы —
 * Sec-Fetch-Site: same-origin. Вход — закладка, ввод адреса, ссылка извне,
 * запуск приложения с домашнего экрана (start_url манифеста — «/»).
 *
 * Английский браузер — ещё и только документ (Sec-Fetch-Dest: document). Без
 * этих заголовков ходят краулеры и скрипты, и «/» — x-default в hreflang —
 * обязан отдать им русскую главную, а не редирект.
 *
 * И только без сессии. Кука lang появилась вместе с английской версией, у
 * тех, кто входил раньше, её нет — а вошедшие раньше входили на русском.
 * Без этого условия каждый такой человек с английским браузером (частая
 * настройка и у русскоязычных) на следующем же входе уезжал бы на /en, и
 * приложение на домашнем экране — на каждом запуске. Вошедшего с английской
 * версии уводит его кука lang=en.
 *
 * 307, и строка запроса едет сама: /?next=%2Fplay приезжает на /en?next=%2Fplay.
 */
import { LANG_COOKIE } from './i18n'
import { SESSION_COOKIE } from './session'

type Condition = { type: 'header' | 'cookie'; key: string; value?: string }
type Redirect = {
  source: string
  destination: string
  permanent: boolean
  has?: Condition[]
  missing?: Condition[]
}

/**
 * Accept-Language, в котором английский стоит раньше русского — или русского
 * нет вовсе: «de-DE,de;q=0.9,en;q=0.8» по-русски не читает.
 *
 * Регулярка для has.value: элементы до английского (сколько угодно, ни один
 * не ru), затем en или en-XX. Порядок, а не q: браузеры пишут языки по
 * убыванию q, и на таких заголовках решение совпадает с preferredLocale из
 * lib/i18n (сверяет lib/homelocale.test.ts). Расходится оно только на
 * заголовке не по порядку («ru;q=0.5,en») и на en;q=0 — так браузеры не пишут.
 *
 * Якоря ^ и $ — свои: Next оборачивает значение в ^…$ сам, а поиск без них
 * нашёл бы «en-US» и в хвосте «ru-RU,ru;q=0.9,en-US;q=0.8».
 */
export const ENGLISH_FIRST = '^(?:\\s*(?![rR][uU](?:[-_;,\\s]|$))[^,]*,)*\\s*[eE][nN](?:[-_;,\\s].*)?$'

/** Запрос роутера или переход со своей страницы — не вход на сайт */
const WALKING: Condition[] = [
  { type: 'header', key: 'rsc' },
  { type: 'header', key: 'sec-fetch-site', value: 'same-origin' },
]

export function homeLocaleRedirects(): Redirect[] {
  return [
    {
      source: '/',
      has: [{ type: 'cookie', key: LANG_COOKIE, value: 'en' }],
      missing: WALKING,
      destination: '/en',
      permanent: false,
    },
    {
      source: '/',
      has: [
        { type: 'header', key: 'accept-language', value: ENGLISH_FIRST },
        { type: 'header', key: 'sec-fetch-dest', value: 'document' },
      ],
      missing: [...WALKING, { type: 'cookie', key: LANG_COOKIE }, { type: 'cookie', key: SESSION_COOKIE }],
      destination: '/en',
      permanent: false,
    },
  ]
}
