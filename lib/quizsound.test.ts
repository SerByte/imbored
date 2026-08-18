import { afterEach, describe, expect, test, vi } from 'vitest'
import { isSoundOn, setSoundOn, soundOffSnapshot, subscribeSound } from './quizsound'

/**
 * Окружение тестов — node, localStorage здесь нет. Это не помеха, а ровно тот
 * случай, который модуль обязан пережить: приватный режим и запрещённое
 * хранилище ведут себя так же — доступ бросает.
 */

type Store = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void }

function withStorage(impl: Store | 'throws' | null) {
  const value =
    impl === 'throws'
      ? {
          getItem() {
            throw new Error('доступ запрещён')
          },
          setItem() {
            throw new Error('доступ запрещён')
          },
        }
      : impl
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true })
}

function memoryStorage(): Store & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
  }
}

afterEach(() => {
  withStorage(null)
  vi.restoreAllMocks()
})

describe('isSoundOn', () => {
  test('без хранилища отвечает «выключено», а не падает', () => {
    withStorage(null)
    expect(isSoundOn()).toBe(false)
  })

  test('запрещённое хранилище тоже даёт «выключено»', () => {
    // Приватный режим Safari: getItem бросает, а экран обязан остаться целым.
    withStorage('throws')
    expect(isSoundOn()).toBe(false)
  })

  test('включённым считается только точное «on»', () => {
    const s = memoryStorage()
    withStorage(s)
    s.map.set('imbored-quiz-sound', 'off')
    expect(isSoundOn()).toBe(false)
    s.map.set('imbored-quiz-sound', 'true')
    expect(isSoundOn()).toBe(false)
    s.map.set('imbored-quiz-sound', 'on')
    expect(isSoundOn()).toBe(true)
  })
})

describe('setSoundOn', () => {
  test('выбор доживает до следующего чтения', () => {
    withStorage(memoryStorage())
    setSoundOn(true)
    expect(isSoundOn()).toBe(true)
    setSoundOn(false)
    expect(isSoundOn()).toBe(false)
  })

  test('пишет «off», а не стирает ключ', () => {
    // Иначе «выключено вручную» и «никогда не спрашивали» неразличимы.
    const s = memoryStorage()
    withStorage(s)
    setSoundOn(false)
    expect(s.map.get('imbored-quiz-sound')).toBe('off')
  })

  test('подписчик оповещается ДАЖЕ если запись не удалась', () => {
    // Тумблер обязан показать то состояние, в котором приложение находится,
    // а не то, которое удалось сохранить.
    withStorage('throws')
    const seen = vi.fn()
    const off = subscribeSound(seen)
    setSoundOn(true)
    expect(seen).toHaveBeenCalledTimes(1)
    off()
  })

  test('отписавшийся больше не оповещается', () => {
    withStorage(memoryStorage())
    const seen = vi.fn()
    subscribeSound(seen)()
    setSoundOn(true)
    expect(seen).not.toHaveBeenCalled()
  })
})

describe('soundOffSnapshot', () => {
  test('серверный снимок всегда «выключено»', () => {
    // Ровно то, что рендерит сервер: иначе гидратация разошлась бы у того,
    // кто звук уже включал.
    expect(soundOffSnapshot()).toBe(false)
  })
})
