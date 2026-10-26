import { alternates, LOCALES, type Locale } from '@/lib/i18n'

/**
 * hreflang страницы патча и архива обновлений — только на те версии, что сами
 * в поиске (has). canonical страница ставит сама, рядом:
 * `alternates: { canonical: lp(locale, path), ...indexedHreflang(path, has) }`.
 *
 * Своё у этих страниц — пересказ, и у каждого языка он свой: версия без
 * пересказа своего языка стоит с noindex (newsIndexable, archiveIndexable).
 * Голова с обоими языками (localeAlternates) вела hreflang с индексируемой
 * русской на /en с noindex, а в карте сайта (app/sitemap.ts) у того же
 * адреса стоят только версии в поиске: ссылка на неиндексируемую версию для
 * поиска пустой сигнал. hreflang у этих страниц — только здесь: карта сайта
 * перечисляет адреса без xhtml:link. x-default — английская, пока она в
 * поиске, без неё — русская.
 * Список один на все версии страницы, и на неиндексируемой тоже: связка у
 * всех одна. Ни одной версии в поиске — hreflang нет вовсе.
 *
 * Когда в поиске обе версии, ответ — ровно languages из localeAlternates, с
 * тем же порядком ключей: голова такой страницы не меняется ни на байт.
 */
export function indexedHreflang(path: string, has: readonly Locale[]): { languages?: Record<string, string> } {
  const { languages } = alternates(path)
  const versions = LOCALES.filter((l) => has.includes(l))
  if (!versions.length) return {}
  return {
    languages: {
      ...Object.fromEntries(versions.map((l) => [l, languages[l]])),
      'x-default': languages[versions.includes('en') ? 'en' : 'ru'],
    },
  }
}
