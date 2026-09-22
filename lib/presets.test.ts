import { describe, expect, test } from 'vitest'
import { LEANS, NEUTRAL_MOOD, parseLean, parseMood } from './mood'
import { playHref, presetHref, VIBE_PRESETS } from './presets'
import { parseFocus } from './recommend'
import type { Mood } from './types'

/**
 * Адрес — договор между тем, кто его строит (квиз, главная), и тем, кто его
 * читает (/play → /api/recommend). Проверяем ровно этот договор: всё, что
 * положили в адрес, обязано разобраться обратно тем же разбором, что стоит
 * на сервере. Пресет, который после разбора теряет «нет сил», — это обещание
 * на кнопке, которое выдача не выполняет.
 */
function read(href: string) {
  const url = new URL(href, 'https://imbored.test')
  const q = url.searchParams
  return {
    path: url.pathname,
    mood: parseMood({ time: q.get('time'), vibe: q.get('vibe'), social: q.get('social') }),
    lean: parseLean(q.get('lean')),
    focus: parseFocus(q.get('from')),
    roulette: q.get('roulette') === '1',
    keys: [...q.keys()],
  }
}

describe('presetHref', () => {
  test('каждый пресет разбирается обратно в своё настроение и свою ось', () => {
    for (const p of VIBE_PRESETS) {
      const got = read(presetHref(p))
      expect(got.path, p.key).toBe('/play')
      expect(got.mood, p.key).toEqual(p.mood)
      expect(got.lean, p.key).toBe(p.lean ?? null)
      expect(got.focus, p.key).toBeNull()
      expect(got.roulette, p.key).toBe(false)
    }
  })

  test('«после работы, нет сил» просит без хардкора', () => {
    expect(VIBE_PRESETS.find((p) => p.key === 'after-work')?.lean).toBe('lowenergy')
  })

  test('ключи пресетов не повторяются', () => {
    const keys = VIBE_PRESETS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('playHref', () => {
  test('без оси адрес прежний: три параметра настроения и ничего лишнего', () => {
    expect(playHref(NEUTRAL_MOOD)).toBe('/play?time=medium&vibe=chill&social=solo')
  })

  test('каждая ось, фокус и рулетка переживают дорогу туда и обратно', () => {
    const mood: Mood = { time: 'short', vibe: 'engaged', social: 'friends' }
    for (const lean of LEANS) {
      const got = read(playHref(mood, { lean, focus: 'untouched', roulette: true }))
      expect(got.mood).toEqual(mood)
      expect(got.lean).toBe(lean)
      expect(got.focus).toBe('untouched')
      expect(got.roulette).toBe(true)
    }
  })

  test('null и отсутствие опций в адрес не попадают', () => {
    const got = read(playHref(NEUTRAL_MOOD, { lean: null, focus: null, roulette: false }))
    expect(got.keys).toEqual(['time', 'vibe', 'social'])
  })
})
