import type { Mood } from './types'

/** Вайб-пресеты: состояние одним тапом вместо трёх вопросов (клиент-безопасный модуль) */
export type VibePreset = {
  key: string
  label: string
  emoji: string
  mood: Mood
}

export const VIBE_PRESETS: VibePreset[] = [
  {
    key: 'after-work',
    label: 'После работы, нет сил',
    emoji: '🛋️',
    mood: { time: 'medium', vibe: 'chill', social: 'solo' },
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
