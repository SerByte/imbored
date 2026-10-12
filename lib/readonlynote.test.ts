import { createElement, type FunctionComponent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reportClientError } from '@/lib/clienterr'

/*
 * Записка «Режим просмотра» в двух частях: оболочка в корневом лэйауте
 * (components/ReadOnlyNote) и тело чанком (components/ReadOnlyNoteBox). Тело
 * везётся, только когда флажок записки стоит, — и обещание здесь двойное:
 * одноразовое сообщение не теряется по дороге, а скринридер слышит его из
 * области, которая стоит в документе раньше текста.
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
    const load = vi.fn(() => ({ ReadOnlyNoteBox: Box, READONLY_SAY: SAY }))
    vi.doMock('@/components/ReadOnlyNoteBox', load)
    await shell()
    await mount()
    expect(load).not.toHaveBeenCalled()
  })

  test('флажок стоит — тело приехало: текст в прежнюю область, панель рядом, флажок забран', async () => {
    vi.doMock('@/components/ReadOnlyNoteBox', () => ({ ReadOnlyNoteBox: Box, READONLY_SAY: SAY }))
    session[KEY] = '1'
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
    vi.doMock('@/components/ReadOnlyNoteBox', () => ({ ReadOnlyNoteBox: Box, READONLY_SAY: SAY }))
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
    session[KEY] = '1'
    const render = await shell()
    render()
    await mount()
    expect(session[KEY], 'записку съел не доехавший чанк').toBe('1')
    expect(render()).toBe('<p role="status" class="sr-only"></p>')
    expect(reportClientError).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reportClientError).mock.calls[0][0]).toMatchObject({
      kind: 'boundary',
      island: 'readonly-note',
      href: HREF,
    })
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
