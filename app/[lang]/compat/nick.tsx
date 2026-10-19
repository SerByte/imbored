import type { ReactNode } from 'react'
import type { Locale } from '@/lib/i18n'
import { withForeignRuns } from '@/lib/textlang'

/*
 * Ники из Steam и названия игр на английской странице совместимости.
 *
 * Это данные, их не переводят, но голос скринридера выбирается по lang: на
 * /en русский ник («Костя») без пометки английский голос читает по буквам.
 * Правило пометки — одно на сайт: langOn и withForeignRuns из
 * lib/textlang.ts. Здесь — только обёртка под флекс-родителей страницы.
 */

/**
 * Целая фраза с никами внутри: на /en каждый русский ник — своим
 * <span lang="ru">, остальное наследует lang страницы (withForeignRuns).
 *
 * Нечего помечать (русская страница, латинские ники) — та же строка, одним
 * текстовым узлом, как раньше. Есть что — куски в ОДНОМ общем <span>: фраза
 * стоит и во flex-родителях (.link-more — inline-flex с gap), и без обёртки
 * каждый кусок стал бы там своим флекс-элементом — «Костя 's player portrait»
 * с зазором посреди слова.
 */
export function withNicks(locale: Locale, text: string, names: ReadonlyArray<string | null | undefined>): ReactNode {
  const runs = withForeignRuns(locale, text, names)
  return typeof runs === 'string' ? runs : <span>{runs}</span>
}
