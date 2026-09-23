import type { GameMeta, LibraryGame } from './types'

/**
 * Отсев не-игр из библиотеки.
 *
 * GetOwnedGames отдаёт не только игры: саундтреки, редакторы, dedicated
 * server-ы, SDK, демки, playtest-ы. У всех у них ноль часов, поэтому в списке
 * «ни разу не запускал» они оказались бы первыми и список выглядел бы
 * сломанным. Рантайм от них не защищён ничем: judgeLiveness пропускает всё,
 * что похоже на одиночную игру, а «похоже» — это в том числе пустые категории.
 *
 * Честная граница возможностей: это убирает то, от чего список выглядит
 * сломанным, но корректности не даёт — редактор или демка с настоящими тегами
 * пройдут. Настоящее решение — колонка is_game из членства в catalog_ingest
 * (он наполняется из раздела «Игры» магазина), но это правка офлайн-пайплайна
 * и публикации, а не этой фичи.
 *
 * Принцип: выбрасываем ТОЛЬКО при положительном свидетельстве мусора. Игра без
 * метаданных — не мусор, а непрогретая игра, и таких у больших библиотек много.
 */

/**
 * Маркеры не-игр в конце названия. Матчим только с разделителем перед ними и
 * только в хвосте: голое вхождение слова выкинуло бы «Tools Up!»,
 * «The Beginner's Guide» и «Demolition Company».
 */
const JUNK_SUFFIX =
  /[-–—:(\[|]\s*(original\s+)?(soundtrack|ost|artbook|art\s+book|sdk|dedicated\s+server|demo|playtest|beta|benchmark|trailer|bonus\s+content|digital\s+deluxe\s+upgrade)\b/i

/** То же самое, но без разделителя: «Half-Life 2 Demo», «TF2 Dedicated Server» */
const JUNK_TAIL = /\s(dedicated\s+server|demo|playtest|beta|soundtrack|ost|sdk|artbook|benchmark)$/i

/** Стабы, которые /api/prepare заводит до прогрева: имени ещё нет */
const STUB_NAME = /^App \d+$/

export function looksLikeJunkName(name: string): boolean {
  return JUNK_SUFFIX.test(name) || JUNK_TAIL.test(name) || STUB_NAME.test(name)
}

/**
 * Не игра вовсе: саундтрек, SDK, сервер, демо, пустая запись.
 *
 * Слои по убыванию надёжности:
 *  3. вердикт офлайн-курации (signalsAt непустой — appid прошёл через
 *     games-only пайплайн, значит это точно игра);
 *  2. прогретая запись без единого тега и без категорий — так выглядят
 *     саундтреки и инструменты после GetItems;
 *  1. название.
 *
 * Это граница для СЧЁТЧИКОВ бэклога: «N лежат нераспакованными», цена
 * бэклога, «Чистилище» на портрете, «ни разу не запускал» на /library.
 * Саундтрек никто не собирался проходить, и в бэклоге ему не место. Мёртвая
 * сетевая игра — другое дело: её купили, и она лежит, поэтому здесь нет
 * проверки alive, в отличие от isJunk.
 */
export function looksLikeNonGame(game: LibraryGame, meta: GameMeta | undefined): boolean {
  // Слой 3: каталог уже вынес вердикт — он сильнее любой эвристики по имени
  if (meta?.signalsAt !== undefined) return false

  if (looksLikeJunkName(game.name)) return true

  // Слой 2: только для прогретых записей — у непрогретой игры меты нет вовсе,
  // и молчание там означает «ещё не знаем», а не «ни тегов, ни категорий».
  if (meta && !Object.keys(meta.tags).length && !meta.categories.length) return true

  return false
}

/**
 * Стоит ли прятать эту запись библиотеки от игрока — там, где ей что-то
 * СОВЕТУЮТ: подбор, полка забытого, «начни с этой».
 *
 * Строже looksLikeNonGame на один шаг: при вердикте каталога прячется и
 * мёртвая, и заменённая новым изданием игра. Посоветовать сетевую игру с
 * пустыми серверами — это совет, который не сработает, а посчитать её в
 * бэклоге — просто правда.
 */
export function isJunk(game: LibraryGame, meta: GameMeta | undefined): boolean {
  if (meta?.signalsAt !== undefined) {
    return meta.alive === false || meta.supersededBy !== undefined
  }
  return looksLikeNonGame(game, meta)
}
