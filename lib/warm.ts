import { isUntouched } from './recommend'
import type { LibraryGame } from './types'

/** Потолок на очень больших библиотеках, чтобы прогрев оставался конечным */
export const LIBRARY_CAP = 1200

/**
 * Снапшот старше этого — перезапрашиваем у Steam.
 *
 * До появления обновления снапшот писался ТОЛЬКО при входе, а сессия живёт
 * 30 дней: месяц сервис работал с замороженным вектором часов. Для «ни разу не
 * запускал» это худший из возможных багов — полка уверенно называла бы игру,
 * которую человек запустил вчера по нашему же совету.
 */
export const SNAPSHOT_MAX_AGE_SEC = 6 * 3600

/**
 * Стоит ли идти в Steam за свежей библиотекой. Отдельный чистый предикат,
 * потому что сам поход — это сеть и запись в базу, а решение проверяемо.
 *
 * isDemo приходит параметром, а не считается здесь: lib/server тянет за собой
 * next/headers и клиент базы, а этот модуль должен оставаться пустым внутри.
 */
export function shouldRefreshSnapshot(args: {
  isDemo: boolean
  takenAt: number
  nowSec: number
  hasApiKey: boolean
}): boolean {
  if (args.isDemo) return false
  if (!args.hasApiKey) return false
  return args.nowSec - args.takenAt >= SNAPSHOT_MAX_AGE_SEC
}

/**
 * В каком порядке греть метаданные под библиотеку игрока.
 *
 * Раньше это была одна строка в /api/prepare: отсортировать по часам вниз и
 * обрезать до потолка. У этого была неочевидная цена — незапущенные игры
 * оказывались строго в хвосте, а `remaining` считается только по возвращённому
 * набору, поэтому циклы клиента завершались и «следующей страницы» не было.
 * У игрока с 1200+ наигранными играми незапущенные не получали метаданных
 * НИКОГДА: ни обложки в библиотеке, ни цены в бэклоге, ни шанса попасть в
 * выдачу — scoreCandidates пропускает игру без меты. То есть ровно та часть
 * библиотеки, ради которой человек сюда и приходит.
 *
 * Поэтому две очереди сливаются через одну. Размер целевого набора прежний,
 * первый прогрев не стал длиннее — изменился только порядок внутри него.
 *
 * Функция чистая и живёт в lib/, потому что под app/ тесты не запускаются:
 * vitest.config.mts собирает их только из lib/.
 */
export function buildWarmPlan(
  games: LibraryGame[],
  pool: number[],
  cap = LIBRARY_CAP,
): number[] {
  const played = games
    .filter((g) => !isUntouched(g))
    .sort((a, b) => b.playtimeForever - a.playtimeForever)
    .map((g) => g.appid)
  // Порядок обязан быть детерминированным: маршрут дёргается в цикле, и
  // плавающая очередь означала бы, что каждый вызов греет другую сотню игр,
  // а remaining никогда не сходится к нулю. Часов у них нет, сортируем по appid.
  const untouched = games
    .filter(isUntouched)
    .map((g) => g.appid)
    .sort((a, b) => a - b)

  const merged: number[] = []
  for (let i = 0; i < Math.max(played.length, untouched.length); i++) {
    if (i < played.length) merged.push(played[i])
    if (i < untouched.length) merged.push(untouched[i])
  }

  // Пулу «попробуй новое» слоты бронируются, а не достаются по остатку: при
  // библиотеке больше потолка старое выражение `[...библиотека, ...пул]`
  // с последующей обрезкой молча выкидывало пул целиком.
  const libraryRoom = Math.max(cap - pool.length, 0)
  return [...new Set([...merged.slice(0, libraryRoom), ...pool])].slice(0, cap)
}
