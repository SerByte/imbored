import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { lazyIsland } from '@/components/lazyIsland'
import { reportClientError } from '@/lib/clienterr'

/*
 * Островок (components/lazyIsland) просит чанк из эффекта или подписки — а
 * серверный рендер не запускает ни того, ни другого. Здесь они копятся и
 * «монтируются» руками: так в node видно и то, что островок делает в
 * браузере после монтирования, и то, что рисует первый кадр — серверный и
 * гидратации (гидратация начинает с того же снимка, что и сервер).
 */
type Store = { onChange: () => void; get: () => unknown; server?: () => unknown }

const { mounts, stores } = vi.hoisted(() => ({ mounts: [] as (() => void)[], stores: [] as Store[] }))

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    useEffect: (effect: () => void) => {
      mounts.push(() => void effect())
    },
    useSyncExternalStore: <T>(subscribe: (cb: () => void) => () => void, get: () => T, server?: () => T): T => {
      const store: Store = { onChange: vi.fn(), get, server }
      stores.push(store)
      mounts.push(() => void subscribe(store.onChange))
      return react.useSyncExternalStore(subscribe, get, server)
    },
  }
})

vi.mock('@/lib/clienterr', () => ({ reportClientError: vi.fn(), clientErrorCode: () => 'c0chunk00' }))

const HREF = 'https://imbored.cc/library'

/** Смонтировать всё, что отрисовано с прошлого раза, и дождаться чанка */
async function mountAll(): Promise<void> {
  for (const mount of mounts.splice(0)) mount()
  await new Promise((r) => setTimeout(r, 0))
}

function Bold() {
  return createElement('b', null, 'островок')
}

/** Так отвечает сборщик, когда деплой сменил хеш, а вкладка — старая */
const chunk404 = () => new Error('Failed to load chunk /_next/static/chunks/0f3a9c.js from module 41234')

beforeEach(() => {
  mounts.length = 0
  stores.length = 0
  vi.mocked(reportClientError).mockClear()
  vi.stubGlobal('window', { location: { href: HREF } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('@/components/TonightButton')
})

/*
 * До островков отказ чанка у «Уже прошёл», слайдера героя и снега уходил в
 * app/error.tsx, а та слала отчёт. Островок держит отказ при себе — место
 * пустое, страница цела, — и отчёт теперь шлёт он сам. Иначе 404 чанков
 * после деплоя (старая вкладка, переход на /library) пропадал бы бесследно.
 */
describe('отказ чанка — пустое место и отчёт с тегом островка', () => {
  test('чанк не пришёл: отчёт уходит, с тегом островка, а не с хешем чанка', async () => {
    const err = chunk404()
    const Island = lazyIsland<object>(() => Promise.reject(err), 'mark-finished')
    expect(renderToStaticMarkup(createElement('p', null, createElement(Island)))).toBe('<p></p>')
    await mountAll()
    expect(reportClientError).toHaveBeenCalledTimes(1)
    expect(reportClientError).toHaveBeenCalledWith({
      kind: 'boundary',
      error: err,
      island: 'mark-finished',
      href: HREF,
      code: 'c0chunk00',
    })
  })

  /*
   * «Уже прошёл» стоит у каждого вечера, сыгранного всерьёз: островков на
   * странице много, чанк — один. Один запрос и один отчёт на попытку, а
   * островок, смонтированный после отказа, просит чанк снова.
   */
  test('островков много — запрос и отчёт один; следующий смонтированный просит снова', async () => {
    const load = vi.fn((): Promise<ComponentType<object>> => Promise.reject(chunk404()))
    const Island = lazyIsland(load, 'mark-finished')
    renderToStaticMarkup(createElement('ul', null, createElement(Island), createElement(Island), createElement(Island)))
    await mountAll()
    expect(load).toHaveBeenCalledTimes(1)
    expect(reportClientError).toHaveBeenCalledTimes(1)

    renderToStaticMarkup(createElement(Island))
    await mountAll()
    expect(load).toHaveBeenCalledTimes(2)
  })

  test('пришедший чанк в отчёт не идёт', async () => {
    const Island = lazyIsland(async () => Bold, 'hero-slider')
    renderToStaticMarkup(createElement(Island))
    await mountAll()
    expect(reportClientError).not.toHaveBeenCalled()
  })

  /*
   * «Сыграю вечером» помнит отказ до перезагрузки и потому ловит его сам, в
   * загрузчике (components/TonightLazy): до островка отказ не доходит, и
   * отчёт — оттуда же.
   */
  test('«Сыграю вечером» ловит отказ сам — и всё равно отчитывается', async () => {
    const err = chunk404()
    vi.doMock('@/components/TonightButton', () => {
      throw err
    })
    vi.resetModules()
    const { TonightButton } = await import('@/components/TonightLazy')
    const { reportClientError: report } = await import('@/lib/clienterr')
    renderToStaticMarkup(createElement(TonightButton, {} as never))
    await mountAll()
    expect(report).toHaveBeenCalledTimes(1)
    expect(vi.mocked(report).mock.calls[0][0]).toMatchObject({ kind: 'boundary', island: 'tonight', href: HREF })
  })
})

/*
 * Модуль островка один на вкладку, и раньше первый кадр читал его прямо
 * (useState(() => loaded)). Островок, который гидратируется ПОСЛЕ прихода
 * чанка — в границе Suspense, догидратированной позже соседней, — рисовал
 * содержимое там, где сервер не нарисовал ничего: расхождение гидратации и
 * перерисовка границы целиком. Первый кадр обязан быть серверным снимком.
 */
describe('первый кадр не зависит от того, пришёл ли чанк', () => {
  test('чанк уже пришёл к соседнему островку — первый кадр всё равно пуст, как у сервера', async () => {
    const Island = lazyIsland(async () => Bold, 'hero-slider')
    renderToStaticMarkup(createElement(Island))
    await mountAll()
    expect(renderToStaticMarkup(createElement('p', null, createElement(Island)))).toBe('<p></p>')
  })

  /*
   * А смонтированный не гидратацией (следующий герой, «назад» на страницу)
   * берёт клиентский снимок — и встаёт сразу, без пустого кадра; уже
   * смонтированные узнают о приходе чанка из подписки.
   */
  test('клиентский снимок — сам островок, как только чанк пришёл; подписчики слышат приход', async () => {
    const Island = lazyIsland(async () => Bold, 'hero-slider')
    renderToStaticMarkup(createElement(Island))
    const [store] = stores
    expect(store.get()).toBeNull()
    await mountAll()
    expect(store.onChange).toHaveBeenCalled()
    expect(store.get()).toBe(Bold)
    expect(store.server?.()).toBeNull()
  })
})
