import type { Mood } from './types'

/**
 * Настроение по умолчанию там, где спрашивать не о чем: «Ни разу не запускал»
 * в квизе и «Игра дня». Жило двумя одинаковыми константами в двух файлах под
 * разными именами (NEUTRAL_MOOD и DAILY_MOOD) — разойтись им нельзя, они
 * задают один и тот же дефолт продукта.
 */
export const NEUTRAL_MOOD: Mood = { time: 'medium', vibe: 'chill', social: 'solo' }

export function parseMood(raw: unknown): Mood | null {
  const m = raw as Partial<Mood> | undefined
  if (!m) return null
  const time = ['short', 'medium', 'long'].includes(m.time ?? '') ? m.time : null
  const vibe = ['chill', 'engaged'].includes(m.vibe ?? '') ? m.vibe : null
  const social = ['solo', 'friends'].includes(m.social ?? '') ? m.social : null
  if (!time || !vibe || !social) return null
  return { time, vibe, social } as Mood
}

/**
 * Ось состояния рядом с настроением: чего хочется по отношению к своему опыту.
 *
 *   familiar  — знакомого: сил осваивать новое нет, хочется туда, где руки
 *               помнят управление;
 *   fresh     — нового: того, во что ещё не играл;
 *   lowenergy — просто сил мало: без хардкора.
 *
 * Отдельная ось, а не четвёртое поле Mood, и это не вкусовщина: lib/quiz.ts
 * строит шаги квиза по keyof Mood, и лишнее поле молча стало бы вопросом без
 * ответов. По той же причине её нет в parseMood — у настроения три оси, у
 * запроса может быть ещё и эта.
 */
export const LEANS = ['familiar', 'fresh', 'lowenergy'] as const

export type Lean = (typeof LEANS)[number]

/** Неизвестное значение — не ошибка, а «ось не выбрана»: подбор идёт как раньше */
export function parseLean(raw: unknown): Lean | null {
  return typeof raw === 'string' && (LEANS as readonly string[]).includes(raw) ? (raw as Lean) : null
}
