import { afterEach, describe, expect, test } from 'vitest'
import { isNeedSteam, writerFrom, writerStore } from './writer'

afterEach(() => {
  writerStore.set(null)
})

describe('isNeedSteam', () => {
  test('403 needsteam — да', async () => {
    expect(await isNeedSteam(Response.json({ error: 'needsteam' }, { status: 403 }))).toBe(true)
  })

  test('другие 403 — нет: у nothost и notmember свои советы', async () => {
    for (const error of ['nothost', 'notmember', 'private']) {
      expect(await isNeedSteam(Response.json({ error }, { status: 403 })), error).toBe(false)
    }
  })

  test('тот же код под другим статусом и не-JSON — нет', async () => {
    expect(await isNeedSteam(Response.json({ error: 'needsteam' }, { status: 401 }))).toBe(false)
    expect(await isNeedSteam(new Response('<html>', { status: 403 }))).toBe(false)
  })

  test('тело остаётся вызывающему', async () => {
    const res = Response.json({ error: 'needsteam' }, { status: 403 })
    await isNeedSteam(res)
    expect(await res.json()).toEqual({ error: 'needsteam' })
  })
})

describe('writerFrom', () => {
  test('берёт только boolean', () => {
    expect(writerFrom({ authed: true, writer: true })).toBe(true)
    expect(writerFrom({ authed: true, writer: false })).toBe(false)
    for (const body of [{ authed: false }, { writer: 'false' }, null, 'writer', 1]) {
      expect(writerFrom(body), JSON.stringify(body)).toBeNull()
    }
  })
})

describe('writerStore', () => {
  test('оповещает только о настоящей смене и отписывается', () => {
    let calls = 0
    const off = writerStore.subscribe(() => {
      calls += 1
    })
    writerStore.set(false)
    writerStore.set(false)
    expect(writerStore.get()).toBe(false)
    expect(calls).toBe(1)
    off()
    writerStore.set(true)
    expect(calls).toBe(1)
  })

  test('на сервере — всегда «не знаем»', () => {
    writerStore.set(false)
    expect(writerStore.server()).toBeNull()
  })
})
