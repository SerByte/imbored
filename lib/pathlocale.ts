import type { Locale } from './i18n'

/**
 * Язык адреса — то же, что splitLocale(pathname).locale из lib/i18n, но без
 * единого импорта значений.
 *
 * Нужен одному app/global-error.tsx. Аварийный экран Next собирает в свою
 * группу чанков первой загрузки, отдельную от корневого layout, и всё, что он
 * импортирует, едет в каждый маршрут второй копией рядом с копией layout. Он
 * брал splitLocale, htmlLang, tr и lp из lib/i18n — и вместе с ними весь
 * модуль с lib/plural (1.8 КБ) приезжал на все маршруты дважды. Здесь только
 * то, что экрану нужно: '/en' и '/en/…' — английский, всё остальное, в том
 * числе '/ru/…', '/enx' и пустая строка, — русский (DEFAULT_LOCALE).
 *
 * Что ответ совпадает со splitLocale, сторожит lib/pathlocale.test.ts.
 */
export function pathLocale(pathname: string): Locale {
  return pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'ru'
}
