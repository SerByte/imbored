import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { feedPath, feedTokenHash, isFeedToken, newFeedToken } from './feedlink'

/**
 * Ключ личной RSS-ленты: его нельзя угадать, в базу он не попадает, а мусор
 * в адресе отсеивается до базы.
 */
describe('ключ личной ленты', () => {
  test('128 бит в hex — и каждый новый ключ свой', () => {
    const keys = new Set(Array.from({ length: 64 }, newFeedToken))
    expect(keys.size).toBe(64)
    for (const k of keys) expect(k).toMatch(/^[0-9a-f]{32}$/)
  })

  test('хранится sha256, а не ключ: по отпечатку ключ не восстановить и не узнать', () => {
    const key = newFeedToken()
    const hash = feedTokenHash(key)
    expect(hash).toBe(createHash('sha256').update(key).digest('hex'))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(key)
    // отпечаток детерминирован — иначе ключ не нашёлся бы в базе
    expect(feedTokenHash(key)).toBe(hash)
  })

  test('до базы доходит только то, что похоже на ключ', () => {
    expect(isFeedToken(newFeedToken())).toBe(true)
    for (const junk of [
      '',
      'abc',
      // на знак короче и длиннее
      'a'.repeat(31),
      'a'.repeat(33),
      // заглавные — не наш ключ: newFeedToken пишет строчными
      'A'.repeat(32),
      // похоже на sid или steamid, но не ключ
      '76561198000000000',
      `${'a'.repeat(31)}g`,
      `${'a'.repeat(31)}/`,
      // отпечаток вместо ключа не откроет ленту: его длина другая
      feedTokenHash(newFeedToken()),
      undefined,
      null,
      42,
    ]) {
      expect(isFeedToken(junk), String(junk)).toBe(false)
    }
  })

  test('путь — под /whatsnew/feed/, без origin', () => {
    const key = newFeedToken()
    expect(feedPath(key)).toBe(`/whatsnew/feed/${key}`)
  })
})
