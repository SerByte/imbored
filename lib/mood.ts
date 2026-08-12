import type { Mood } from './types'

export function parseMood(raw: unknown): Mood | null {
  const m = raw as Partial<Mood> | undefined
  if (!m) return null
  const time = ['short', 'medium', 'long'].includes(m.time ?? '') ? m.time : null
  const vibe = ['chill', 'engaged'].includes(m.vibe ?? '') ? m.vibe : null
  const social = ['solo', 'friends'].includes(m.social ?? '') ? m.social : null
  if (!time || !vibe || !social) return null
  return { time, vibe, social } as Mood
}
