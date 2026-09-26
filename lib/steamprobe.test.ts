import { describe, expect, test } from 'vitest'
import { createDb, getCatalogMeta, setCatalogMeta } from './db'
import { runSteamProbe, STEAM_PROBE_EVERY_SEC, STEAM_PROBE_KEY } from './steamprobe'

const T0 = 1_760_000_000
const KEY = 'SECRETKEY0123456789ABCDEF'

/** fetch-заглушка: записывает адреса и отвечает тем, что дали */
function steam(answer: () => Response | Promise<Response>) {
  const urls: string[] = []
  const fetchFn = (async (input: RequestInfo | URL) => {
    urls.push(String(input))
    return answer()
  }) as typeof fetch
  return { urls, fetchFn }
}

describe('runSteamProbe', () => {
  test('живой ключ: Steam отвечает «не найдено» — отметка ok', async () => {
    const db = await createDb(':memory:')
    const { urls, fetchFn } = steam(() => Response.json({ response: { success: 42 } }))
    const mark = await runSteamProbe(db, { nowSec: T0, apiKey: KEY, fetchFn })
    expect(mark).toEqual({ at: T0, ok: true })
    expect(urls).toHaveLength(1)
    // проба ничего личного не спрашивает: имя заведомо чужое
    expect(urls[0]).toContain('ResolveVanityURL')
    expect(JSON.parse((await getCatalogMeta(db, STEAM_PROBE_KEY)) as string)).toEqual({ at: T0, ok: true })
  })

  test('мёртвый ключ: 403 — отметка с причиной, без самого ключа', async () => {
    const db = await createDb(':memory:')
    const { fetchFn } = steam(() => new Response('Forbidden', { status: 403 }))
    const mark = await runSteamProbe(db, { nowSec: T0, apiKey: KEY, fetchFn })
    expect(mark).toMatchObject({ at: T0, ok: false })
    expect(mark?.detail).toContain('HTTP 403')
    expect(await getCatalogMeta(db, STEAM_PROBE_KEY)).not.toContain(KEY)
  })

  test('Steam мигнул (503 дважды) — отметка «мигание», а не «мёртвый ключ»', async () => {
    const db = await createDb(':memory:')
    const { urls, fetchFn } = steam(() => new Response('Service Unavailable', { status: 503 }))
    const mark = await runSteamProbe(db, { nowSec: T0, apiKey: KEY, fetchFn })
    expect(mark).toMatchObject({ ok: false, transient: true })
    expect(urls).toHaveLength(2)
  })

  test('сетевая ошибка с адресом в тексте — ключ вычищен', async () => {
    const db = await createDb(':memory:')
    const { fetchFn } = steam(() => {
      throw new TypeError(`fetch failed: https://api.steampowered.com/x?key=${KEY}&format=json`)
    })
    const mark = await runSteamProbe(db, { nowSec: T0, apiKey: KEY, fetchFn })
    expect(mark).toMatchObject({ ok: false, transient: true })
    expect(JSON.stringify(mark)).not.toContain(KEY)
  })

  test('ключа нет — отметка «нет ключа», в Steam не ходим', async () => {
    const db = await createDb(':memory:')
    const { urls, fetchFn } = steam(() => Response.json({}))
    expect(await runSteamProbe(db, { nowSec: T0, apiKey: null, fetchFn })).toEqual({
      at: T0,
      ok: false,
      detail: 'нет ключа',
    })
    expect(urls).toEqual([])
  })

  test('свежая отметка — в Steam не ходим', async () => {
    const db = await createDb(':memory:')
    await setCatalogMeta(db, STEAM_PROBE_KEY, JSON.stringify({ at: T0 - 60, ok: true }))
    const { urls, fetchFn } = steam(() => Response.json({ response: { success: 42 } }))
    expect(await runSteamProbe(db, { nowSec: T0, apiKey: KEY, fetchFn })).toBeNull()
    expect(urls).toEqual([])
    // а через положенное время — снова
    expect(await runSteamProbe(db, { nowSec: T0 - 60 + STEAM_PROBE_EVERY_SEC, apiKey: KEY, fetchFn })).toMatchObject({
      ok: true,
    })
    expect(urls).toHaveLength(1)
  })
})
