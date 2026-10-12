import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reportClientError } from '@/lib/clienterr'

/*
 * Закулисье (components/BackstageLazy): продление входа, аналитика и Web
 * Vitals — чанком, в простое после гидратации, и отказ чанка — молча.
 *
 * Островок просит чанк из подписки useSyncExternalStore, которой серверный
 * рендер не делает: здесь подписки копятся и «монтируются» руками, как в
 * lib/lazyisland.test.ts.
 */
type Store = { onChange: () => void; get: () => unknown }

const { mounts, stores } = vi.hoisted(() => ({ mounts: [] as (() => void)[], stores: [] as Store[] }))

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    useSyncExternalStore: <T>(subscribe: (cb: () => void) => () => void, get: () => T, server?: () => T): T => {
      const store: Store = { onChange: vi.fn(), get }
      stores.push(store)
      mounts.push(() => void subscribe(store.onChange))
      return react.useSyncExternalStore(subscribe, get, server)
    },
  }
})

vi.mock('@/lib/clienterr', () => ({ reportClientError: vi.fn(), clientErrorCode: () => 'c0chunk00' }))

/** Тело закулисья, как его привёз бы чанк */
function Body() {
  return createElement('i', null, 'закулисье')
}

let idle: (() => void)[]

beforeEach(() => {
  mounts.length = 0
  stores.length = 0
  idle = []
  vi.mocked(reportClientError).mockClear()
  vi.stubGlobal('window', {
    location: { href: 'https://imbored.cc/room/ABC234' },
    requestIdleCallback: (cb: () => void) => idle.push(cb),
    setTimeout: globalThis.setTimeout,
  })
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.doUnmock('@/components/Backstage')
})

async function island() {
  const { Backstage } = await import('@/components/BackstageLazy')
  return Backstage as ComponentType<object>
}

/** Смонтировать отрисованное и дать промисам доехать */
async function settle(): Promise<void> {
  for (const mount of mounts.splice(0)) mount()
  await new Promise((r) => setTimeout(r, 0))
}

describe('закулисье — после гидратации, в простое', () => {
  test('на сервере и в кадре гидратации — пусто', async () => {
    const load = vi.fn(() => ({ Backstage: Body }))
    vi.doMock('@/components/Backstage', load)
    const Backstage = await island()
    expect(renderToStaticMarkup(createElement('p', null, createElement(Backstage)))).toBe('<p></p>')
    expect(load).not.toHaveBeenCalled()
  })

  /*
   * Разбор чанка и вставка скриптов аналитики не должны спорить с
   * гидратацией за главный поток: до простоя чанк даже не просят.
   */
  test('чанк просят только в простое браузера', async () => {
    const load = vi.fn(() => ({ Backstage: Body }))
    vi.doMock('@/components/Backstage', load)
    const Backstage = await island()
    renderToStaticMarkup(createElement(Backstage))
    await settle()
    expect(load, 'чанк ушёл раньше простоя').not.toHaveBeenCalled()
    expect(idle).toHaveLength(1)

    idle[0]()
    await new Promise((r) => setTimeout(r, 0))
    expect(load).toHaveBeenCalledTimes(1)
    expect(stores[0].get()).toBe(Body)
    expect(stores[0].onChange).toHaveBeenCalled()
  })

  test('без requestIdleCallback (Safari) — таймером', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { location: { href: 'https://imbored.cc/' }, setTimeout: globalThis.setTimeout })
    const load = vi.fn(() => ({ Backstage: Body }))
    vi.doMock('@/components/Backstage', load)
    const Backstage = await island()
    renderToStaticMarkup(createElement(Backstage))
    for (const mount of mounts.splice(0)) mount()
    await vi.advanceTimersByTimeAsync(199)
    expect(load).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(stores[0].get()).toBe(Body))
  })

  /*
   * Чанк закулисья просят на КАЖДОМ документе, а не по нажатию: отказ после
   * деплоя превратил бы в отчёт каждый просмотр в это окно. Видимого человек
   * не теряет ничего — значит, и отчитываться не о чем.
   */
  test('чанк не пришёл — пусто и молча, без отчёта островка', async () => {
    vi.doMock('@/components/Backstage', () => {
      throw new Error('Failed to load chunk /_next/static/chunks/0f3a9c.js from module 41234')
    })
    const Backstage = await island()
    renderToStaticMarkup(createElement(Backstage))
    await settle()
    idle[0]()
    await new Promise((r) => setTimeout(r, 0))
    expect(reportClientError).not.toHaveBeenCalled()
    const Empty = stores[0].get() as ComponentType<object>
    expect(Empty).toBeTypeOf('function')
    expect(renderToStaticMarkup(createElement(Empty))).toBe('')
  })
})
