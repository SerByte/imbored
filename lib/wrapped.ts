import { parseReleaseYear } from './ingest'
import {
  buildTagProfile,
  isMultiplayerMeta,
  isUnplayed,
  normalizedTags,
  rankByTaste,
} from './recommend'
import type { GameMeta, LibraryGame } from './types'

/**
 * Числа для Wrapped-портрета.
 *
 * Часы и обложки есть всегда — они приходят из снапшота библиотеки. Теги,
 * категории и даты выхода появляются после прогрева каталога (ensureMeta →
 * GetItems), и прогрев асинхронный: у только что подключившегося игрока их
 * может не быть. Поэтому всё, что зависит от метаданных, отдаётся как
 * nullable — блок обязан исчезать целиком, а не показывать ноль.
 *
 * Деньги в бэклоге здесь НЕ считаются: для них есть backlogValue() в
 * lib/stats.ts, его же зовёт /library. Одно определение на оба экрана.
 */

export type WrappedGame = {
  appid: number
  name: string
  hours: number
  /** доля от всего наигранного времени, % */
  sharePercent: number
}

export type Wrapped = {
  gamesCount: number
  totalHours: number
  /** часы в сутках, для строки «столько-то суток за экраном» */
  days: number
  unplayedCount: number
  unplayed: LibraryGame[]
  top: WrappedGame[]
  /** сколько игр набирают 80% всего времени */
  pareto80: number
  /** индекс однолюба (HHI), 0 — размазан ровно, 100 — всё в одной игре */
  concentration: number
  /**
   * Доля часов, сыгранных в игры «можно с друзьями». Считается ПО ЧАСАМ и
   * только среди игр с метаданными: мета есть примерно у трети библиотеки,
   * но часы сконцентрированы в топе, который прогревается первым, поэтому
   * по часам покрытие честное, а по числу игр — нет.
   */
  social: { percent: number; coveredHours: number } | null
  /**
   * Эпоха библиотеки: медианный год выпуска, взвешенный ПО ЧАСАМ, и самая
   * старая игра, в которую действительно играли. null, когда год известен
   * меньше чем у трети наигранных часов — иначе одна прогретая игра выдавала
   * бы «твоя эпоха — 2020» за всю библиотеку.
   */
  era: { medianYear: number; oldest: { appid: number; name: string; year: number } } | null
}

const TOP_COUNT = 5

/** Ниже этой доли покрытых часов год выпуска считается неизвестным */
const ERA_MIN_COVERAGE = 1 / 3

type MetaOf = (appid: number) => GameMeta | undefined

export function buildWrapped(library: LibraryGame[], metaOf: MetaOf): Wrapped {
  const totalMinutes = library.reduce((s, g) => s + g.playtimeForever, 0)
  const totalHours = Math.round(totalMinutes / 60)

  const played = library
    .filter((g) => g.playtimeForever > 0)
    .sort((a, b) => b.playtimeForever - a.playtimeForever)

  const top: WrappedGame[] = played.slice(0, TOP_COUNT).map((g) => ({
    appid: g.appid,
    name: g.name,
    hours: Math.round(g.playtimeForever / 60),
    sharePercent: totalMinutes ? Math.round((g.playtimeForever / totalMinutes) * 100) : 0,
  }))

  let pareto80 = 0
  let concentration = 0
  if (totalMinutes > 0) {
    const threshold = totalMinutes * 0.8
    let cumulative = 0
    for (const g of played) {
      cumulative += g.playtimeForever
      pareto80++
      if (cumulative >= threshold) break
    }
    let hhi = 0
    for (const g of played) {
      const share = g.playtimeForever / totalMinutes
      hhi += share * share
    }
    concentration = Math.round(hhi * 100)
  }

  const unplayed = library.filter(isUnplayed)

  let socialMinutes = 0
  let coveredMinutes = 0
  for (const g of library) {
    const meta = metaOf(g.appid)
    if (!meta) continue
    coveredMinutes += g.playtimeForever
    if (isMultiplayerMeta(meta)) socialMinutes += g.playtimeForever
  }

  return {
    gamesCount: library.length,
    totalHours,
    days: Math.round(totalHours / 24),
    era: buildEra(played, metaOf, totalMinutes),
    unplayedCount: unplayed.length,
    unplayed,
    top,
    pareto80,
    concentration,
    social: coveredMinutes
      ? {
          percent: Math.round((socialMinutes / coveredMinutes) * 100),
          coveredHours: Math.round(coveredMinutes / 60),
        }
      : null,
  }
}

/**
 * Режет список на блоки мозаики: первый — самые крупные плитки, дальше мельче.
 *
 * Каждый блок обрезается до кратного `step` — числа плиток, заполняющего ряд
 * и на телефоне, и на десктопе. Без этого в мозаике появляются дыры: ряд из
 * плиток разной ширины выравнивается по самой высокой, и под мелкими остаётся
 * пустота. Здесь ширина внутри блока всегда одна, а блок кончается ровно на
 * границе ряда.
 */
export function mosaicBlocks(
  games: LibraryGame[],
  plan: Array<{ take: number; step: number }>,
): LibraryGame[][] {
  const out: LibraryGame[][] = []
  let from = 0
  for (const { take, step } of plan) {
    const slice = games.slice(from, from + take)
    const fitted = slice.slice(0, Math.floor(slice.length / step) * step)
    if (!fitted.length) break
    out.push(fitted)
    from += fitted.length
    // блок не набрался целиком — дальше брать нечего
    if (fitted.length < take) break
  }
  return out
}

/**
 * Медианный год по часам считается только по наигранным играм: непройденные
 * покупки говорят о распродажах, а не о вкусе.
 * `played` уже отсортирован по часам убыв.
 */
function buildEra(
  played: LibraryGame[],
  metaOf: MetaOf,
  totalMinutes: number,
): Wrapped['era'] {
  if (!totalMinutes) return null

  const dated: Array<{ game: LibraryGame; year: number }> = []
  let coveredMinutes = 0
  for (const game of played) {
    const year = parseReleaseYear(metaOf(game.appid)?.releaseDate)
    if (!year) continue
    dated.push({ game, year })
    coveredMinutes += game.playtimeForever
  }
  if (!dated.length || coveredMinutes / totalMinutes < ERA_MIN_COVERAGE) return null

  const byYear = [...dated].sort((a, b) => a.year - b.year)
  const target = coveredMinutes / 2
  let cumulative = 0
  let medianYear = byYear[0].year
  for (const d of byYear) {
    cumulative += d.game.playtimeForever
    medianYear = d.year
    if (cumulative >= target) break
  }

  const oldest = byYear[0]
  return {
    medianYear,
    oldest: { appid: oldest.game.appid, name: oldest.game.name, year: oldest.year },
  }
}

/**
 * Игры, которые действительно тянут архетип — «улики» под ярлыком.
 * exclude нужен, чтобы не показать те же обложки, что уже стоят в топе:
 * вес в buildTagProfile определяется в основном часами, поэтому без
 * исключения улики совпали бы с топом почти всегда.
 */
export function archetypeEvidence(
  library: LibraryGame[],
  metaOf: MetaOf,
  tag: string,
  exclude: Set<number>,
  limit: number,
): LibraryGame[] {
  const scored: Array<{ game: LibraryGame; score: number }> = []
  for (const g of library) {
    if (exclude.has(g.appid)) continue
    const meta = metaOf(g.appid)
    if (!meta) continue
    const share = normalizedTags(meta)[tag]
    if (!share) continue
    let weight = Math.log1p(g.playtimeForever / 60)
    if (weight === 0) continue
    if (g.playtime2Weeks > 0) weight *= 1.5
    scored.push({ game: g, score: weight * share })
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.game)
}

/** Непройденная игра, ближайшая по вкусу — «начни с этой» */
export function pickStarter(library: LibraryGame[], metaOf: MetaOf): LibraryGame | null {
  // Фильтр по metaOf обязателен: rankByTaste игры без меты не выбрасывает, а
  // лишь опускает в конец, и без фильтра стартовой могла бы стать игра без тегов
  const candidates = library.filter((g) => isUnplayed(g) && metaOf(g.appid))
  return rankByTaste(candidates, metaOf, buildTagProfile(library, metaOf))[0] ?? null
}
