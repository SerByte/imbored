import { looksLikeNonGame } from './junk'
import { minutesHidden, playtimeHidden } from './playtime'
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
 * - Прежнее время скрыто настройками Steam (lib/playtime.ts) — минут не
 *   считаем вовсе: ни прироста, ни распакованных, ни часов новых игр. Ноль
 *   там — галочка, а не ноль минут, и человек, снявший её, получил бы в
 *   «наиграно» все свои часы за жизнь, а всю библиотеку — во «впервые
 *   запущены». Часы одних новинок тоже не в счёт: «наиграно» без прежних игр
 *   читалось бы итогом, а было бы его обрывком. Появившиеся и пропавшие
 *   считаются как обычно — список игр галочка не прячет.
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
  // Прежнее время скрыто — минуты считать не от чего (см. ПРАВИЛА)
  const blind = minutesHidden(before)

  for (const g of after) {
    seen.add(g.appid)
    const was = before.get(g.appid)
    if (was === undefined) {
      // Последний запуск раньше отметки — игра была и тогда, просто Steam её не отдал
      if (g.lastPlayed !== undefined && g.lastPlayed > 0 && g.lastPlayed < sinceAt) continue
      if (!blind && g.playtimeForever > 0) {
        minutes += g.playtimeForever
        played.push({ game: g, minutes: g.playtimeForever })
      }
      if (!looksLikeNonGame(g, metaOf(g.appid))) added.push(g)
      continue
    }
    if (blind) continue
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
 *
 * Снимок со скрытым временем (lib/playtime.ts) — тоже не точка отсчёта.
 * Про минуты libraryDelta с ним честно промолчит, но строка «с 3 сентября ·
 * 2 новые игры» читалась бы как «с тех пор не играл», а снимок старше, если
 * он с часами, скажет всё. Путь сюда ведёт сама подсказка
 * PlaytimeHiddenNote: снял галочку, подключил библиотеку заново — и первым
 * же открытым снимком строка сравнивала бы с нулями галочки.
 *
 * Скрыт сам последний снимок (галочку только что поставили) — строки нет
 * вовсе. Прирост до нулей ноль, и осталось бы то же «с 3 сентября · 2 новые
 * игры» без минут, только с другого конца. Про минуты там скажут шапка
 * («время в играх — скрыто») и PlaytimeHiddenNote, а новые игры без минут —
 * не та динамика, ради которой строка.
 */
export function pickSnapshotDelta(
  older: ReadonlyArray<{ takenAt: number; minutes: ReadonlyMap<number, number> }>,
  latest: { takenAt: number; games: readonly LibraryGame[] },
  metaOf: MetaOf,
): { fromAt: number; delta: LibraryDelta } | null {
  if (playtimeHidden(latest.games)) return null
  const candidates = older
    .filter((o) => o.takenAt < latest.takenAt && o.minutes.size > 0 && !minutesHidden(o.minutes))
    .sort((a, b) => b.takenAt - a.takenAt)
  for (const o of candidates) {
    const delta = libraryDelta(o.minutes, latest.games, o.takenAt, metaOf)
    if (!isEmptyDelta(delta)) return { fromAt: o.takenAt, delta }
  }
  return null
}
