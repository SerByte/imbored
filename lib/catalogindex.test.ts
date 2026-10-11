import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getCatalogIndex, requestCatalogIndex, resetCatalogIndex, subscribeCatalogIndex } from './catalogindex'
import { SEARCH_INDEX_PATH } from './catalogsearch'

const WIRE = { ids: [730, 570], names: ['Counter-Strike 2', 'Dota 2'] }

const ok = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

beforeEach(() => resetCatalogIndex())
afterEach(() => vi.unstubAllGlobals())

describe('индекс каталога едет по требованию и один раз', () => {
  test('до просьбы — не едет вовсе', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(getCatalogIndex().phase).toBe('idle')
    expect(fetch).not.toHaveBeenCalled()
  })

  test('просьба — запрос по адресу индекса, затем готовые строки', async () => {
    const fetch = vi.fn(async () => ok(WIRE))
    vi.stubGlobal('fetch', fetch)
    const pending = requestCatalogIndex()
    expect(getCatalogIndex().phase).toBe('loading')
    await pending
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(SEARCH_INDEX_PATH)
    const { phase, entries } = getCatalogIndex()
    expect(phase).toBe('ready')
    expect(entries.map((e) => e.name)).toEqual(['Counter-Strike 2', 'Dota 2'])
  })

  /*
   * Поиск открывают и закрывают по многу раз за визит — из шапки, на /games,
   * снова из шапки после перехода. Индекс один на вкладку: второй раз он
   * не едет.
   */
  test('второе открытие и открытие во время загрузки не качают индекс заново', async () => {
    const fetch = vi.fn(async () => ok(WIRE))
    vi.stubGlobal('fetch', fetch)
    await Promise.all([requestCatalogIndex(), requestCatalogIndex()])
    await requestCatalogIndex()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('подписчик слышит каждую смену фазы', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(WIRE)))
    const seen: string[] = []
    const off = subscribeCatalogIndex(() => seen.push(getCatalogIndex().phase))
    await requestCatalogIndex()
    off()
    expect(seen).toEqual(['loading', 'ready'])
  })
})

describe('отказ и повтор', () => {
  test.each([
    ['ответ не 2xx', async () => new Response('нет', { status: 503 })],
    ['сеть упала', async () => Promise.reject(new TypeError('Failed to fetch'))],
    ['не индекс (страница ошибки вместо JSON)', async () => ok({ html: '<!doctype html>' })],
  ])('%s — фаза failed, а не вечное «загружаю»', async (_, impl) => {
    vi.stubGlobal('fetch', vi.fn(impl))
    await requestCatalogIndex()
    expect(getCatalogIndex()).toEqual({ phase: 'failed', entries: [] })
  })

  /*
   * Повтор того же отказа — тот же текст в строке статуса, и область
   * промолчала бы (components/StatusLine). Попытка гасит отказ сразу, до
   * ответа: фаза проходит через loading, и второй отказ приходит изменением.
   */
  test('повтор после отказа качает снова и гасит отказ до ответа', async () => {
    const fetch = vi.fn(async () => new Response('нет', { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    await requestCatalogIndex()
    const seen: string[] = []
    const off = subscribeCatalogIndex(() => seen.push(getCatalogIndex().phase))
    await requestCatalogIndex()
    off()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(seen).toEqual(['loading', 'failed'])
  })

  test('после отказа повтор может и удаться', async () => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(async () => new Response('нет', { status: 503 }))
      .mockImplementationOnce(async () => ok(WIRE))
    vi.stubGlobal('fetch', fetch)
    await requestCatalogIndex()
    await requestCatalogIndex()
    expect(getCatalogIndex().phase).toBe('ready')
  })
})
