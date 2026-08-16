import { hashString } from './daily'
import { isJunk } from './junk'
import { type AnswerValue, STEPS } from './quiz'
import { isMultiplayerMeta, isUntouched, timeFit, VIBE_TAGS } from './recommend'
import type { GameMeta, LibraryGame } from './types'

/**
 * Какая обложка стоит за каждым ответом квиза.
 *
 * Квиз показывает семь панелей с игровым артом из СВОЕЙ библиотеки. Обложка
 * здесь — фактура, а не обещание: она сильно размыта и обесцвечена, названия
 * нет. Но фактура всё равно должна что-то значить, иначе это просто картинки.
 *
 * Почему не переиспользуется scoreCandidates: она по построению отбирает только
 * 'unplayed' и 'comeback' (см. её тело), то есть игра, в которой человек утонул
 * на триста часов, кандидатом не станет никогда. Для рекомендации это верно —
 * незачем советовать то, во что и так играют, — а для обложки «Весь вечер»
 * ровно наоборот: именно она и есть лучший ответ.
 *
 * Второе отличие: там нужно целое настроение, здесь — одна ось за раз.
 */

type MetaOf = (appid: number) => GameMeta | undefined

/** Обложка панели. Только header 460×215 — hero и 2x весят и здесь не нужны. */
export type QuizCover = {
  appid: number
  name: string
  headerImage?: string
  art?: { header: string }
}

export type QuizCovers = Partial<Record<AnswerValue, QuizCover>>

/**
 * Сколько верхних кандидатов участвуют в недельной ротации.
 *
 * Не весь список: иначе под «Весь вечер» мог бы встать трёхчасовой проходняк
 * вместо той самой игры на триста часов. Три — это «набор оживает раз в
 * неделю», а не «набор случайный».
 */
const ROTATION_WINDOW = 3

/**
 * Сдвиг выборки: свой у каждого игрока и свой на каждой неделе.
 *
 * Тот же приём, что rotationSlot в lib/pool.ts, но посчитанный здесь на общем
 * hashString: pool.ts тянет за собой доступ к базе, а этот модуль обязан
 * оставаться чистым — его зовут и из маршрута, и из тестов.
 *
 * Никакого Math.random: результат обязан совпадать между рендерами, иначе
 * обложки перетасовывались бы сами по себе прямо во время прохождения квиза.
 */
function rotation(seed: string, nowSec: number): number {
  const week = Math.floor(nowSec / (7 * 86_400))
  return hashString(`${seed}:${week}`) % ROTATION_WINDOW
}

/**
 * Насколько игра похожа на ответ. Положительное — подходит, ноль и меньше —
 * не подходит, и тогда лучше пустая панель, чем обложка, спорящая с ответом.
 *
 * Шкалы у осей разные (время ±0.2, вайб и компания ±1) и это нормально:
 * значения сравниваются только внутри одной оси.
 */
export function affinity(meta: GameMeta, value: AnswerValue): number {
  const tags = new Set(Object.keys(meta.tags))
  switch (value) {
    case 'short':
    case 'medium':
    case 'long':
      return timeFit(tags, value)
    case 'chill':
    case 'engaged': {
      const hasAny = (list: string[]) => list.some((t) => tags.has(t))
      const opposite = value === 'chill' ? 'engaged' : 'chill'
      return (hasAny(VIBE_TAGS[value]) ? 1 : 0) - (hasAny(VIBE_TAGS[opposite]) ? 1 : 0)
    }
    case 'solo':
      return isMultiplayerMeta(meta) ? -1 : 1
    case 'friends':
      return isMultiplayerMeta(meta) ? 1 : -1
  }
}

/**
 * Звучит ли игра как этот ответ. Ровно та же граница, по которой отбираются
 * обложки (`score > 0` ниже), — поэтому число в квизе и картинки под ним
 * не могут разойтись в трактовке одного и того же ответа.
 */
export function fitsAnswer(meta: GameMeta, value: AnswerValue): boolean {
  return affinity(meta, value) > 0
}

/**
 * Записи библиотеки, о которых вообще есть что сказать: своя игра Steam, мета
 * приехала, не мусор.
 *
 * Общая часть для обложек и для счётчика. Дальше они расходятся намеренно:
 * обложке нужен арт и годится любая игра (в том числе та, где наиграно триста
 * часов), а счётчику нужен бэклог и арт не нужен вовсе.
 *
 * Гард appid > 0 — записи чужих магазинов лежат под отрицательными id (тот же
 * гард стоит на полке забытого и на портрете).
 */
export function usableLibrary(
  library: LibraryGame[],
  metaOf: MetaOf,
): Array<{ game: LibraryGame; meta: GameMeta }> {
  const out: Array<{ game: LibraryGame; meta: GameMeta }> = []
  for (const game of library) {
    if (game.appid <= 0) continue
    const meta = metaOf(game.appid)
    if (!meta) continue
    if (isJunk(game, meta)) continue
    out.push({ game, meta })
  }
  return out
}

function toCover(game: LibraryGame, meta: GameMeta): QuizCover {
  const header = meta.art?.header
  return {
    appid: game.appid,
    name: meta.name || game.name,
    ...(meta.headerImage ? { headerImage: meta.headerImage } : {}),
    ...(header ? { art: { header } } : {}),
  }
}

/** Первый подходящий кандидат, начиная со сдвига и по кругу */
function firstFree(
  ranked: LibraryGame[],
  start: number,
  ok: (g: LibraryGame) => boolean,
): LibraryGame | null {
  for (let i = 0; i < ranked.length; i++) {
    const g = ranked[(start + i) % ranked.length]
    if (ok(g)) return g
  }
  return null
}

export function pickQuizCovers(args: {
  library: LibraryGame[]
  metaOf: MetaOf
  /** steamid — чтобы недельная ротация была своя у каждого; пустая строка для гостя */
  seed: string
  nowSec: number
  /** вход с /library «Разгрести →»: только то, что ни разу не запускали */
  untouchedOnly?: boolean
}): QuizCovers {
  const { library, metaOf, seed, nowSec, untouchedOnly = false } = args

  const candidates = usableLibrary(library, metaOf)
    // Арт обязателен именно здесь: панель без картинки — не панель
    .filter(({ meta }) => Boolean(meta.headerImage || meta.art))
    .filter(({ game }) => !untouchedOnly || isUntouched(game))
    .map(({ game }) => game)

  const rot = rotation(seed, nowSec)
  const covers: QuizCovers = {}
  const usedAnywhere = new Set<number>()

  for (const step of STEPS) {
    // Строгий запрет на повтор — в пределах шага: две панели с одной обложкой
    // рядом читаются как поломка. Между шагами повтор допускается, но только
    // если свободных кандидатов не осталось: пустая панель хуже повтора,
    // который человек к тому же увидит через экран.
    const usedInStep = new Set<number>()

    for (const option of step.options) {
      const value = option.value as AnswerValue
      const ranked = candidates
        .map((g) => ({ g, score: affinity(metaOf(g.appid) as GameMeta, value) }))
        .filter((x) => x.score > 0)
        .sort(
          (a, b) =>
            b.score - a.score ||
            // наигранное вперёд: обложка «Весь вечер» — та игра, в которой
            // человек действительно провёл вечера, а не случайная из корзины
            b.g.playtimeForever - a.g.playtimeForever ||
            a.g.appid - b.g.appid,
        )
        .map((x) => x.g)

      if (!ranked.length) continue

      const start = rot % Math.min(ROTATION_WINDOW, ranked.length)
      const chosen =
        firstFree(ranked, start, (g) => !usedAnywhere.has(g.appid) && !usedInStep.has(g.appid)) ??
        firstFree(ranked, start, (g) => !usedInStep.has(g.appid))
      if (!chosen) continue

      covers[value] = toCover(chosen, metaOf(chosen.appid) as GameMeta)
      usedAnywhere.add(chosen.appid)
      usedInStep.add(chosen.appid)
    }
  }

  return covers
}
