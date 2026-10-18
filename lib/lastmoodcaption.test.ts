import { afterEach, describe, expect, test, vi } from 'vitest'
import { LAST_MOOD_TTL_SEC, lastMoodStore } from './lastmood'
import { lastMoodCaption, lastMoodCaptionNow, lastMoodCaptionNowFor } from './lastmoodcaption'
import type { Mood } from './types'

/**
 * Подпись прошлого настроения на английской главной — те же слова, что на
 * английском квизе, и тот же срок свежести. Снимок для useSyncExternalStore
 * обязан быть одной функцией на язык: новая функция на каждый рендер
 * переподписывала бы хранилище на каждом кадре.
 */

const NOW = 1_760_000_000
const MOOD: Mood = { time: 'short', vibe: 'chill', social: 'solo' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('lastMoodCaption по-английски', () => {
  test('свежее — строка английского квиза', () => {
    expect(lastMoodCaption({ mood: MOOD, lean: null, at: NOW - 60 }, NOW, 'en')).toBe('Under an hour · Unwind · Solo')
    expect(lastMoodCaption({ mood: MOOD, lean: null, at: NOW - 60 }, NOW, 'en')).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('протухшее и пустое — пустая подпись, как у русской', () => {
    expect(lastMoodCaption({ mood: MOOD, lean: null, at: NOW - LAST_MOOD_TTL_SEC - 1 }, NOW, 'en')).toBe('')
    expect(lastMoodCaption(null, NOW, 'en')).toBe('')
  })

  test('по умолчанию — русская, как была', () => {
    expect(lastMoodCaption({ mood: MOOD, lean: null, at: NOW - 60 }, NOW)).toBe('Меньше часа · Расслабиться · Один')
  })
})

describe('lastMoodCaptionNowFor', () => {
  test('одна функция на язык; русская — прежний lastMoodCaptionNow', () => {
    expect(lastMoodCaptionNowFor('en')).toBe(lastMoodCaptionNowFor('en'))
    expect(lastMoodCaptionNowFor('ru')).toBe(lastMoodCaptionNow)
    expect(lastMoodCaptionNowFor()).toBe(lastMoodCaptionNow)
  })

  test('снимок читает память и часы сам — на своём языке', () => {
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    })
    lastMoodStore.set({ mood: MOOD, lean: null, at: Math.floor(Date.now() / 1000) - 60 })
    expect(lastMoodCaptionNowFor('en')()).toBe('Under an hour · Unwind · Solo')
    expect(lastMoodCaptionNowFor('ru')()).toBe('Меньше часа · Расслабиться · Один')
    lastMoodStore.set(null)
  })
})
