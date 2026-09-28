import type { GameArtUrls } from './art'
import { buildPortrait, type Archetype, type Portrait } from './portrait'
import { backlogValue } from './stats'
import type { TagWeight } from './tagweight'
import type { GameMeta, LibraryGame } from './types'
import {
  archetypeEvidence,
  buildWrapped,
  buildWrappedYear,
  isEmptyYear,
  mosaicBlocks,
  pickStarter,
  type Wrapped,
  type WrappedYear,
  type YearWindow,
} from './wrapped'

/**
 * Всё, что страница /portrait/[steamid] рисует по библиотеке и метаданным, —
 * одним объектом, который можно положить в кэш.
 *
 * Зачем объект, а не расчёт на месте. Страница публичная и force-dynamic:
 * адрес с чужим steamid открывает кто угодно и сколько угодно раз, а сборка
 * портрета читает метаданные ВСЕЙ библиотеки. У коллекционера это тысячи
 * строк Turso на каждый GET. Результат при этом зависит только от снапшота,
 * поэтому страница кэширует этот объект по ключу [steamid, takenAt] (см.
 * unstable_cache там), а ходит в базу за метаданными один раз на снапшот.
 *
 * Поэтому объект обязан пережить JSON: кэш Next хранит его строкой. Никаких
 * Map и Set, и ничего сверх того, что реально рисуется: полный список
 * нераспакованного (Wrapped.unplayed) у большой библиотеки — десятки тысяч
 * записей, а на экран из него попадает чистилище в тридцать шесть обложек.
 */

/** Обложка — единственное, что странице нужно от метаданных игры поштучно */
export type CoverArt = { headerImage: string | null; art: GameArtUrls | null }

export type PortraitModel = {
  portrait: Portrait
  /** Без unplayed: см. докблок модуля */
  wrapped: Omit<Wrapped, 'unplayed'>
  backlog: ReturnType<typeof backlogValue>
  /** Архетип для заголовка: только со словарной подписью */
  headline: Archetype | null
  evidence: LibraryGame[]
  starter: LibraryGame | null
  mosaic: LibraryGame[][]
  purgatory: LibraryGame[]
  /**
   * Итоги года (lib/wrapped, buildWrappedYear); null — сравнивать не с чем
   * или сказать нечего: блок на странице не рисуется
   */
  year: WrappedYear | null
  /** Обложки ровно тех игр, что стоят на странице; ключ — appid */
  covers: Record<number, CoverArt>
}

/** Страница /portrait/[steamid]/year — итоги и обложки ровно их игр */
export type YearModel = { year: WrappedYear; covers: Record<number, CoverArt> }

type MetaOf = (appid: number) => GameMeta | undefined

/** Обложки ровно тех игр, что стоят на странице — не всей библиотеки */
export function coversOf(shown: ReadonlyArray<{ appid: number }>, metaOf: MetaOf): Record<number, CoverArt> {
  const covers: Record<number, CoverArt> = {}
  for (const { appid } of shown) {
    const meta = metaOf(appid)
    covers[appid] = { headerImage: meta?.headerImage ?? null, art: meta?.art ?? null }
  }
  return covers
}

/** Игры итогов, которым нужна обложка: топ, распакованные, появившиеся */
function yearShown(y: WrappedYear): Array<{ appid: number }> {
  return [...y.top, ...y.unpacked.games, ...y.added.games]
}

/** Модель страницы года. null — сравнивать не с чем или сказать нечего */
export function buildYearModel(w: YearWindow, metaOf: MetaOf): YearModel | null {
  const year = buildWrappedYear(w, metaOf)
  if (isEmptyYear(year)) return null
  return { year, covers: coversOf(yearShown(year), metaOf) }
}

/** Сколько обложек у стены нераспакованного */
export const PURGATORY_MAX = 36

/**
 * Тег кэша модели портрета. Одно место на страницу и на роуты, которые
 * меняют то, из чего модель собрана без нового снапшота: бан и его снятие
 * (стартовая «начни с этой» обходит скрытое). Модуль без серверных импортов —
 * сам сброс (revalidateTag) делают роуты.
 */
export function portraitTag(steamid: string): string {
  return `portrait:${steamid}`
}

/**
 * Собрать модель. metaOf без метаданных (() => undefined) даёт страницу-шаблон:
 * числа, топ и мозаика — из одного снапшота, без архетипов, улик и денег.
 * Обложки у неё всё равно будут: GameArt строит запасную ссылку по appid.
 *
 * banned — «Больше не показывать» владельца: стартовая их обходит. Счётчики и
 * «Чистилище» — нет: скрытая игра всё равно куплена и лежит. tagWeight — вес
 * редкости для стартовой: та же мера вкуса, что у /play.
 */
export function buildPortraitModel(
  games: LibraryGame[],
  metaOf: (appid: number) => GameMeta | undefined,
  nowSec: number,
  mosaicPlan: Array<{ take: number; step: number }>,
  opts: {
    banned?: ReadonlySet<number>
    tagWeight?: TagWeight | null
    /** Окно итогов года (pickYearWindow); без него блока итогов нет */
    yearWindow?: YearWindow | null
  } = {},
): PortraitModel {
  const portrait = buildPortrait(games, metaOf)
  const { unplayed, ...wrapped } = buildWrapped(games, metaOf)
  const backlog = backlogValue(games, metaOf, nowSec)

  // Заголовок-диагноз только со словарной подписью: фолбэк «фанат Fantasy»
  // простителен в 14px, но не во весь экран
  const headline = portrait.archetypes.find((a) => a.known) ?? null
  // Улики не должны повторить подиум: вес архетипа определяется в основном
  // часами, поэтому без исключения это были бы те же самые обложки
  const shownOnPodium = new Set(wrapped.top.map((g) => g.appid))
  const evidence = headline ? archetypeEvidence(games, metaOf, headline.tag, shownOnPodium, 3) : []
  const starter = pickStarter(games, metaOf, opts)

  // Мозаика и стена: только Steam-игры, у не-Steam записей арта нет
  const steamGames = games.filter((g) => g.appid > 0)
  const mosaic = mosaicBlocks(
    [...steamGames].sort((a, b) => b.playtimeForever - a.playtimeForever),
    mosaicPlan,
  )
  const purgatory = unplayed.filter((g) => g.appid > 0).slice(0, PURGATORY_MAX)

  const built = opts.yearWindow ? buildWrappedYear(opts.yearWindow, metaOf) : null
  const year = built && !isEmptyYear(built) ? built : null

  const shown: Array<{ appid: number }> = [...wrapped.top, ...evidence, ...mosaic.flat(), ...purgatory]
  if (starter) shown.push(starter)
  if (year) shown.push(...yearShown(year))
  const covers = coversOf(shown, metaOf)

  return { portrait, wrapped, backlog, headline, evidence, starter, mosaic, purgatory, year, covers }
}
