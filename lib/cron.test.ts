import { afterEach, describe, expect, test, vi } from 'vitest'
import { cronAuthorized, DIGEST_STALE_SEC, digestLooksStale } from './cron'

// Заголовки HTTP это ByteString: секрет обязан быть ASCII.
// Vercel генерирует hex, так что на практике это не ограничение.
const h = (init: Record<string, string> = {}) => new Headers(init)

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('cronAuthorized', () => {
  test('пускает по Bearer, которым Vercel зовёт крон', () => {
    vi.stubEnv('CRON_SECRET', 's3cr3t-long-enough-abc')
    expect(cronAuthorized(h({ authorization: 'Bearer s3cr3t-long-enough-abc' }))).toBe(true)
    expect(cronAuthorized(h({ Authorization: 'bearer s3cr3t-long-enough-abc' }))).toBe(true)
  })

  test('пускает по x-cron-secret — для curl и внешнего пингера', () => {
    vi.stubEnv('CRON_SECRET', 's3cr3t-long-enough-abc')
    expect(cronAuthorized(h({ 'x-cron-secret': 's3cr3t-long-enough-abc' }))).toBe(true)
  })

  test('чужой или пустой секрет не проходит', () => {
    vi.stubEnv('CRON_SECRET', 's3cr3t-long-enough-abc')
    expect(cronAuthorized(h())).toBe(false)
    expect(cronAuthorized(h({ authorization: 'Bearer wrong-but-same-len' }))).toBe(false)
    expect(cronAuthorized(h({ 'x-cron-secret': '' }))).toBe(false)
    // разная длина не должна ронять timingSafeEqual
    expect(() => cronAuthorized(h({ 'x-cron-secret': 'x' }))).not.toThrow()
  })

  test('без секрета в проде закрыто наглухо', () => {
    // иначе публичный роут, дёргающий Steam и Claude, — бесплатный усилитель
    vi.stubEnv('CRON_SECRET', '')
    vi.stubEnv('VERCEL', '1')
    expect(cronAuthorized(h())).toBe(false)

    vi.stubEnv('VERCEL', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(cronAuthorized(h())).toBe(false)
  })

  test('локально без секрета открыто, чтобы не мешать разработке', () => {
    vi.stubEnv('CRON_SECRET', '')
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('NODE_ENV', 'test')
    expect(cronAuthorized(h())).toBe(true)
  })
})

const NOW = 1_700_000_000
const slice = (at: number) => JSON.stringify({ at, chain: 0, digested: 25 })

describe('digestLooksStale: подстраховка на случай, если GitHub замолчит', () => {
  test('свежий срез — не трогаем', () => {
    expect(digestLooksStale(slice(NOW - 600), NOW)).toBe(false)
  })

  test('молчит дольше порога — пинаем', () => {
    expect(digestLooksStale(slice(NOW - DIGEST_STALE_SEC + 1), NOW)).toBe(false)
    expect(digestLooksStale(slice(NOW - DIGEST_STALE_SEC), NOW)).toBe(true)
  })

  test('ни разу не отрабатывал — пинаем', () => {
    // первый прогон после деплоя: записи ещё нет
    expect(digestLooksStale(null, NOW)).toBe(true)
  })

  test('мусор вместо записи — тоже пинаем', () => {
    // отсутствие подтверждения, что пересказы живы, и есть повод пнуть:
    // молчаливая поломка хуже лишнего запроса
    expect(digestLooksStale('не json', NOW)).toBe(true)
    expect(digestLooksStale('{}', NOW)).toBe(true)
    expect(digestLooksStale(JSON.stringify({ at: 'вчера' }), NOW)).toBe(true)
    expect(digestLooksStale(JSON.stringify({ at: 0 }), NOW)).toBe(true)
  })

  test('порог можно задать явно', () => {
    expect(digestLooksStale(slice(NOW - 100), NOW, 50)).toBe(true)
    expect(digestLooksStale(slice(NOW - 100), NOW, 500)).toBe(false)
  })
})
