'use client'

import { useLocale } from '@/components/LocaleProvider'
import { textLangOn } from '@/lib/textlang'

/**
 * Название под обложкой GameCardBody — с атрибутом lang по языку страницы.
 *
 * Название игры — данные, его не переводят, но голос скринридера выбирается
 * по lang: на /en русское название («Смута») без пометки английский голос
 * читает по буквам. WCAG 3.1.2 требует пометить такой кусок своим lang — то
 * же правило, что у строки общих игр совместимости (CommonRow, langOn в
 * app/[lang]/compat/nick.tsx).
 *
 * Только на /en и только 'ru' (textLangOn). На русской странице атрибута
 * нет, как не было: textLangOn там пометил бы латинское название как 'en', а
 * это уже другая правка, не перевод, и русская страница обязана остаться
 * прежней до байта.
 *
 * Отдельным клиентским листом, а не пропсом locale у GameCardBody: карточку
 * зовут и серверные страницы (карточка игры, совместимость, библиотека), и
 * клиентские полки, а язык у обеих сторон приходит по-разному. Лист читает
 * его сам из контекста корневого layout (useLocale), и ни одному из
 * вызывающих не нужно ничего передавать. Название — children, а не пропс:
 * его видит и текст раскрытой страницы в тестах (lib/testing/flight).
 */
export function GameCardName({ children }: { children: string }) {
  const locale = useLocale()
  return (
    <span
      lang={locale === 'en' && textLangOn(locale, children) === 'ru' ? 'ru' : undefined}
      className="block truncate text-[15px] leading-tight font-extrabold tracking-[-0.01em]"
    >
      {children}
    </span>
  )
}
