import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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

/**
 * Хранилище не приняло выбор — он живёт в памяти вкладки до перезагрузки.
 *
 * Модуль помнит непринятый выбор в своём состоянии, поэтому каждый тест здесь
 * берёт свежую копию модуля: иначе выбор одного теста протекал бы в другой.
 */
describe('хранилище не приняло выбор', () => {
  const fresh = async () => {
    vi.resetModules()
    return import('./quizsound')
  }

  test('запрещённое хранилище: тумблер всё равно переключается', async () => {
    // Сайт с запрещёнными данными: бросают и getItem, и setItem. isSoundOn
    // перечитывал хранилище, ловил исключение и отвечал «выключено» — подпись
    // кнопки не менялась, и звук не играл никогда
    withStorage('throws')
    const quiz = await fresh()
    quiz.setSoundOn(true)
    expect(quiz.isSoundOn()).toBe(true)
    quiz.setSoundOn(false)
    expect(quiz.isSoundOn()).toBe(false)
  })

  test('запись бросает, а чтение работает — верх берёт выбор, а не прежнее значение', async () => {
    // Переполненное хранилище: setItem бросает, getItem отдаёт старое «off»
    const s = memoryStorage()
    s.map.set('imbored-quiz-sound', 'off')
    withStorage({
      getItem: s.getItem,
      setItem: () => {
        throw new Error('квота')
      },
    })
    const quiz = await fresh()
    quiz.setSoundOn(true)
    expect(quiz.isSoundOn()).toBe(true)
  })

  test('хранилище снова принимает — правда опять в нём', async () => {
    // Иначе память вкладки заслонила бы выбор, сделанный в соседней вкладке
    const s = memoryStorage()
    let broken = true
    withStorage({
      getItem: s.getItem,
      setItem: (k, v) => {
        if (broken) throw new Error('квота')
        s.setItem(k, v)
      },
    })
    const quiz = await fresh()
    quiz.setSoundOn(true)
    broken = false
    quiz.setSoundOn(false)
    expect(quiz.isSoundOn()).toBe(false)
    s.map.set('imbored-quiz-sound', 'on') // выбор соседней вкладки
    expect(quiz.isSoundOn()).toBe(true)
  })
})

/**
 * Имя тумблера постоянное, состояние — в aria-pressed, как у «Пауза» в
 * MorphSlider. Подпись «Звук выкл.» вместе с aria-pressed звучала «Звук
 * выкл., не нажата»: два отрицания об одном, и не понять, состояние это или
 * действие. Для глаза подпись прежняя — «вкл./выкл.» в aria-hidden.
 */
describe('SoundToggle', () => {
  /** Имя кнопки — её текст без aria-hidden */
  const name = (html: string) =>
    html.replace(/<(svg|span)\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '')
  const seen = (html: string) => html.replace(/<[^>]+>/g, '')

  test('выключенный: имя «Звук», состояние — «не нажата»', async () => {
    vi.resetModules()
    const { SoundToggle } = await import('../components/SoundToggle')
    const html = renderToStaticMarkup(createElement(SoundToggle))
    expect(html).toMatch(/aria-pressed="false"/)
    expect(name(html)).toBe('Звук')
    expect(seen(html)).toBe('Звук выкл.')
  })

  test('включённый: то же имя, «нажата»', async () => {
    // Сервер звука не знает (soundOffSnapshot) — включённый снимок подставляем
    vi.resetModules()
    vi.doMock('./quizsound', async (orig) => ({
      ...(await orig<typeof import('./quizsound')>()),
      soundOffSnapshot: () => true,
    }))
    try {
      const { SoundToggle } = await import('../components/SoundToggle')
      const html = renderToStaticMarkup(createElement(SoundToggle))
      expect(html).toMatch(/aria-pressed="true"/)
      expect(name(html)).toBe('Звук')
      expect(seen(html)).toBe('Звук вкл.')
    } finally {
      vi.doUnmock('./quizsound')
    }
  })

  /**
   * Кнопка — inline-flex с gap-1.5. Голые «Звук» и <span aria-hidden> выкл.</span>
   * становились двумя флекс-элементами: пробел в начале span схлопывался как
   * пробел в начале строки, и между словами вставал зазор 6 px вместо пробела.
   * Разметка этого не покажет — проверяется форма: после иконки ровно один
   * элемент, и голого текста рядом с ним нет.
   */
  test('подпись — один флекс-элемент: пробел между «Звук» и «выкл.» не съедает gap', async () => {
    vi.resetModules()
    const { SoundToggle } = await import('../components/SoundToggle')
    const html = renderToStaticMarkup(createElement(SoundToggle))
    const label = html.slice(html.indexOf('</svg>') + '</svg>'.length, html.lastIndexOf('</button>'))
    expect(label).toMatch(/^<span>Звук<span aria-hidden="true"> выкл\.<\/span><\/span>$/)
  })
})

/*
 * /en/quiz: тумблер говорит «Sound on / off» (глоссарий) той же формой — имя
 * «Sound», состояние в aria-pressed, «on/off» для глаза.
 */
describe('SoundToggle по-английски', () => {
  test('имя «Sound», подпись «Sound off», одним флекс-элементом', async () => {
    vi.resetModules()
    const { SoundToggle } = await import('../components/SoundToggle')
    const { LocaleProvider } = await import('../components/LocaleProvider')
    const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: 'en' } as ComponentProps<typeof LocaleProvider>, createElement(SoundToggle)))
    const label = html.slice(html.indexOf('</svg>') + '</svg>'.length, html.lastIndexOf('</button>'))
    expect(label).toBe('<span>Sound<span aria-hidden="true"> off</span></span>')
    expect(html).not.toMatch(/[А-Яа-яЁё]/)
  })
})
