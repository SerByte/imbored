import type { LibraryFilter } from './forgotten'

/*
 * Отдельный модуль, а не часть lib/forgotten.ts: адрес полки строит и
 * клиентское поле поиска (components/LibrarySearch), а forgotten тянет за
 * собой движок подбора, которому в браузере делать нечего. Импорт типа
 * LibraryFilter стирается при сборке и цикла не создаёт.
 */

/** Потолок длины запроса поиска по библиотеке: название, а не абзац */
export const LIBRARY_QUERY_MAX = 60

/**
 * Адрес полки. Смена фильтра сбрасывает порцию: у новой полки своя длина, и
 * «третья порция заброшенных» ничего не значит для нераспакованных.
 */
export function libraryHref(filter: LibraryFilter, page = 1, q = ''): string {
  const qs = new URLSearchParams()
  if (filter !== 'all') qs.set('state', filter)
  // Поиск переживает смену полки: человек ищет «Portal» и перебирает, где
  // она лежит, — стирать запрос при каждом чипсе значило бы набирать заново
  if (q) qs.set('q', q)
  if (page > 1) qs.set('page', String(page))
  const s = qs.toString()
  return s ? `/library?${s}` : '/library'
}
