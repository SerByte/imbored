'use client'

import NextLink from 'next/link'
import type { ComponentProps } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { lp, type Locale } from '@/lib/i18n'

/**
 * Ссылка на языке страницы — замена next/link с теми же пропсами.
 *
 * Внутренний адрес получает префикс языка сам: на /en ссылка '/play' ведёт
 * на '/en/play', на русском — как была. Решает lp() из lib/i18n.ts: внешние
 * адреса, якоря, /api и файлы корня она не трогает, а уже английский адрес
 * не префиксует второй раз.
 *
 * Импортировать next/link напрямую в коде страниц нельзя — забытый импорт
 * молча уводил бы английскую страницу на русскую. Сторожит
 * lib/i18nlink.test.ts; исключение — этот файл.
 *
 * ref — обычный проп (React 19): ComponentProps включает его, и он уезжает в
 * next/link вместе с остальными.
 */
type Props = ComponentProps<typeof NextLink>

/** href строкой или объектом: у объекта на языке только pathname */
function localize(locale: Locale, href: Props['href']): Props['href'] {
  if (typeof href === 'string') return lp(locale, href)
  if (href && typeof href.pathname === 'string') return { ...href, pathname: lp(locale, href.pathname) }
  return href
}

export default function Link({ href, as, ...rest }: Props) {
  const locale = useLocale()
  return <NextLink {...rest} href={localize(locale, href)} as={typeof as === 'string' ? lp(locale, as) : as} />
}

/**
 * Статус перехода — тот же хук next/link: работает внутри этой ссылки,
 * потому что под ней та же next/link. Отсюда, а не из next/link, — ради
 * сторожа выше.
 */
export { useLinkStatus } from 'next/link'
