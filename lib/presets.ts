import type { Lean } from './mood'
import type { Focus } from './recommend'
import type { Mood } from './types'

/** Вайб-пресеты: состояние одним тапом вместо трёх вопросов (клиент-безопасный модуль) */
export type VibePreset = {
  key: string
  label: string
  emoji: string
  mood: Mood
  /**
   * Ось состояния рядом с настроением (lib/mood.ts). У большинства пресетов
   * её нет: «пятница с друзьями» ничего не говорит о том, есть ли силы.
   */
  lean?: Lean
}

export const VIBE_PRESETS: VibePreset[] = [
  {
    key: 'after-work',
    label: 'После работы, нет сил',
    emoji: '🛋️',
    mood: { time: 'medium', vibe: 'chill', social: 'solo' },
    // «Нет сил» в самом названии — и до сих пор это было только «расслабиться»:
    // хардкор с тегом Relaxing проходил наравне с остальным
    lean: 'lowenergy',
  },
  {
    key: 'sleep',
    label: '30 минут до сна',
    emoji: '🌙',
    mood: { time: 'short', vibe: 'chill', social: 'solo' },
  },
  {
    key: 'friday',
    label: 'Пятница с друзьями',
    emoji: '🎉',
    mood: { time: 'long', vibe: 'engaged', social: 'friends' },
  },
  {
    key: 'weekend',
    label: 'Залипнуть на выходные',
    emoji: '🕳️',
    mood: { time: 'long', vibe: 'engaged', social: 'solo' },
  },
  {
    key: 'quick',
    label: 'Быстрая катка',
    emoji: '⚡',
    mood: { time: 'short', vibe: 'engaged', social: 'solo' },
  },
]

/**
 * Адрес выдачи — в одном месте.
 *
 * Собирался в трёх: квиз, карточка главной и /play каждый клеили строку
 * запроса сами, приведением Mood к Record<string, string>. Пока параметров
 * было три, копии совпадали; с осью lean четвёртый параметр добавился бы в
 * одну копию и молча потерялся в другой — пресет «нет сил» с главной вёл бы
 * на выдачу без «нет сил».
 *
 * Порядок параметров — прежний (настроение, roulette, from): адреса, которые
 * уже лежат в истории и закладках, не меняются. lean — в хвост.
 */
export function playHref(
  mood: Mood,
  opts: { lean?: Lean | null; focus?: Focus | null; roulette?: boolean } = {},
): string {
  const q = new URLSearchParams({ time: mood.time, vibe: mood.vibe, social: mood.social })
  if (opts.roulette) q.set('roulette', '1')
  if (opts.focus) q.set('from', opts.focus)
  if (opts.lean) q.set('lean', opts.lean)
  return `/play?${q.toString()}`
}

/** Пресет — это обычный адрес выдачи, ровно тот же, что строит /quiz. */
export function presetHref(p: VibePreset): string {
  return playHref(p.mood, { lean: p.lean })
}
