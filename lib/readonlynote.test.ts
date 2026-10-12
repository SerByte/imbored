import { createElement, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reportClientError } from '@/lib/clienterr'

/*
 * Записка «Режим просмотра» в двух частях: оболочка в корневом лэйауте
 * (components/ReadOnlyNote) и тело чанком (components/ReadOnlyNoteBox). Тело
 * везётся, только когда флажок записки стоит, — и обещание здесь тройное:
 * одноразовое сообщение не теряется по дороге, флажок, переживший свой
 * документ, не скажет «режим просмотра» тому, кто уже пишет, а скринридер
 * слышит записку из области, которая стоит в документе раньше текста.
 *
 * Эффекты и состояние оболочки в node не живут, поэтому они копятся и
 * исполняются руками, а состояние — одна ячейка: следующий рендер видит то,
 * что положили последним (как lib/lazyisland.test.ts).
 */
const { effects, cell } = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  cell: { set: false, value: undefined as unknown },
}))

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    useEffect: (effect: () => void | (() => void)) => {
      effects.push(effect)
    },
    useState: <T>(init: T) => [
      cell.set ? cell.value : init,
      (v: T) => {
        cell.set = true
        cell.value = v
      },
    ],
  }
})

vi.mock('@/lib/clienterr', () => ({ reportClientError: vi.fn(), clientErrorCode: () => 'c0chunk00' }))

const KEY = 'imbored.readonly-note'
const EVENT = 'imbored:readonly-note'
const HREF = 'https://imbored.cc/play'

let session: Record<string, string>
let listeners: Map<string, () => void>

beforeEach(() => {
  effects.length = 0
  cell.set = false
  cell.value = undefined
  vi.mocked(reportClientError).mockClear()
  session = {}
  listeners = new Map()
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => (Object.hasOwn(session, k) ? session[k] : null),
    setItem: (k: string, v: string) => {
      session[k] = v
    },
    removeItem: (k: string) => {
      delete session[k]
    },
  })
  vi.stubGlobal('window', {
    location: { href: HREF },
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
    dispatchEvent: (e: Event) => {
      listeners.get(e.type)?.()
      return true
    },
  })
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('@/components/ReadOnlyNoteBox')
})

/** Тело записки, как его привёз бы чанк: видимая панель и строка для скринридера */
const Box: FunctionComponent<{ onHide: () => void }> = () => createElement('section', null, 'панель')
const SAY = 'Режим просмотра: сказано'

type Verdict = (then: (show: boolean) => void) => () => void

/** «Сессия только читает, и это уже известно» — обычный путь: карточка входа ставит признак рядом с флажком */
const reads: Verdict = (then) => {
  then(true)
  return () => {}
}

/** Модуль тела; вердикт свой — чтобы держать его в руках */
const body = (noteVerdict: Verdict = reads) => ({ ReadOnlyNoteBox: Box, READONLY_SAY: SAY, noteVerdict })

/** Флажок, поставленный ago мс назад */
const flag = (ago = 0) => String(Date.now() - ago)
const MINUTE = 60 * 1000

async function shell() {
  const { ReadOnlyNote } = await import('@/components/ReadOnlyNote')
  return () => renderToStaticMarkup(createElement(ReadOnlyNote))
}

/** Исполнить эффекты первого рендера и дождаться чанка */
async function mount(): Promise<void> {
  for (const effect of effects.splice(0)) effect()
  await new Promise((r) => setTimeout(r, 0))
}

describe('флажок записки', () => {
  test('peek смотрит, не забирая; take забирает один раз', async () => {
    const m = await import('./readonlynote')
    expect(m.peekReadOnlyNote()).toBe(false)
    m.announceReadOnly()
    expect(m.peekReadOnlyNote()).toBe(true)
    expect(m.peekReadOnlyNote(), 'второй взгляд — флажок на месте').toBe(true)
    expect(m.takeReadOnlyNote()).toBe(true)
    expect(m.takeReadOnlyNote()).toBe(false)
    expect(m.peekReadOnlyNote()).toBe(false)
  })

  /*
   * Флажок переживает свой документ, когда тело не доехало, — и ждёт
   * следующей попытки. Но «ты только что вошёл по ссылке» через час — уже не
   * новость: протухший флажок не стоит и стирается при первом же взгляде.
   */
  test('флажок живёт десять минут; протухший, битый и из будущего — стёрты', async () => {
    const m = await import('./readonlynote')
    expect(m.READONLY_NOTE_TTL_MS).toBe(10 * MINUTE)

    session[KEY] = flag(9 * MINUTE)
    expect(m.peekReadOnlyNote(), 'девять минут — ещё свежий').toBe(true)

    for (const raw of [flag(11 * MINUTE), '1', '', 'да', 'NaN', flag(-5 * MINUTE)]) {
      session[KEY] = raw
      expect(m.peekReadOnlyNote(), raw).toBe(false)
      expect(session[KEY], `${raw} остался лежать`).toBeUndefined()
      session[KEY] = raw
      expect(m.takeReadOnlyNote(), raw).toBe(false)
    }
  })

  test('announceReadOnly ставит время, а не «1»', async () => {
    const m = await import('./readonlynote')
    const before = Date.now()
    m.announceReadOnly()
    expect(Number(session[KEY])).toBeGreaterThanOrEqual(before)
    expect(Number(session[KEY])).toBeLessThanOrEqual(Date.now())
  })

  test('без хранилища записки просто нет', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
    })
    const m = await import('./readonlynote')
    expect(m.peekReadOnlyNote()).toBe(false)
    expect(m.takeReadOnlyNote()).toBe(false)
  })
})

describe('оболочка записки в лэйауте', () => {
  /*
   * Живая область стоит в разметке с сервера — с первого кадра, а не
   * появляется вместе с текстом: вставленную сразу с текстом область
   * зачитывает не каждая пара браузера и скринридера.
   */
  test('с сервера — пустая живая область, и больше ничего', async () => {
    const render = await shell()
    expect(render()).toBe('<p role="status" class="sr-only"></p>')
  })

  test('флажка нет — тело не просят', async () => {
    const load = vi.fn(() => body())
    vi.doMock('@/components/ReadOnlyNoteBox', load)
    await shell()
    await mount()
    expect(load).not.toHaveBeenCalled()
  })

  test('флажок стоит — тело приехало: текст в прежнюю область, панель рядом, флажок забран', async () => {
    vi.doMock('@/components/ReadOnlyNoteBox', () => body())
    session[KEY] = flag()
    const render = await shell()
    render()
    await mount()
    expect(session[KEY], 'показанная записка второй раз не всплывёт').toBeUndefined()
    expect(render()).toBe(`<p role="status" class="sr-only">${SAY}</p><section>панель</section>`)
  })

  /*
   * Карточка входа ставит флажок и шлёт событие, а ведёт дальше клиентским
   * переходом: оболочка к этому времени давно смонтирована.
   */
  test('флажок поставили после монтирования — событие привозит тело', async () => {
    vi.doMock('@/components/ReadOnlyNoteBox', () => body())
    const render = await shell()
    render()
    await mount()
    expect(render()).toBe('<p role="status" class="sr-only"></p>')
    const { announceReadOnly } = await import('./readonlynote')
    announceReadOnly()
    await new Promise((r) => setTimeout(r, 0))
    expect(session[KEY]).toBeUndefined()
    expect(render()).toContain(SAY)
  })

  /*
   * Тело не доехало (моргнула сеть, деплой сменил хеш). Забери оболочка
   * флажок раньше, чем оно приехало, — одноразовое сообщение пропало бы
   * молча. Флажок остаётся до следующей попытки, а отказ — в отчёт, как у
   * любого островка.
   */
  test('тело не доехало — флажок цел, отказ в отчёте с тегом записки', async () => {
    const err = new Error('Failed to load chunk /_next/static/chunks/0f3a9c.js from module 41234')
    vi.doMock('@/components/ReadOnlyNoteBox', () => {
      throw err
    })
    const stamp = flag()
    session[KEY] = stamp
    const render = await shell()
    render()
    await mount()
    expect(session[KEY], 'записку съел не доехавший чанк').toBe(stamp)
    expect(render()).toBe('<p role="status" class="sr-only"></p>')
    expect(reportClientError).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reportClientError).mock.calls[0][0]).toMatchObject({
      kind: 'boundary',
      island: 'readonly-note',
      href: HREF,
    })
  })

  test('протухший флажок — тело не просят, флажок стёрт', async () => {
    const load = vi.fn(() => body())
    vi.doMock('@/components/ReadOnlyNoteBox', load)
    session[KEY] = flag(30 * MINUTE)
    const render = await shell()
    render()
    await mount()
    expect(load).not.toHaveBeenCalled()
    expect(session[KEY]).toBeUndefined()
    expect(render()).toBe('<p role="status" class="sr-only"></p>')
  })

  /*
   * Флажок пережил свой документ (тело не доехало), а следующий документ
   * вкладки — возврат из «Войти через Steam»: sessionStorage переживает и
   * уход на steamcommunity.com. Признака записи в новом документе ещё нет —
   * флажок ждёт его, не забранный и не показанный.
   */
  test('признака записи ещё нет — записка ждёт его, флажок цел', async () => {
    let verdict: ((show: boolean) => void) | null = null
    vi.doMock('@/components/ReadOnlyNoteBox', () =>
      body((then) => {
        verdict = then
        return () => {}
      }),
    )
    const stamp = flag()
    session[KEY] = stamp
    const render = await shell()
    render()
    await mount()
    expect(verdict).toBeTypeOf('function')
    expect(session[KEY], 'флажок забран до вердикта').toBe(stamp)
    expect(render()).toBe('<p role="status" class="sr-only"></p>')

    verdict!(true)
    expect(session[KEY]).toBeUndefined()
    expect(render()).toBe(`<p role="status" class="sr-only">${SAY}</p><section>панель</section>`)
  })

  test('сессия уже пишет — флажок забран, а записки нет, и скринридеру нечего сказать', async () => {
    vi.doMock('@/components/ReadOnlyNoteBox', () =>
      body((then) => {
        then(false)
        return () => {}
      }),
    )
    session[KEY] = flag()
    const render = await shell()
    render()
    await mount()
    expect(session[KEY], 'флажок остался ждать следующего документа').toBeUndefined()
    expect(render()).toBe('<p role="status" class="sr-only"></p>')
  })

  test('ждущий вердикт снимается вместе с оболочкой', async () => {
    const off = vi.fn()
    vi.doMock('@/components/ReadOnlyNoteBox', () => body(() => off))
    session[KEY] = flag()
    const render = await shell()
    render()
    const cleanups = effects.splice(0).map((effect) => effect())
    await new Promise((r) => setTimeout(r, 0))
    expect(off).not.toHaveBeenCalled()
    for (const c of cleanups) if (typeof c === 'function') c()
    expect(off).toHaveBeenCalledTimes(1)
  })

  test('событие слушается, пока оболочка смонтирована', async () => {
    const render = await shell()
    render()
    const cleanups = effects.splice(0).map((effect) => effect())
    expect(listeners.has(EVENT)).toBe(true)
    for (const c of cleanups) if (typeof c === 'function') c()
    expect(listeners.has(EVENT)).toBe(false)
  })
})

/*
 * Вердикт и уход тела — настоящие, на настоящем признаке записи (lib/writer):
 * модуль тела и признак берутся из одного реестра модулей, как в браузере.
 */
describe('тело записки и признак записи', () => {
  async function real() {
    const { writerStore } = await import('@/lib/writer')
    const { noteVerdict, hideOnWriter } = await import('@/components/ReadOnlyNoteBox')
    return { writerStore, noteVerdict, hideOnWriter }
  }

  test('признак известен — вердикт сразу: читает — показать, пишет — нет', async () => {
    const { writerStore, noteVerdict } = await real()
    const then = vi.fn()
    writerStore.set(false)
    noteVerdict(then)
    expect(then).toHaveBeenLastCalledWith(true)
    writerStore.set(true)
    noteVerdict(then)
    expect(then).toHaveBeenLastCalledWith(false)
    expect(then).toHaveBeenCalledTimes(2)
  })

  test('признака нет — вердикт ждёт первого ответа и звучит один раз', async () => {
    const { writerStore, noteVerdict } = await real()
    const then = vi.fn()
    noteVerdict(then)
    expect(then).not.toHaveBeenCalled()
    writerStore.set(true)
    expect(then).toHaveBeenCalledWith(false)
    writerStore.set(false)
    expect(then, 'второй ответ — уже не вердикт').toHaveBeenCalledTimes(1)
  })

  test('отписка снимает ждущий вердикт', async () => {
    const { writerStore, noteVerdict } = await real()
    const then = vi.fn()
    noteVerdict(then)()
    writerStore.set(false)
    expect(then).not.toHaveBeenCalled()
  })

  /*
   * Записка стоит в лэйауте и переживает клиентские переходы, а вход через
   * Steam в соседней вкладке делает сессию пишущей — первый же ответ
   * продления здесь это скажет, и записка уходит.
   */
  test('записка на экране, а сессия начала писать, — записка уходит', async () => {
    const { writerStore, hideOnWriter } = await real()
    writerStore.set(false)
    const hide = vi.fn()
    const off = hideOnWriter(hide)
    writerStore.set(null)
    expect(hide).not.toHaveBeenCalled()
    writerStore.set(true)
    expect(hide).toHaveBeenCalledTimes(1)
    off()
    writerStore.set(false)
    writerStore.set(true)
    expect(hide).toHaveBeenCalledTimes(1)
  })
})
