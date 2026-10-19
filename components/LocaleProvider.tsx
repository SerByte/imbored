'use client'

import { createContext, useContext } from 'react'
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n'

/**
 * Язык страницы для клиентских компонентов (docs/i18n.md, «Как страница
 * узнаёт язык»).
 *
 * Ставит его корневой layout (app/[lang]/layout.tsx) из сегмента [lang]:
 * next/root-params клиенту недоступен, а прокидывать язык пропсом через
 * каждый островок — то самое, от чего контекст и спасает.
 *
 * Без провайдера — русский: тесты, которые рендерят компонент голым, и
 * всё, что стоит вне корневого layout (global-error), остаются на языке
 * по умолчанию, а не падают.
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE)

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>
}

export function useLocale(): Locale {
  return useContext(LocaleContext)
}
