import { beforeEach, expect, test } from 'vitest'
import { createDb } from './db'
import {
  checkRate,
  clientIp,
  rateLimitedResponse,
  rateUsage,
  resetRateMemory,
  sweepRateLimits,
} from './ratelimit'

const NOW = 1_700_000_000

function freshDb() {
  return createDb(':memory:')
}

const base = { bucket: 'test', id: 'a', limit: 3, windowSec: 60, nowSec: NOW }

beforeEach(() => {
  resetRateMemory()
})

test('пропускает попытки до лимита включительно', async () => {
  const db = await freshDb()
  for (let i = 0; i < 3; i++) {
    expect((await checkRate(db, base)).ok).toBe(true)
  }
})

test('отказывает на попытке сверх лимита', async () => {
  const db = await freshDb()
  for (let i = 0; i < 3; i++) await checkRate(db, base)
  const verdict = await checkRate(db, base)
  expect(verdict.ok).toBe(false)
  if (!verdict.ok) expect(verdict.retryAfterSec).toBeGreaterThan(0)
})

test('счётчики разных id не смешиваются', async () => {
  const db = await freshDb()
  for (let i = 0; i < 3; i++) await checkRate(db, base)
  expect((await checkRate(db, { ...base, id: 'b' })).ok).toBe(true)
})

test('счётчики разных bucket не смешиваются', async () => {
  const db = await freshDb()
  for (let i = 0; i < 3; i++) await checkRate(db, base)
  expect((await checkRate(db, { ...base, bucket: 'other' })).ok).toBe(true)
})

test('новое окно обнуляет счёт', async () => {
  const db = await freshDb()
  for (let i = 0; i < 4; i++) await checkRate(db, base)
  expect((await checkRate(db, { ...base, nowSec: NOW + 60 })).ok).toBe(true)
})

test('retryAfterSec — это остаток текущего окна, а не длина окна', async () => {
  const db = await freshDb()
  // Ставим момент за 10 секунд до границы окна, не полагаясь на то, чему
  // кратен NOW: ждать после отказа надо ровно эти 10, а не все 60.
  const at = { ...base, nowSec: Math.ceil(NOW / base.windowSec) * base.windowSec - 10 }
  for (let i = 0; i < 3; i++) await checkRate(db, at)
  const verdict = await checkRate(db, at)
  expect(verdict.ok).toBe(false)
  if (!verdict.ok) expect(verdict.retryAfterSec).toBe(10)
})

test('fail open: недоступная база пропускает, а не запирает', async () => {
  const broken = {
    execute: () => Promise.reject(new Error('turso down')),
  } as unknown as Awaited<ReturnType<typeof freshDb>>
  expect((await checkRate(broken, base)).ok).toBe(true)
})

test('префильтр отсекает флуд по одному ключу, не сходив в базу', async () => {
  let calls = 0
  const counting = {
    execute: () => {
      calls++
      return Promise.resolve({ rows: [{ count: 1 }] })
    },
  } as unknown as Awaited<ReturnType<typeof freshDb>>
  // потолок префильтра — limit * 10, то есть 30 при limit = 3
  for (let i = 0; i < 30; i++) await checkRate(counting, base)
  expect(calls).toBe(30)
  const verdict = await checkRate(counting, base)
  expect(verdict.ok).toBe(false)
  expect(calls).toBe(30)
})

test('rateUsage показывает счёт, не увеличивая его', async () => {
  const db = await freshDb()
  await checkRate(db, base)
  await checkRate(db, base)
  expect(await rateUsage(db, base)).toBe(2)
  expect(await rateUsage(db, base)).toBe(2)
})

test('подметание убирает истёкшие окна и не трогает живые', async () => {
  const db = await freshDb()
  await checkRate(db, base)
  await sweepRateLimits(db, NOW + 10)
  expect(await rateUsage(db, base)).toBe(1)
  // строка живёт два окна, поэтому истекает после NOW + 120
  await sweepRateLimits(db, NOW + 200)
  expect(await rateUsage(db, base)).toBe(0)
})

test('clientIp берёт только первый хоп x-forwarded-for', () => {
  const h = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.9.9.9' })
  expect(clientIp(h)).toBe('1.2.3.4')
})

test('clientIp падает на x-real-ip, потом на local', () => {
  expect(clientIp(new Headers({ 'x-real-ip': '4.3.2.1' }))).toBe('4.3.2.1')
  expect(clientIp(new Headers())).toBe('local')
})

test('отказ отдаёт 429 и Retry-After не меньше секунды', async () => {
  const res = rateLimitedResponse(0)
  expect(res.status).toBe(429)
  expect(res.headers.get('Retry-After')).toBe('1')
  expect(await res.json()).toEqual({ error: 'ratelimited' })
})
