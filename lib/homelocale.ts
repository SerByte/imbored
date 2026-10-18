import { LANG_COOKIE, preferredLocale } from './i18n'

/** То, что homeLocale читает из запроса; NextRequest подходит как есть */
export type HomeRequest = {
  method: string
  nextUrl: { pathname: string; search: string; host: string }
  headers: { get(name: string): string | null }
  cookies: { get(name: string): { value: string } | undefined }
}

/**
 * Куда увести с «/» по языку, либо null — главная как есть.
 *
 * Только английский и только по просьбе: кука lang из переключателя
 * (components/LocaleSwitch) или Accept-Language, где английский выше
 * русского (preferredLocale в lib/i18n.ts). Без заголовка — как ходят
 * краулеры — главная остаётся русской. Кука lang=ru держит русскую и при
 * английском браузере.
 *
 * Только вход на сайт, а не ходьба по нему. Запрос роутера (RSC, префетч
 * ссылки «домой» из шапки) и переход со своей же страницы не уводятся:
 * человек читал русскую карточку игры, пришедшую из поиска, нажал логотип —
 * и обязан попасть на русскую главную, а не сменить язык на полпути.
 *
 * Заголовки роутера (RSC, Next-Router-Prefetch) прокси не видит: Next снимает
 * их до прокси (FLIGHT_HEADERS в next/dist/server/web/adapter.js). Поэтому
 * по тому, что ставит браузер: Sec-Fetch-Dest не document — это fetch
 * роутера, а не переход; Sec-Fetch-Site: same-origin или Referer того же
 * хоста — переход со своей страницы. Без них (закладка, ввод адреса,
 * ссылка извне) — вход.
 *
 * 307 и запрос с собой: /?next=%2Fplay приезжает на /en?next=%2Fplay.
 * Статику главной это не трогает — прокси стоит перед кэшем, а сама
 * страница по-прежнему пререндерится (bundle-budget.json, static).
 */
export function homeLocale(req: HomeRequest): string | null {
  if (req.method !== 'GET' || req.nextUrl.pathname !== '/') return null
  const dest = req.headers.get('sec-fetch-dest')
  if (dest && dest !== 'document') return null
  if (req.headers.get('sec-fetch-site') === 'same-origin') return null
  const referer = req.headers.get('referer')
  if (referer) {
    try {
      if (new URL(referer).host === req.nextUrl.host) return null
    } catch {
      // битый Referer — как его нет
    }
  }
  const want = preferredLocale({
    acceptLanguage: req.headers.get('accept-language'),
    cookie: req.cookies.get(LANG_COOKIE)?.value,
  })
  return want === 'en' ? `/en${req.nextUrl.search}` : null
}
