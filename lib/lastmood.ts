import { createLocalStore } from './localstore'
import { parseLean, parseMood, type Lean } from './mood'
import { playHref } from './presets'
import type { Mood } from './types'

/**
 * Прошлое настроение — чтобы «Подобрать» вело сразу к игре.
 *
 * Пункт меню всегда открывал квиз, и тот, кто вчера ответил «полчаса, спокойно,
 * один», сегодня снова отвечал на те же три вопроса — только чтобы получить
 * то же самое. Для человека, который пришёл сюда уйти от выбора, три лишних
 * решения на входе — ровно то, от чего он уходил.
 *
 * Помним на устройстве, а не на сервере: это удобство одного браузера, и лишняя
 * запись в Turso на каждый подбор ради него не нужна. Молча не подменяем:
 * /play показывает подпись настроения рядом с «Изменить настроение», поэтому
 * «30 минут до сна» в субботу днём видно сразу и меняется в один тап.
 *
 * Неделя — срок, после которого прошлое настроение уже чужое: у человека
 * другой день, другая неделя, и спросить заново честнее, чем угадывать.
 */

export type LastMood = { mood: Mood; lean: Lean | null; at: number }

export const LAST_MOOD_TTL_SEC = 7 * 86_400

/** Куда ведёт «Подобрать», когда помнить нечего */
export const QUIZ_HREF = '/quiz'

/**
 * Разбор записи из хранилища. Пишет туда кто угодно — консоль, расширение,
 * прошлая версия сайта, — поэтому настроение проходит тот же parseMood, что и
 * на сервере, а без него и без числового `at` записи нет. Кривая ось — не
 * повод выбросить настроение: она просто «не выбрана».
 */
export function parseLastMood(raw: unknown): LastMood | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { mood?: unknown; lean?: unknown; at?: unknown }
  const mood = parseMood(r.mood)
  if (!mood) return null
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return null
  return { mood, lean: parseLean(r.lean), at: r.at }
}

export const lastMoodStore = createLocalStore('imbored.last-mood', parseLastMood)

/**
 * Свежее ли: младше недели и не из будущего. Метка из будущего — чужая запись
 * или переведённые часы, и доверять ей нечего.
 */
export function freshLastMood(last: LastMood | null, nowSec: number): LastMood | null {
  if (!last) return null
  const age = nowSec - last.at
  return age >= 0 && age < LAST_MOOD_TTL_SEC ? last : null
}

/** Адрес «Подобрать»: выдача под прошлое настроение или квиз, если его нет */
export function pickHref(last: LastMood | null, nowSec: number): string {
  const fresh = freshLastMood(last, nowSec)
  return fresh ? playHref(fresh.mood, { lean: fresh.lean }) : QUIZ_HREF
}

export function rememberMood(mood: Mood, lean: Lean | null, nowSec: number): void {
  lastMoodStore.set({ mood, lean, at: nowSec })
}
