import { dateLabel } from './freshness'
import { parseReleaseYear } from './ingest'
import { isJunk, looksLikeNonGame } from './junk'
import { isEmptyDelta, libraryDelta, minutesByApp } from './libdelta'
import {
  buildTagProfile,
  isMultiplayerMeta,
  isUnplayed,
  normalizedTags,
  rankByTaste,
} from './recommend'
import type { TagWeight } from './tagweight'
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

  // Саундтрек, SDK и демо — не бэклог: их никто не собирался проходить, а
  // портрет считал их в «N лежат нераспакованными» и ставил их обложки в
  // «Чистилище». Та же граница, что у backlogValue и /library.
  const unplayed = library.filter(
    (g) => isUnplayed(g) && !looksLikeNonGame(g, metaOf(g.appid)),
  )

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

/* ---------- итоги года ---------- */

/** Состояние библиотеки на момент — форма getLatestSnapshot и отметок года */
export type LibraryAt = { takenAt: number; games: LibraryGame[] }

/**
 * Окно итогов: от отметки года до его конца. closed — год закрылся (январь,
 * итоги прошлого года); иначе конец окна — последний снимок.
 */
export type YearWindow = { year: number; closed: boolean; base: LibraryAt; end: LibraryAt }

/** Игра года: прирост за окно, а не часы за всё время */
export type YearGame = { appid: number; name: string; minutes: number; sharePercent: number }

export type WrappedYear = {
  year: number
  closed: boolean
  /** Две честные даты: отметка года и снимок, которым окно кончается */
  from: number
  to: number
  /**
   * Окно — не год: подпись «с 23 сентября», а не «Итоги 2026». Отметка
   * ставится при первом за год заходе копией прежнего снимка, поэтому окно
   * бывает и позже начала года (пришёл осенью), и заметно раньше (прежний
   * снимок — прошлогодний или ещё старше, после перерыва). Итогами года
   * честно называется только окно, начатое около первого января.
   */
  partial: boolean
  /** Отметка из прошлых лет — дату писать с годом */
  fromPrevYear: boolean
  /** Наиграно за окно, минут */
  minutes: number
  /** В скольких играх прибавилось */
  playedCount: number
  top: YearGame[]
  /** Появились в библиотеке — «появились», а не «куплены»: покупок сервис не видит */
  added: { count: number; games: LibraryGame[] }
  /** Впервые запущены — были в бэклоге с нулём минут */
  unpacked: { count: number; games: YearGame[] }
  removedCount: number
}

/** Сколько обложек держат полки итогов — счёт при этом полный */
export const YEAR_SHELF_MAX = 12

/**
 * Насколько отметка может отстоять от первого января, чтобы окно ещё было
 * «годом»: неделю после — первый заход в году бывает не первого числа, и
 * месяц до — последний снимок прошлого года бывает не тридцать первого.
 */
export const YEAR_GRACE_SEC = 7 * 86_400
export const YEAR_GRACE_BEFORE_SEC = 31 * 86_400

/** Год по UTC — тот же, по которому ставится отметка (snapshotYear в lib/db) */
function utcYear(sec: number): number {
  return new Date(sec * 1000).getUTCFullYear()
}

function yearStart(year: number): number {
  return Math.floor(Date.UTC(year, 0, 1) / 1000)
}

/** Последний снимок — в январе: итогами становится закрывшийся год */
function inJanuary(sec: number): boolean {
  return new Date(sec * 1000).getUTCMonth() === 0
}

/**
 * Какие годы отметок читать. Год — от последнего снимка, а не от «сейчас»:
 * итоги кэшируются по времени снимка (heavyreads), и год, взятый из часов
 * сервера, разъехался бы с кэшем в новогоднюю ночь. В январе — два года:
 * закрывшийся год кончается отметкой нового.
 */
export function yearsToRead(latestAt: number): [number, number] {
  const y = utcYear(latestAt)
  return inJanuary(latestAt) ? [y - 1, y] : [y, y]
}

/**
 * Окно итогов по последнему снимку и отметкам (getLibraryBaselines).
 *
 * Обычно — текущий год: от его отметки до последнего снимка. В январе, если
 * есть отметки и прошлого, и этого года, — закрывшийся год: от отметки
 * прошлого до отметки нынешнего. Отметка нынешнего года — последнее состояние
 * ДО первого январского захода (saveLibrarySnapshot копирует прежний снимок),
 * то есть ровно конец прошлого года. Без этого правила в январе, когда итогами
 * и делятся, страница показывала бы тонкий срез «декабрь → январь».
 *
 * null — сравнивать не с чем: отметка и есть последний снимок (первый заход
 * в жизни или в году), или отметки нет вовсе.
 */
export function pickYearWindow(
  latest: LibraryAt,
  baselines: ReadonlyArray<LibraryAt & { year: number }>,
): YearWindow | null {
  const y = utcYear(latest.takenAt)
  const cur = baselines.find((b) => b.year === y)
  const prev = baselines.find((b) => b.year === y - 1)
  // Закрывшийся год — только если в нём есть о чём сказать: иначе (заходил
  // в ноябре дважды подряд, а играл в декабре) весь январь не было бы
  // никаких итогов, хотя за декабрь-январь сказать есть что
  if (inJanuary(latest.takenAt) && prev && cur && cur.takenAt > prev.takenAt) {
    const closed = libraryDelta(minutesByApp(prev.games), cur.games, prev.takenAt, () => undefined)
    if (!isEmptyDelta(closed)) return { year: y - 1, closed: true, base: prev, end: cur }
  }
  if (!cur || latest.takenAt <= cur.takenAt) return null
  return { year: y, closed: false, base: cur, end: latest }
}

/**
 * Игры, которым нужна мета для итогов: прибавившие и новые. Остальная
 * библиотека итогам не нужна вовсе — и читать мету сотен нетронутых игр
 * ради года незачем.
 */
export function yearCandidates(w: YearWindow): number[] {
  const before = minutesByApp(w.base.games)
  return w.end.games
    .filter((g) => {
      const was = before.get(g.appid)
      return was === undefined || g.playtimeForever > was
    })
    .map((g) => g.appid)
}

const yearGame = (g: LibraryGame, minutes: number, total: number): YearGame => ({
  appid: g.appid,
  name: g.name,
  minutes,
  sharePercent: total ? Math.round((minutes / total) * 100) : 0,
})

/**
 * Итоги года: разница двух состояний библиотеки (lib/libdelta), а не
 * buildWrapped по «годовой» библиотеке — у того бэклог и эпоха считаются по
 * часам за всё время, и синтетическая библиотека из приростов дала бы в них
 * неправду.
 */
export function buildWrappedYear(w: YearWindow, metaOf: MetaOf): WrappedYear {
  const d = libraryDelta(minutesByApp(w.base.games), w.end.games, w.base.takenAt, metaOf)
  const start = yearStart(w.year)
  return {
    year: w.year,
    closed: w.closed,
    from: w.base.takenAt,
    to: w.end.takenAt,
    partial: w.base.takenAt > start + YEAR_GRACE_SEC || w.base.takenAt < start - YEAR_GRACE_BEFORE_SEC,
    fromPrevYear: w.base.takenAt < start,
    minutes: d.minutes,
    playedCount: d.played.length,
    top: d.played.slice(0, TOP_COUNT).map((p) => yearGame(p.game, p.minutes, d.minutes)),
    added: {
      count: d.added.length,
      // Обложки — только у игр Steam: у чужих магазинов отрицательные id
      games: d.added.filter((g) => g.appid > 0).slice(0, YEAR_SHELF_MAX),
    },
    unpacked: {
      count: d.unpacked.length,
      games: d.unpacked
        .filter((u) => u.game.appid > 0)
        .slice(0, YEAR_SHELF_MAX)
        .map((u) => yearGame(u.game, u.minutes, d.minutes)),
    },
    removedCount: d.removedCount,
  }
}

/**
 * «Итоги 2026» — или «2026 · с 23 сентября», когда окно не год: отметка
 * поставлена осенью или взята из снимка, сделанного задолго до января
 * («2026 · с 5 марта 2024 г.»). Заголовок карточки читают раньше подписи с
 * датами, и «Итоги 2026» над полутора годами игры были бы неправдой.
 */
export function yearEyebrow(y: Pick<WrappedYear, 'year' | 'partial' | 'from' | 'fromPrevYear'>): string {
  return y.partial ? `${y.year} · с ${dateLabel(y.from, { year: y.fromPrevYear })}` : `Итоги ${y.year}`
}

/** Сказать нечего — блок итогов не рисуется */
export function isEmptyYear(y: Pick<WrappedYear, 'minutes' | 'added' | 'unpacked'>): boolean {
  return y.minutes === 0 && y.added.count === 0 && y.unpacked.count === 0
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

/**
 * Непройденная игра, ближайшая по вкусу — «начни с этой».
 *
 * Это совет, а не счётчик, поэтому отсев строже, чем у бэклога: isJunk, а не
 * looksLikeNonGame. Саундтрек стартовой быть не может, и мёртвая сетевая игра
 * тоже — в бэклоге она лежит честно, но начинать с неё не с кем. И то, что
 * владелец попросил больше не показывать (banned), тоже: совет «начни с этой»
 * про скрытую игру — тот же совет, от которого он уже отказался на /play.
 *
 * tagWeight — вес редкости, та же мера вкуса, что у /play (rankByTaste).
 */
export function pickStarter(
  library: LibraryGame[],
  metaOf: MetaOf,
  opts: { banned?: ReadonlySet<number>; tagWeight?: TagWeight | null } = {},
): LibraryGame | null {
  // Фильтр по metaOf обязателен: rankByTaste игры без меты не выбрасывает, а
  // лишь опускает в конец, и без фильтра стартовой могла бы стать игра без тегов
  const candidates = library.filter((g) => {
    const meta = metaOf(g.appid)
    return isUnplayed(g) && meta !== undefined && !opts.banned?.has(g.appid) && !isJunk(g, meta)
  })
  return (
    rankByTaste(candidates, metaOf, buildTagProfile(library, metaOf), opts.tagWeight ?? null)[0] ??
    null
  )
}
