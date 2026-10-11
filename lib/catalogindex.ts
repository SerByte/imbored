import { useSyncExternalStore } from 'react'
import { readSearchIndex, SEARCH_INDEX_PATH, type SearchEntry, type SearchPhase } from './catalogsearch'

/**
 * Индекс каталога в браузере: едет по первой просьбе и живёт до конца вкладки.
 *
 * Просит его окно поиска при открытии (components/CatalogSearch) — не страница
 * и не кнопка: ~64 КБ br на 5.6 тысячи игр (докблок app/search-index.json)
 * платит только тот, кто поиск открыл. Дальше индекс один на вкладку: окно
 * открывают из шапки, на /games, снова из шапки после перехода, а клиентские
 * переходы модуль не выгружают — второй раз он не едет. Перезагрузка
 * страницы спросит снова, и ответит кэш CDN (маршрут статический).
 *
 * Внешнее хранилище, а не состояние окна: окно размонтируется при каждом
 * закрытии, а индекс должен его пережить. useSyncExternalStore — штатный
 * способ подписать на такое React; серверный снимок — «не просили»: на
 * сервере окна не бывает, а первый кадр гидратации обязан с ним совпасть.
 */

export type CatalogIndex = { phase: SearchPhase; entries: SearchEntry[] }

const IDLE: CatalogIndex = { phase: 'idle', entries: [] }

/**
 * Сколько ждать индекс. ~64 КБ — секунда на 3G и несколько на плохой связи;
 * дольше — и строка «Загружаю каталог…» висела бы вечно, а кнопки повтора
 * человек так и не увидел бы.
 */
const INDEX_WAIT_MS = 20_000

let state: CatalogIndex = IDLE
const listeners = new Set<() => void>()

function set(next: CatalogIndex): void {
  state = next
  for (const l of listeners) l()
}

export function getCatalogIndex(): CatalogIndex {
  return state
}

export function subscribeCatalogIndex(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

/**
 * Попросить индекс. Едет или приехал — ничего не делает: второе окно не
 * качает его заново. Не доехал — качает снова, и это и есть повтор.
 *
 * Отказ гаснет до первого await: фаза уходит в loading сразу, и второй отказ
 * подряд приходит в строку статуса изменением текста, а не тем же текстом
 * (components/StatusLine, сторож REPEAT в lib/liveregion.test.ts).
 *
 * Не JSON индекса — тоже отказ: вместо него может приехать страница ошибки
 * хостинга, и пустой поиск выглядел бы как «ничего не нашлось» на любой
 * запрос, а не как поломка, которую можно повторить.
 */
export async function requestCatalogIndex(): Promise<void> {
  if (state.phase === 'loading' || state.phase === 'ready') return
  set({ phase: 'loading', entries: [] })
  try {
    const res = await fetch(SEARCH_INDEX_PATH, { signal: AbortSignal.timeout(INDEX_WAIT_MS) })
    if (!res.ok) throw new Error(`индекс каталога: HTTP ${res.status}`)
    const entries = readSearchIndex(await res.json())
    if (!entries) throw new Error('индекс каталога: не та форма')
    set({ phase: 'ready', entries })
  } catch {
    set({ phase: 'failed', entries: [] })
  }
}

const serverIndex = () => IDLE

export function useCatalogIndex(): CatalogIndex {
  return useSyncExternalStore(subscribeCatalogIndex, getCatalogIndex, serverIndex)
}

/** Только для тестов: индекс живёт на модуле и иначе тёк бы из случая в случай */
export function resetCatalogIndex(): void {
  state = IDLE
  listeners.clear()
}
