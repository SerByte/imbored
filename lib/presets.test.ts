import { describe, expect, test } from 'vitest'
import { LEANS, NEUTRAL_MOOD, parseLean, parseMood } from './mood'
import {
  playHref,
  presetHref,
  nearestRoomPreset,
  ROOM_PRESETS,
  roomArrival,
  roomBridgeHref,
  roomPresetByKey,
  roomPresetOf,
  VIBE_PRESETS,
} from './presets'
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

/**
 * Настроение комнаты. Хост выбирает пресет до создания, в базу уходит его
 * mood, а комната потом называет его обратно (roomPresetOf) — круг обязан
 * замыкаться, иначе подпись в комнате расходилась бы с тем, подо что собрана
 * колода.
 */
describe('ROOM_PRESETS', () => {
  test('каждый пресет — компания и проходит тот же разбор, что тело создания комнаты', () => {
    for (const p of ROOM_PRESETS) {
      expect(p.mood.social, p.key).toBe('friends')
      expect(parseMood(p.mood), p.key).toEqual(p.mood)
    }
  })

  test('ключи и пары «время + вайб» не повторяются — название настроения однозначно', () => {
    const keys = ROOM_PRESETS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    const axes = ROOM_PRESETS.map((p) => `${p.mood.time}|${p.mood.vibe}`)
    expect(new Set(axes).size).toBe(axes.length)
  })

  test('первый — прежнее зашитое настроение: старые комнаты называются тем, чем были', () => {
    expect(ROOM_PRESETS[0].mood).toEqual({ time: 'long', vibe: 'engaged', social: 'friends' })
    expect(roomPresetOf({ time: 'long', vibe: 'engaged', social: 'friends' })?.key).toBe(
      ROOM_PRESETS[0].key,
    )
  })

  test('ключ и настроение ведут к одному и тому же пресету', () => {
    for (const p of ROOM_PRESETS) {
      expect(roomPresetByKey(p.key), p.key).toBe(p)
      expect(roomPresetOf(p.mood), p.key).toBe(p)
    }
  })

  test('чужое — не пресет', () => {
    for (const raw of [null, undefined, '', 'EVENING', 'friday', '__proto__']) {
      expect(roomPresetByKey(raw), String(raw)).toBeNull()
    }
    expect(roomPresetOf(null)).toBeNull()
    expect(roomPresetOf(undefined)).toBeNull()
    // Комнаты «коротко и спокойно» в списке нет — и подписывать её нечем
    expect(roomPresetOf({ time: 'short', vibe: 'chill', social: 'friends' })).toBeNull()
  })
})

const TIMES: readonly Mood['time'][] = ['short', 'medium', 'long']
const VIBES: readonly Mood['vibe'][] = ['chill', 'engaged']
const ALL_AXES = TIMES.flatMap((time) => VIBES.map((vibe) => ({ time, vibe })))

/**
 * Ближайший пресет — подсказка на экране выбора, а не молчаливая подмена.
 * Стережём все шесть сочетаний time×vibe явной таблицей: смена меры
 * (вайб дороже времени, ничья — в пользу короткого) обязана быть видна здесь,
 * а не всплыть у хоста отмеченной не той плиткой.
 */
describe('nearestRoomPreset', () => {
  const EXPECTED: Record<string, string> = {
    'short|chill': 'talk', // спокойно важнее, чем «коротко»: быстрые катки — с вызовом
    'short|engaged': 'quick',
    'medium|chill': 'talk',
    'medium|engaged': 'quick', // ничья quick/evening — короткий укладывается в час
    'long|chill': 'cozy',
    'long|engaged': 'evening',
  }

  test('каждое из шести сочетаний — своя явная строка таблицы', () => {
    expect(ALL_AXES).toHaveLength(6)
    for (const axes of ALL_AXES) {
      const key = `${axes.time}|${axes.vibe}`
      expect(nearestRoomPreset(axes)?.key, key).toBe(EXPECTED[key])
    }
  })

  test('точный пресет, где он есть, — тот же, что у roomPresetOf', () => {
    for (const axes of ALL_AXES) {
      const exact = roomPresetOf({ ...axes, social: 'friends' })
      if (exact) expect(nearestRoomPreset(axes), `${axes.time}|${axes.vibe}`).toBe(exact)
    }
  })

  test('вайб не меняется никогда: спокойной компании — не соревнование', () => {
    for (const axes of ALL_AXES) {
      expect(nearestRoomPreset(axes)?.mood.vibe, `${axes.time}|${axes.vibe}`).toBe(axes.vibe)
    }
  })

  test('чужие значения осей — null, а не случайный пресет', () => {
    expect(nearestRoomPreset(null)).toBeNull()
    expect(nearestRoomPreset(undefined)).toBeNull()
    expect(nearestRoomPreset({ time: 'forever' as Mood['time'], vibe: 'chill' })).toBeNull()
    expect(nearestRoomPreset({ time: 'short', vibe: 'rage' as Mood['vibe'] })).toBeNull()
    expect(nearestRoomPreset({ time: '__proto__' as Mood['time'], vibe: 'chill' })).toBeNull()
  })
})

/**
 * Мост «Позвать друзей выбрать вместе» с /play. Главное обещание: комната
 * создаётся в один тап ТОЛЬКО с тем настроением, которое человек назвал сам.
 * Без точного пресета — подсказка (?hint=), и тогда в адресе нет preset,
 * иначе /room/new создал бы комнату с чужим вечером.
 */
describe('roomBridgeHref', () => {
  test('соло-настроению мост не предлагается', () => {
    for (const axes of ALL_AXES) expect(roomBridgeHref({ ...axes, social: 'solo' })).toBeNull()
    expect(roomBridgeHref(null)).toBeNull()
    expect(roomBridgeHref(undefined)).toBeNull()
  })

  test('точный пресет — создание в один тап, и настроение комнаты — ровно выдачи', () => {
    for (const axes of ALL_AXES) {
      const mood: Mood = { ...axes, social: 'friends' }
      const exact = roomPresetOf(mood)
      if (!exact) continue
      const href = roomBridgeHref(mood)
      expect(href, exact.key).toBe(`/room/new?preset=${exact.key}`)
      const got = roomPresetByKey(new URL(href!, 'https://imbored.test').searchParams.get('preset'))
      expect(got?.mood, exact.key).toEqual(mood)
    }
  })

  test('без точного — только подсказка: в адресе нет preset, и /room/new комнату сам не создаст', () => {
    const gaps = ALL_AXES.filter((axes) => !roomPresetOf({ ...axes, social: 'friends' }))
    expect(gaps.map((a) => `${a.time}|${a.vibe}`).sort()).toEqual(['medium|engaged', 'short|chill'])
    for (const axes of gaps) {
      const q = new URL(roomBridgeHref({ ...axes, social: 'friends' })!, 'https://imbored.test').searchParams
      expect([...q.keys()], `${axes.time}|${axes.vibe}`).toEqual(['hint'])
      expect(q.get('hint')).toBe(nearestRoomPreset(axes)?.key)
      // тот же разбор, что у /room/new: создать не с чем, отмечен ближайший
      const got = roomArrival(q)
      expect(got.create, `${axes.time}|${axes.vibe}`).toBeNull()
      expect(got.hint, `${axes.time}|${axes.vibe}`).toBe(nearestRoomPreset(axes))
    }
  })

  test('чужие оси из адреса /play — без моста, а не hint=undefined', () => {
    expect(roomBridgeHref({ time: 'forever' as Mood['time'], vibe: 'chill', social: 'friends' })).toBeNull()
  })
})

/**
 * Разбор адреса /room/new: create — комната сразу, hint — только отметка.
 * Сторож главного обещания моста: подсказка сама комнату не создаёт никогда,
 * а выбранный пресет подсказку перекрывает.
 */
describe('roomArrival', () => {
  const arrive = (s: string) => roomArrival(new URLSearchParams(s))

  test('?hint= без preset — отметка, но не создание, для каждого пресета', () => {
    for (const p of ROOM_PRESETS) {
      expect(arrive(`hint=${p.key}`), p.key).toEqual({ create: null, hint: p })
    }
  })

  test('?preset= создаёт, а подсказку рядом не читает', () => {
    for (const p of ROOM_PRESETS) {
      expect(arrive(`preset=${p.key}`), p.key).toEqual({ create: p, hint: null })
      expect(arrive(`preset=${p.key}&hint=talk`), p.key).toEqual({ create: p, hint: null })
    }
  })

  test('чужой preset не создаёт и не губит годную подсказку; чужое — null', () => {
    expect(arrive('preset=rage&hint=talk')).toEqual({ create: null, hint: roomPresetByKey('talk') })
    expect(arrive('hint=__proto__')).toEqual({ create: null, hint: null })
    expect(arrive('')).toEqual({ create: null, hint: null })
  })
})
