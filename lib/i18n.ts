/**
 * Язык сайта: адреса, строки, числа и даты — договор в docs/i18n.md.
 *
 * Модуль чистый и годится клиенту: ни Next, ни базы, ни узла. Его читают
 * корневой layout, клиентская ссылка (components/Link.tsx), proxy.ts и
 * next.config.ts — последний ещё до сборки, поэтому импорты здесь только
 * относительные и только из таких же чистых модулей.
 *
 * Русский — без префикса (/play), английский — под /en (/en/play). Внутри
 * приложения обе ветки живут в app/[lang]/…, а русские адреса доезжают туда
 * правилами rewrites из next.config.ts.
 */
import { plural } from './plural'

export const LOCALES = ['ru', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'ru'

/** Явный выбор человека в переключателе (components/LocaleSwitch.tsx). По нему «/» выбирает язык: правило next.config и matcher прокси (lib/homelocale.ts). */
export const LANG_COOKIE = 'lang'

/** Жизнь куки LANG_COOKIE: год — выбор языка не настройка на один заход */
export const LANG_COOKIE_MAX_AGE_SEC = 31_536_000

/**
 * Первые сегменты адресов, которые живут под app/[lang].
 *
 * Отсюда собираются rewrites русской ветки (/play → /ru/play) и решает lp(),
 * ставить ли префикс: всё, чего здесь нет, — /api, /_next, файлы в корне
 * (/favicon.ico, /search-index.json, /sitemap.xml), — остаётся без языка.
 *
 * Каталог app/[lang]/* без строки здесь не переписался бы и на русском
 * адресе отвечал бы 404, а строка без каталога переписывала бы адрес в
 * пустоту. Оба расхождения ловит lib/i18nroutes.test.ts.
 *
 * opengraph-image — не каталог, а файловая карточка корня
 * (app/[lang]/opengraph-image.tsx): её адрес тоже первый сегмент под [lang].
 * missing — не раздел, а бывшая цель мусорного правила (теперь оно ведёт в
 * /_not-found, garbageRewrites в lib/i18nroutes.ts); почему каталог ещё
 * жив — в app/[lang]/missing/page.tsx.
 */
export const LOCALIZED_SECTIONS = [
  'compat',
  'daily',
  'explore',
  'game',
  'games',
  'library',
  'missing',
  'opengraph-image',
  'pick',
  'play',
  'portrait',
  'privacy',
  'quiz',
  'room',
  'rooms',
  'support',
  'whatsnew',
] as const

const SECTIONS: ReadonlySet<string> = new Set(LOCALIZED_SECTIONS)

/** includes, а не ключ объекта: у списка нет наследованных toString и __proto__ */
export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v)
}

/** Неизвестное — русский: он язык по умолчанию и адрес без префикса. */
export function toLocale(v: unknown): Locale {
  return isLocale(v) ? v : DEFAULT_LOCALE
}

/** Строка по языку. Обе ветки обязательны — тип не даст забыть английскую. */
export function tr<T>(locale: Locale, v: { ru: T; en: T }): T {
  return locale === 'en' ? v.en : v.ru
}

/**
 * Слово при числе. ru — три формы (lib/plural.ts: 1 игра, 2 игры, 5 игр),
 * en — две: one только у ровно 1, а 0, 2 и дроби — other («0 games»,
 * «1.5 hours»). Возвращает ТОЛЬКО слово: число вызывающий ставит сам, как и
 * раньше с plural().
 */
export function pl(
  locale: Locale,
  n: number,
  forms: { ru: [string, string, string]; en: [string, string] },
): string {
  if (locale === 'en') return n === 1 ? forms.en[0] : forms.en[1]
  return plural(n, ...forms.ru)
}

export function intlLocale(locale: Locale): 'ru-RU' | 'en-US' {
  return locale === 'en' ? 'en-US' : 'ru-RU'
}

export function fmtNumber(locale: Locale, n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(locale), opts).format(n)
}

/**
 * Число — секунды unix, как везде в базе и в API, а не миллисекунды Date.
 *
 * Зона по умолчанию — UTC, если вызывающий не задал свою: без неё сервер
 * (UTC) и браузер (зона читателя) печатали бы после 21:00 разные дни, и
 * гидратация падала бы с #418 (lib/hydration.test.ts).
 */
export function fmtDate(locale: Locale, d: Date | number, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: 'UTC', ...opts }).format(
    typeof d === 'number' ? new Date(d * 1000) : d,
  )
}

/** Где кончается путь: дальше ?запрос и #якорь, они едут как есть */
function cutPath(href: string): [path: string, rest: string] {
  const q = href.indexOf('?')
  const h = href.indexOf('#')
  const at = q < 0 ? h : h < 0 ? q : Math.min(q, h)
  return at < 0 ? [href, ''] : [href.slice(0, at), href.slice(at)]
}

/**
 * Внутренняя ссылка на языке: '/play' → '/en/play' для en; для ru — как есть.
 *
 * Префикс получают только корень и разделы из LOCALIZED_SECTIONS — со всем,
 * что под ними, включая карточки (/portrait/<id>/card.png живёт в
 * app/[lang]/portrait). Без изменений: внешние адреса, '//cdn…', '#якорь',
 * '?запрос', относительные пути, /api/…, /_next/… и файлы корня
 * (/favicon.ico, /search-index.json). Повторный вызов ничего не меняет:
 * '/en/play' уже на английском. ?запрос и #якорь сохраняются.
 */
export function lp(locale: Locale, href: string): string {
  if (locale !== 'en') return href
  if (!href.startsWith('/') || href.startsWith('//')) return href
  const [path, rest] = cutPath(href)
  if (path === '/en' || path.startsWith('/en/')) return href
  if (path === '/') return `/en${rest}`
  const first = path.slice(1).split('/', 1)[0]
  return SECTIONS.has(first) ? `/en${path}${rest}` : href
}

/**
 * Язык и путь без языка: '/en/play' → { en, '/play' }, '/play' → { ru, '/play' }.
 *
 * '/ru/…' тоже понимается как русский. Снаружи такого адреса нет (редирект в
 * next.config.ts), но статическая страница русской ветки пререндерится по
 * внутреннему пути, и usePathname на сервере отдаёт '/ru/play', а в браузере
 * — '/play'. Всё, что рисуется от адреса (подсветка меню, переключатель
 * языка), обязано совпасть в обоих, иначе гидратация разъедется.
 */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  for (const locale of LOCALES) {
    const prefix = `/${locale}`
    if (pathname === prefix) return { locale, path: '/' }
    if (pathname.startsWith(`${prefix}/`)) return { locale, path: pathname.slice(prefix.length) }
  }
  return { locale: DEFAULT_LOCALE, path: pathname || '/' }
}

/**
 * Тот же адрес на другом языке: '/en/play' → '/play', '/play' → '/en/play'.
 *
 * search — строка запроса текущей страницы (с «?» или без): переключатель
 * языка обязан оставить человека на той же выдаче, а не на голом /play.
 */
export function switchLocaleHref(pathname: string, target: Locale, search?: string | URLSearchParams): string {
  const { path } = splitLocale(cutPath(pathname)[0])
  const base = target === 'en' ? (path === '/' ? '/en' : `/en${path}`) : path
  const query = (typeof search === 'string' ? search : (search?.toString() ?? '')).replace(/^\?/, '')
  return query ? `${base}?${query}` : base
}

/**
 * Пути маршрута адреса сайта на всех языках: '/game/730' → ['/ru/game/730', '/en/game/730'].
 *
 * Для revalidatePath: ISR кладёт страницу в кэш по пути файла маршрута, то
 * есть по адресу ПОСЛЕ rewrites (docs: revalidatePath, «Using revalidatePath
 * with rewrites»), — сброс голого '/game/730' не задел бы ни одной из двух
 * копий. Адрес не из разделов (/sitemap.xml) — как есть: он вне [lang].
 */
export function routePaths(path: string): string[] {
  const { path: bare } = splitLocale(cutPath(path)[0])
  const first = bare.slice(1).split('/', 1)[0]
  if (bare !== '/' && !SECTIONS.has(first)) return [path]
  return LOCALES.map((l) => (bare === '/' ? `/${l}` : `/${l}${bare}`))
}

/**
 * Язык в адрес запроса к API: '/api/recommend?x=1' → '/api/recommend?x=1&lang=en'.
 *
 * В адресе, а не в куке или заголовке: ответы GET могут кэшироваться, и
 * ключом кэша обязан быть сам адрес. Для ru адрес не меняется — русский
 * ответ и был ответом по умолчанию.
 */
export function withLang(url: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return url
  const hashAt = url.indexOf('#')
  const hash = hashAt < 0 ? '' : url.slice(hashAt)
  const body = hashAt < 0 ? url : url.slice(0, hashAt)
  const q = body.indexOf('?')
  const path = q < 0 ? body : body.slice(0, q)
  const params = new URLSearchParams(q < 0 ? '' : body.slice(q + 1))
  params.set('lang', locale)
  return `${path}?${params}${hash}`
}

/** Язык запроса в route handler: ?lang=en в адресе (см. withLang). next/root-params там не работает. */
export function localeFromRequest(req: Request | { url: string }): Locale {
  try {
    return toLocale(new URL(req.url, 'http://localhost').searchParams.get('lang'))
  } catch {
    return DEFAULT_LOCALE
  }
}

/** Значение <html lang> */
export function htmlLang(locale: Locale): string {
  return locale
}

export function ogLocale(locale: Locale): 'ru_RU' | 'en_US' {
  return locale === 'en' ? 'en_US' : 'ru_RU'
}

/**
 * canonical и hreflang страницы: path — русский адрес без префикса.
 *
 * canonical — адрес на языке самой страницы (locale; по умолчанию русский),
 * languages — оба языка и x-default, который смотрит на английский: x-default
 * — версия для языка, которого нет среди версий, а такому гостю вне СНГ
 * «/» и так показывает английский (homeLocaleFor в lib/homelocale.ts).
 * Русский остаётся без префикса. Для generateMetadata — обёртка localeAlternates в
 * lib/site.ts.
 */
export function alternates(
  path: string,
  locale: Locale = DEFAULT_LOCALE,
): { canonical: string; languages: Record<string, string> } {
  return {
    canonical: lp(locale, path),
    languages: { ru: path, en: lp('en', path), 'x-default': lp('en', path) },
  }
}

/**
 * Accept-Language → [язык, q] в порядке заголовка. q=0 — «не надо» — отброшен,
 * мусор в q — как его нет (1), регион не в счёт: en-GB — это en.
 */
function acceptedLanguages(header: string): Array<{ lang: string; q: number }> {
  const out: Array<{ lang: string; q: number }> = []
  for (const part of header.split(',')) {
    const [tag, ...params] = part.trim().split(';')
    const lang = tag.trim().toLowerCase().split('-', 1)[0]
    if (!lang || lang === '*') continue
    let q = 1
    for (const p of params) {
      const [k, v] = p.trim().split('=')
      if (k?.trim() === 'q') {
        const n = Number(v)
        if (Number.isFinite(n)) q = n
      }
    }
    if (q > 0) out.push({ lang, q })
  }
  return out
}

/**
 * Какой из двух языков сайта браузер читает охотнее. null — ни одного из
 * них браузер не назвал (или заголовка нет).
 *
 * Одна из ступеней выбора языка «/» — homeLocaleFor в lib/homelocale.ts:
 * там же краулеры, страна и что делать с null.
 *
 * cookie — значение куки LANG_COOKIE: явный выбор человека в переключателе,
 * он важнее браузера в обе стороны. Без куки — Accept-Language:
 *   • 'ru' — русский стоит выше английского (по q, при равных — кто раньше)
 *     или русский есть, а английского нет;
 *   • 'en' — наоборот: английский выше русского или английский есть, а
 *     русского нет («de, en;q=0.8» по-русски не читает);
 *   • null — нет ни того ни другого («de-DE,de;q=0.9», «*»).
 *
 * Без заголовка — null: так ходят краулеры и скрипты.
 */
export function preferredLocale({
  acceptLanguage,
  cookie,
}: {
  acceptLanguage?: string | null
  cookie?: string | null
}): Locale | null {
  if (isLocale(cookie)) return cookie
  if (!acceptLanguage) return null
  const list = acceptedLanguages(acceptLanguage)
  /** Лучшая запись языка: наибольший q, при равных — более ранняя; null — языка нет */
  const best = (lang: string): { q: number; at: number } | null => {
    let found: { q: number; at: number } | null = null
    for (let at = 0; at < list.length; at++) {
      const e = list[at]
      if (e.lang === lang && (found === null || e.q > found.q)) found = { q: e.q, at }
    }
    return found
  }
  const en = best('en')
  const ru = best('ru')
  if (!en) return ru ? 'ru' : null
  if (!ru) return 'en'
  return en.q > ru.q || (en.q === ru.q && en.at < ru.at) ? 'en' : 'ru'
}
