import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  freshLastMood,
  LAST_MOOD_TTL_SEC,
  lastMoodCaption,
  lastMoodCaptionServer,
  lastMoodStore,
  parseLastMood,
  pickHref,
  pickHrefServer,
  QUIZ_HREF,
  type LastMood,
} from './lastmood'
import { createLocalStore } from './localstore'
import { LEANS, parseLean, parseMood } from './mood'
import type { Mood } from './types'

/**
 * «Подобрать» ведёт туда, что лежит в хранилище, а пишет туда кто угодно.
 * Поэтому главное здесь — что мусор и протухшее ведут в квиз, а не в выдачу
 * с чужим настроением, и что всё, что ушло в адрес, разбирается обратно тем
 * же разбором, что стоит на сервере.
 */

const NOW = 1_700_000_000
const MOOD: Mood = { time: 'short', vibe: 'chill', social: 'solo' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseLastMood', () => {
  test('целая запись читается, лишнее отбрасывается', () => {
    expect(parseLastMood({ mood: { ...MOOD, extra: 1 }, lean: 'fresh', at: NOW, x: 'y' })).toEqual({
      mood: MOOD,
      lean: 'fresh',
      at: NOW,
    })
  })

  test('мусор — null', () => {
    for (const raw of [
      null,
      undefined,
      'mood',
      42,
      true,
      [],
      {},
      { mood: MOOD },
      { at: NOW },
      { mood: { ...MOOD, time: 'forever' }, at: NOW },
      { mood: 'short', at: NOW },
      { mood: MOOD, at: String(NOW) },
      { mood: MOOD, at: Infinity },
      { mood: MOOD, at: NaN },
    ]) {
      expect(parseLastMood(raw), JSON.stringify(raw)).toBeNull()
    }
  })

  test('кривая ось не выбрасывает настроение — ось просто не выбрана', () => {
    expect(parseLastMood({ mood: MOOD, lean: 'сонный', at: NOW })?.lean).toBeNull()
    expect(parseLastMood({ mood: MOOD, at: NOW })?.lean).toBeNull()
  })

  test('через хранилище: битый JSON и чужая запись — null, своя — читается', () => {
    const data: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (Object.hasOwn(data, k) ? data[k] : null),
      setItem: (k: string, v: string) => {
        data[k] = v
      },
      removeItem: (k: string) => {
        delete data[k]
      },
    })
    const KEY = 'imbored.test.last-mood'

    data[KEY] = '{не json'
    expect(createLocalStore(KEY, parseLastMood).get()).toBeNull()

    data[KEY] = JSON.stringify({ mood: 'всё равно', at: NOW })
    expect(createLocalStore(KEY, parseLastMood).get()).toBeNull()

    const store = createLocalStore(KEY, parseLastMood)
    store.set({ mood: MOOD, lean: 'familiar', at: NOW })
    expect(createLocalStore(KEY, parseLastMood).get()).toEqual({ mood: MOOD, lean: 'familiar', at: NOW })
  })

  test('без хранилища (сервер, node) — null и никаких исключений', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(lastMoodStore.server()).toBeNull()
    expect(createLocalStore('imbored.test.none', parseLastMood).get()).toBeNull()
  })
})

describe('срок годности', () => {
  const at = (sec: number): LastMood => ({ mood: MOOD, lean: null, at: sec })

  test('младше недели — свежее', () => {
    expect(freshLastMood(at(NOW), NOW)).not.toBeNull()
    expect(freshLastMood(at(NOW - LAST_MOOD_TTL_SEC + 1), NOW)).not.toBeNull()
  })

  test('неделя и старше — протухло', () => {
    expect(freshLastMood(at(NOW - LAST_MOOD_TTL_SEC), NOW)).toBeNull()
    expect(freshLastMood(at(NOW - 30 * 86_400), NOW)).toBeNull()
  })

  test('метка из будущего — не доверяем', () => {
    expect(freshLastMood(at(NOW + 60), NOW)).toBeNull()
  })

  test('ничего не помним — ничего и не свежее', () => {
    expect(freshLastMood(null, NOW)).toBeNull()
  })
})

describe('pickHref', () => {
  function read(href: string) {
    const url = new URL(href, 'https://imbored.test')
    const q = url.searchParams
    return {
      path: url.pathname,
      mood: parseMood({ time: q.get('time'), vibe: q.get('vibe'), social: q.get('social') }),
      lean: parseLean(q.get('lean')),
      keys: [...q.keys()],
    }
  }

  test('нечего помнить или протухло — квиз', () => {
    expect(pickHref(null, NOW)).toBe(QUIZ_HREF)
    expect(pickHref({ mood: MOOD, lean: 'fresh', at: NOW - LAST_MOOD_TTL_SEC }, NOW)).toBe('/quiz')
  })

  test('свежее — сразу выдача под то же настроение', () => {
    const got = read(pickHref({ mood: MOOD, lean: null, at: NOW - 3600 }, NOW))
    expect(got.path).toBe('/play')
    expect(got.mood).toEqual(MOOD)
    expect(got.lean).toBeNull()
    // Ни рулетки, ни фокуса: помним настроение, а не режим
    expect(got.keys).toEqual(['time', 'vibe', 'social'])
  })

  test('ось едет в адрес и разбирается обратно', () => {
    for (const lean of LEANS) {
      const got = read(pickHref({ mood: MOOD, lean, at: NOW }, NOW))
      expect(got.lean, lean).toBe(lean)
      expect(got.mood, lean).toEqual(MOOD)
    }
  })
})

/**
 * Подпись стоит рядом с кнопкой главной, которая ведёт в выдачу мимо квиза.
 * Поэтому она обязана появляться ровно тогда, когда кнопка ведёт в выдачу, и
 * говорить то же настроение, что уедет в адрес.
 */
describe('lastMoodCaption', () => {
  test('свежее — та же строка, которой кончается квиз', () => {
    expect(lastMoodCaption({ mood: MOOD, lean: null, at: NOW - 60 }, NOW)).toBe(
      'Меньше часа · Расслабиться · Один',
    )
  })

  test('подпись есть ровно тогда, когда кнопка ведёт в выдачу', () => {
    for (const at of [NOW, NOW - 3600, NOW - LAST_MOOD_TTL_SEC, NOW + 60]) {
      const last: LastMood = { mood: MOOD, lean: 'fresh', at }
      const toPlay = pickHref(last, NOW) !== QUIZ_HREF
      expect(lastMoodCaption(last, NOW) !== '', String(at)).toBe(toPlay)
    }
    expect(lastMoodCaption(null, NOW)).toBe('')
  })

  test('до гидратации — квиз и пустая подпись, как на сервере', () => {
    expect(pickHrefServer()).toBe(QUIZ_HREF)
    expect(lastMoodCaptionServer()).toBe('')
  })
})
