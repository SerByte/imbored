import type { Mood } from './types'

/**
 * Настроение по умолчанию там, где спрашивать не о чем: «Ни разу не запускал»
 * в квизе и «Игра дня». Жило двумя одинаковыми константами в двух файлах под
 * разными именами (NEUTRAL_MOOD и DAILY_MOOD) — разойтись им нельзя, они
 * задают один и тот же дефолт продукта.
 */
export const NEUTRAL_MOOD: Mood = { time: 'medium', vibe: 'chill', social: 'solo' }

/**
 * Теги, по которым движок узнаёт ось vibe: «спокойное» и «втягивающее».
 *
 * Здесь, а не в lib/recommend, потому что список читает и клиент: экран
 * выгорания /play ищет «уютное» по тем же тегам (COZY_TAGS ниже). Модуль без
 * рантайм-импортов, а движок рекомендаций в клиентский бандл тянуть незачем.
 */
export const VIBE_TAGS: Record<Mood['vibe'], string[]> = {
  chill: ['Casual', 'Relaxing', 'Cozy', 'Wholesome', 'Puzzle', 'Atmospheric', 'Farming Sim'],
  engaged: ['Difficult', 'Competitive', 'Souls-like', 'Tactical', 'Strategy', 'Fast-Paced'],
}

/**
 * Теги спокойной оси, которые НЕ обещают отдыха. Atmospheric для подбора —
 * довод за спокойный вечер, но он стоит и на хоррорах: у Alan Wake 2 он в
 * тройке верхних тегов. Экрану выгорания, куда приходят после пятого «Не то —
 * дальше», такое не годится — там ищут то, где ничего не пугает.
 */
const NOT_RESTFUL: ReadonlySet<string> = new Set(['Atmospheric'])

/**
 * «Уютное» для экрана выгорания — спокойная ось движка без того, что не
 * обещает отдыха. Выводится из VIBE_TAGS.chill, а не выписывается рядом:
 * копия в app/play/page.tsx уже отличалась от списка движка, и новый тег
 * спокойной оси экран выгорания не услышал бы.
 */
export const COZY_TAGS: readonly string[] = VIBE_TAGS.chill.filter((t) => !NOT_RESTFUL.has(t))

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
