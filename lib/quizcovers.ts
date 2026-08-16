import type { QuizCover, QuizCovers } from './quizart'
import type { QuizCounts } from './quizcount'

/**
 * Клиентский кэш доски квиза — обложек и чисел.
 *
 * Смысл ровно один: к моменту, когда экран открылся, ответ уже должен быть в
 * пути. Раньше запрос уходил на монтировании квиза, и панели мгновение стояли
 * стеклянными; посадочная зовёт прогрев заранее, и обложки приезжают сразу.
 *
 * Промис на уровне модуля, а не заголовки кэша: ответ персональный и помечен
 * `private, no-store` — договариваться с браузерным кэшем о нём было бы и
 * сложнее, и опаснее. Модуль переживает клиентскую навигацию (это тот же бандл,
 * перезагрузки страницы нет), поэтому квиз просто забирает готовый промис.
 *
 * Побочно уходит второй запрос от двойного монтирования эффектов в dev.
 */

export type QuizBoard = {
  covers: QuizCovers
  /** Может не приехать вовсе: см. докблок MIN_COVERAGE в lib/quizcount.ts */
  counts?: QuizCounts
  /** Полка бэклога под панелями; отсутствует, когда показывать нечего */
  shelf?: QuizCover[]
}

const EMPTY: QuizBoard = { covers: {} }

/**
 * Живёт минуту. Библиотека меняется медленно, но не настолько, чтобы держать
 * ответ на всю сессию: между заходами в квиз человек мог успеть докупить игру.
 */
const TTL_MS = 60_000

type Entry = { at: number; board: Promise<QuizBoard> }

const cache = new Map<string, Entry>()

function load(key: string): Promise<QuizBoard> {
  return fetch(`/api/quiz/covers${key ? `?focus=${key}` : ''}`)
    .then((r) => (r.ok ? (r.json() as Promise<QuizBoard>) : EMPTY))
    .catch(() => {
      // Сорванный запрос НЕ кэшируем: иначе одна потерянная сеть оставляла бы
      // экран без обложек на целую минуту, хотя следующая попытка прошла бы.
      cache.delete(key)
      return EMPTY
    })
}

export function quizBoard(untouchedOnly = false): Promise<QuizBoard> {
  const key = untouchedOnly ? 'untouched' : ''
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.board
  const board = load(key)
  cache.set(key, { at: Date.now(), board })
  return board
}

/** Тихий прогрев с посадочной: результат прямо сейчас никому не нужен. */
export function primeQuizBoard(): void {
  void quizBoard()
}
