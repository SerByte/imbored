import type { ReactNode } from 'react'
import type { Locale } from '@/lib/i18n'
import { textLangOn } from '@/lib/textlang'

/*
 * Ники из Steam и названия игр на английской странице совместимости.
 *
 * Это данные, их не переводят, но голос скринридера выбирается по lang: на
 * /en русский ник («Костя») без пометки английский голос читает по буквам.
 * А у сайта аудитория по большей части русскоязычная, так что русский ник
 * на /en будет частым, а не редким. WCAG 3.1.2 требует пометить такой
 * кусок своим lang.
 */

/**
 * lang куска данных: 'ru', когда на /en в нём перевешивает кириллица.
 *
 * Только на /en. На русской странице атрибута нет, как не было:
 * textLangOn там пометил бы латинский ник как 'en', а это уже другая
 * правка, не перевод, и русская страница обязана остаться прежней до байта.
 */
export function langOn(locale: Locale, text: string): 'ru' | undefined {
  return locale === 'en' && textLangOn(locale, text) === 'ru' ? 'ru' : undefined
}

/**
 * Целая фраза с никами внутри: на /en каждый русский ник — своим
 * <span lang="ru">, остальное наследует lang страницы.
 *
 * Фраза остаётся одним шаблоном tr() и режется уже готовой: склеивать её из
 * кусков ради пометки значило бы снова собирать английский порядок слов из
 * русских обрывков. Искать ник в английской фразе безопасно: кириллицы в
 * шаблоне нет, и русский ник находит только сам себя.
 *
 * Нечего помечать (русская страница, латинские ники) — та же строка, одним
 * текстовым узлом, как раньше. Есть что — куски в ОДНОМ общем <span>: фраза
 * стоит и во flex-родителях (.link-more — inline-flex с gap), и без обёртки
 * каждый кусок стал бы там своим флекс-элементом — «Костя 's player portrait»
 * с зазором посреди слова.
 */
export function withNicks(locale: Locale, text: string, names: ReadonlyArray<string | null | undefined>): ReactNode {
  const marked = [...new Set(names.filter((n): n is string => !!n && langOn(locale, n) === 'ru'))]
    // Длинные первыми: «Костя Pro» раньше «Костя», иначе имя разрезалось бы
    .sort((a, b) => b.length - a.length)
  if (!marked.length) return text
  const escaped = marked.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  // С группой split оставляет найденное на нечётных местах
  return (
    <span>
      {text.split(new RegExp(`(${escaped.join('|')})`, 'g')).map((part, i) =>
        i % 2 ? (
          <span key={i} lang="ru">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </span>
  )
}
