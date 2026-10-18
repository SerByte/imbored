import type { Locale } from '@/lib/i18n'

/**
 * Заголовок и текст системной панели «Поделиться» для ссылки совместимости —
 * один на поле хаба (page.tsx) и на кнопку CopyCompatLink.
 *
 * Отдельным модулем, а не константой в CopyCompatLink: тот — клиентский
 * модуль, и серверная страница хаба, импортировав из него строку, получила
 * бы ссылку на клиентский модуль, а не текст. Две копии в двух файлах уже
 * были — и ровно так однажды разъехались бы на первой правке перевода.
 *
 * Модуль чистый: годится и серверу, и клиенту.
 */
export const COMPAT_SHARE = {
  ru: {
    title: 'Совместимость вкусов — imbored',
    text: 'Сравним библиотеки Steam по-настоящему, а не по анкете',
  },
  en: {
    title: 'Taste match — imbored',
    text: 'A real comparison of your Steam libraries, not a quiz',
  },
} satisfies Record<Locale, { title: string; text: string }>
