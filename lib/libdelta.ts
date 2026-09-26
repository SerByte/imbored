import { looksLikeNonGame } from './junk'
import type { GameMeta, LibraryGame } from './types'

/**
 * Разница двух состояний библиотеки — «что изменилось с тех пор».
 *
 * Steam отдаёт только часы за всё время, без истории, поэтому любая динамика
 * — это вычитание двух снимков: строка «с прошлого снимка» на /library и
 * «Итоги года» в портрете (lib/wrapped.ts, buildWrappedYear) считают одно и
 * то же, и правила у них общие — здесь.
 *
 * ПРАВИЛА.
 * - Минуты игры — прирост, не меньше нуля: Steam иногда отдаёт часы меньше
 *   прежних (сброс, чужой семейный доступ), и минус в «наиграно» — враньё.
 * - Новая игра считается целиком: до отметки её не было, всё сыгранное в ней
 *   — сыграно после. Исключение — игра, которую, по словам самого Steam,
 *   последний раз запускали ДО отметки (lastPlayed < sinceAt): это не
 *   новинка, а частичный ответ Steam в прошлый раз, и считать её часы за
 *   «после» нельзя.
 * - «Распаковано» — было ноль минут, стало больше нуля. Новая и сразу
 *   сыгранная игра — «появилась», а не «распакована»: из бэклога её не
 *   доставали, её в нём не было.
 * - Саундтреки, SDK и демо (looksLikeNonGame) не бывают ни новинкой, ни
 *   распакованной — их никто не собирался проходить. Их минуты в общий счёт
 *   идут: наиграно — значит наиграно.
 * - Пропавшие игры (были, а теперь нет) только считаются: их часы не
 *   вычитаются — сыгранное не отменяется тем, что игра ушла из библиотеки.
 *
 * Модуль чистый: без базы, без Map и Set в результате — он уезжает в кэш
 * портрета JSON-ом (lib/portraitmodel).
 */

export type MetaOf = (appid: number) => GameMeta | undefined

export type PlayedDelta = { game: LibraryGame; minutes: number }

export type LibraryDelta = {
  /** Наиграно всего, минут */
  minutes: number
  /** Игры с приростом, больше минут — выше; при равенстве — по appid */
  played: PlayedDelta[]
  /** Появились в библиотеке — больше наиграно всего — выше */
  added: LibraryGame[]
  /** Было ноль минут, стало больше — больше прирост — выше */
  unpacked: PlayedDelta[]
  /** Были и пропали */
  removedCount: number
}

/** Минуты по appid — компактная форма прежнего состояния */
export function minutesByApp(games: readonly LibraryGame[]): Map<number, number> {
  return new Map(games.map((g) => [g.appid, g.playtimeForever]))
}

const byMinutes = (a: PlayedDelta, b: PlayedDelta) => b.minutes - a.minutes || a.game.appid - b.game.appid

export function libraryDelta(
  before: ReadonlyMap<number, number>,
  after: readonly LibraryGame[],
  sinceAt: number,
  metaOf: MetaOf,
): LibraryDelta {
  let minutes = 0
  const played: PlayedDelta[] = []
  const added: LibraryGame[] = []
  const unpacked: PlayedDelta[] = []
  const seen = new Set<number>()

  for (const g of after) {
    seen.add(g.appid)
    const was = before.get(g.appid)
    if (was === undefined) {
      // Последний запуск раньше отметки — игра была и тогда, просто Steam её не отдал
      if (g.lastPlayed !== undefined && g.lastPlayed > 0 && g.lastPlayed < sinceAt) continue
      if (g.playtimeForever > 0) {
        minutes += g.playtimeForever
        played.push({ game: g, minutes: g.playtimeForever })
      }
      if (!looksLikeNonGame(g, metaOf(g.appid))) added.push(g)
      continue
    }
    const gained = Math.max(0, g.playtimeForever - was)
    if (gained === 0) continue
    minutes += gained
    played.push({ game: g, minutes: gained })
    if (was === 0 && !looksLikeNonGame(g, metaOf(g.appid))) unpacked.push({ game: g, minutes: gained })
  }

  let removedCount = 0
  for (const appid of before.keys()) if (!seen.has(appid)) removedCount++

  return {
    minutes,
    played: played.sort(byMinutes),
    added: added.sort((a, b) => b.playtimeForever - a.playtimeForever || a.appid - b.appid),
    unpacked: unpacked.sort(byMinutes),
    removedCount,
  }
}

/** Сказать нечего: ни минуты, ни новой игры, ни распакованной */
export function isEmptyDelta(d: Pick<LibraryDelta, 'minutes' | 'added' | 'unpacked'>): boolean {
  return d.minutes === 0 && d.added.length === 0 && d.unpacked.length === 0
}

/**
 * Строка «с прошлого снимка» на /library: с какого из хранимых снимков
 * сравнивать.
 *
 * Не просто с предыдущим. Вход через Steam и подключение по ссылке пишут
 * снимок каждый раз, и предыдущий часто моложе получаса — разница нулевая,
 * и строка молчала бы как раз у того, кто заходит часто. Поэтому — от
 * свежего к старому, первый снимок, с которым есть о чём сказать.
 *
 * Снимки новее или ровесники последнего отбрасываются: чтения идут
 * параллельно, и снимок, записанный между ними, сдвинул бы OFFSET.
 * Пустой прежний снимок (старые строки без игр) — не точка отсчёта: с ним
 * «новым» оказалось бы всё.
 */
export function pickSnapshotDelta(
  older: ReadonlyArray<{ takenAt: number; minutes: ReadonlyMap<number, number> }>,
  latest: { takenAt: number; games: readonly LibraryGame[] },
  metaOf: MetaOf,
): { fromAt: number; delta: LibraryDelta } | null {
  const candidates = older
    .filter((o) => o.takenAt < latest.takenAt && o.minutes.size > 0)
    .sort((a, b) => b.takenAt - a.takenAt)
  for (const o of candidates) {
    const delta = libraryDelta(o.minutes, latest.games, o.takenAt, metaOf)
    if (!isEmptyDelta(delta)) return { fromAt: o.takenAt, delta }
  }
  return null
}
