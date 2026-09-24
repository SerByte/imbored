/**
 * Категории Steam, на которых держатся режимы игры.
 *
 * Список «можно с друзьями» жил шестью копиями: SQL-бэкфилл is_multiplayer и
 * запись метаданных в lib/db, движок рекомендаций, вытеснение серий в
 * lib/actual, promote-catalog и разрезанный на кооп и сетевую игру
 * lib/liveness. Тест сверял только две из них. Реши кто-нибудь считать
 * мультиплеером ещё и LAN-кооп — правка в одном месте поменяла бы подбор
 * «с друзьями», но не колонку is_multiplayer и не каноническую игру серии.
 *
 * Модуль без импортов: его читают и db, и движок, и офлайн-скрипты, и ни
 * один из них не должен тянуть за собой другой.
 */

/** 2 Single-player */
export const SINGLE_PLAYER = 2

/**
 * Вместе со своими: 9 Co-op, 24 Shared/Split Screen, 38 Online Co-op,
 * 39 Shared/Split Screen Co-op. Такой игре толпа на серверах не нужна.
 */
export const COOP_IDS: readonly number[] = [9, 24, 38, 39]

/**
 * С незнакомцами: 1 Multi-player, 36 Online PvP, 49 PvP. Этой игре нужна
 * живая толпа — её lib/liveness и судит по онлайну.
 */
export const ONLINE_IDS: readonly number[] = [1, 36, 49]

/** Всё, что означает совместную игру: кооп и сетевая игра вместе */
export const MULTIPLAYER_CATEGORY_IDS: ReadonlySet<number> = new Set([...ONLINE_IDS, ...COOP_IDS])

/**
 * Тот же список для SQL `value IN (…)` — бэкфилл is_multiplayer в lib/db.
 * Числа из этого модуля, а не ввод: подставлять в текст запроса безопасно.
 */
export const MULTIPLAYER_CATEGORY_SQL = [...MULTIPLAYER_CATEGORY_IDS].join(',')

/** Годится ли игра для совместной игры — по категориям Steam, без тегов */
export function isMultiplayerCategories(categories: readonly number[]): boolean {
  return categories.some((c) => MULTIPLAYER_CATEGORY_IDS.has(c))
}
