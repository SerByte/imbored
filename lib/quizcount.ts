import { STEPS } from './quiz'
import { fitsAnswer, usableLibrary } from './quizart'
import { classifyLibraryGame } from './recommend'
import type { GameMeta, LibraryGame } from './types'

/**
 * Сколько игр из бэклога звучит ровно так.
 *
 * ЧТО ЭТО ЧИСЛО НЕ ОЗНАЧАЕТ. Оно не отвечает на «сколько останется после
 * ответа»: в выдаче время и вайб — не фильтры, а множители moodMultiplier в
 * диапазоне 0.55…1.40, и игра с противоположным вайбом спокойно выпадает.
 * Из трёх осей квиза фильтрует ровно одна и ровно в одну сторону — fitsSocial
 * при «С друзьями». Честное «сколько останется» стояло бы на месте два шага из
 * трёх, а по тегам — занижало бы раз в пять и могло показать ноль прямо перед
 * экраном с пятью карточками. Поэтому число отвечает на другой вопрос, и
 * подпись рядом с ним обязана спрашивать именно его.
 *
 * Множество то же, из которого выдача набирает кандидатов: своё, прогретое, не
 * мусор, и в состоянии «не пройдено» или «заброшено» — во что человек играет
 * сейчас, scoreCandidates не предлагает никогда.
 *
 * Соответствие оси — конъюнкция по уже данным ответам, поэтому число монотонно
 * сужается ПО ПОСТРОЕНИЮ: каждый следующий уровень считается по подмножеству
 * предыдущего, а не пересчитывается заново. Счётчик, который на шаге вперёд
 * вырос бы, читался бы как поломка.
 */

type MetaOf = (appid: number) => GameMeta | undefined

/** Ключ — данные ответы через двоеточие, в порядке осей: `short:chill:solo` */
export type QuizCounts = Record<string, number>

/**
 * Ниже этого числа счётчик молчит. Три — та же граница, что у backlogEquivalent
 * в lib/stats.ts, и та же мысль, что в заголовке полки на /library: «пять игр»
 * — ложь при трёх.
 */
const MIN_BACKLOG = 3

/**
 * Доля библиотеки с приехавшей метой, ниже которой считать нечего.
 *
 * На первом же заходе после входа в Steam прогрев ещё НЕ запускался — его зовут
 * только /play, /daily и WarmCatalog, — и мета есть лишь у той части библиотеки,
 * что пересеклась с опубликованным каталогом. Число тогда занижено, причём
 * непредсказуемо: у одного человека совпадёт почти всё, у другого — четверть.
 *
 * Молчать в этом случае — то же решение, по которому экран ожидания показывает
 * спиннер вместо «0 %»: цифра, которой нельзя верить, хуже её отсутствия.
 */
const MIN_COVERAGE = 0.6

export function buildQuizCounts(args: {
  library: LibraryGame[]
  metaOf: MetaOf
  nowSec: number
}): QuizCounts | null {
  const { library, metaOf, nowSec } = args

  // Знаменатель покрытия — только записи Steam: у чужих магазинов appid
  // отрицательный и меты не бывает никогда, поэтому включать их значило бы
  // отказываться считать у всех, кто добавил игры из Epic.
  const steamOwned = library.filter((g) => g.appid > 0)
  if (!steamOwned.length) return null
  const covered = steamOwned.filter((g) => metaOf(g.appid)).length
  if (covered / steamOwned.length < MIN_COVERAGE) return null

  const backlog = usableLibrary(library, metaOf).filter(({ game }) => {
    const state = classifyLibraryGame(game, nowSec)
    return state === 'unplayed' || state === 'comeback'
  })
  if (backlog.length < MIN_BACKLOG) return null

  const counts: QuizCounts = { '': backlog.length }
  const [timeStep, vibeStep, socialStep] = STEPS

  for (const time of timeStep.options) {
    const byTime = backlog.filter(({ meta }) => fitsAnswer(meta, time.value))
    counts[time.value] = byTime.length

    for (const vibe of vibeStep.options) {
      const byVibe = byTime.filter(({ meta }) => fitsAnswer(meta, vibe.value))
      counts[`${time.value}:${vibe.value}`] = byVibe.length

      for (const social of socialStep.options) {
        counts[`${time.value}:${vibe.value}:${social.value}`] = byVibe.filter(({ meta }) =>
          fitsAnswer(meta, social.value),
        ).length
      }
    }
  }

  return counts
}
