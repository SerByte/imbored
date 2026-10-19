'use client'

import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { lp } from '@/lib/i18n'

/**
 * Роутер на языке страницы — useRouter из next/navigation, у которого
 * push, replace и prefetch сами ставят префикс языка.
 *
 * То же, что components/Link для ссылок: на /en router.push('/game/730')
 * уводил бы человека на русскую карточку — поиск в шапке по Enter, лендинг
 * после входа, «Выйти». Адрес решает lp() из lib/i18n.ts: внешние адреса,
 * /api и уже английский адрес она не трогает. Остальное (back, refresh) —
 * как у next/navigation.
 *
 * Импортировать useRouter из next/navigation в коде страниц нельзя —
 * сторожит lib/i18nlink.test.ts; исключение — этот файл.
 */
export function useLocaleRouter(): ReturnType<typeof useRouter> {
  const router = useRouter()
  const locale = useLocale()
  return useMemo(
    () => ({
      ...router,
      push: (href, options) => router.push(lp(locale, href), options),
      replace: (href, options) => router.replace(lp(locale, href), options),
      prefetch: (href, options) => router.prefetch(lp(locale, href), options),
    }),
    [router, locale],
  )
}
