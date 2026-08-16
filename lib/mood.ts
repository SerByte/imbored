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
