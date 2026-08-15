import { describe, expect, test } from 'vitest'
import { newSid, signSession, signSessionV2, verifySession, verifySessionV2 } from './session'

const SID = 'a'.repeat(32)
const STEAMID = '76561197960287930'

describe('session', () => {
  test('подписанное значение проходит проверку', () => {
    const token = signSession(STEAMID, 'secret')
    expect(verifySession(token, 'secret')).toBe(STEAMID)
  })

  test('подделка и чужой секрет отклоняются', () => {
    const token = signSession(STEAMID, 'secret')
    expect(verifySession(token.replace(STEAMID, '76561197960287931'), 'secret')).toBeNull()
    expect(verifySession(token, 'other')).toBeNull()
    expect(verifySession('garbage', 'secret')).toBeNull()
  })
})

describe('session v2', () => {
  const token = signSessionV2({ sid: SID, steamid: STEAMID, iat: 1000, exp: 2000 }, 'secret')

  test('round-trip возвращает все поля', () => {
    expect(verifySessionV2(token, 'secret')).toEqual({
      sid: SID,
      steamid: STEAMID,
      iat: 1000,
      exp: 2000,
    })
  })

  test('подделка любого поля и чужой секрет отклоняются', () => {
    expect(verifySessionV2(token, 'other')).toBeNull()
    // срок «продлён» руками — подпись накрывает весь payload целиком
    expect(verifySessionV2(token.replace(':2000.', ':99999999.'), 'secret')).toBeNull()
    expect(verifySessionV2(token.replace(STEAMID, '76561197960287931'), 'secret')).toBeNull()
    expect(verifySessionV2('garbage', 'secret')).toBeNull()
  })

  test('мусор в полях не проходит, даже подписанный', () => {
    // подписываем заведомо кривые значения тем же секретом: отбить должна
    // проверка формата, а не подписи
    for (const bad of [
      { sid: 'ZZZ', steamid: STEAMID, iat: 1, exp: 2 },
      { sid: SID, steamid: '123', iat: 1, exp: 2 },
    ]) {
      expect(verifySessionV2(signSessionV2(bad, 'secret'), 'secret')).toBeNull()
    }
  })

  test('форматы не подменяют друг друга ни в какую сторону', () => {
    // v1-кука не должна читаться как v2 — иначе сессия без срока и без sid
    expect(verifySessionV2(signSession(STEAMID, 'secret'), 'secret')).toBeNull()
    // и наоборот: v2 не должна читаться как «steamid» старым разбором
    expect(verifySession(token, 'secret')).toBeNull()
  })

  test('sid — 32 hex-символа и каждый раз новый', () => {
    const a = newSid()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(newSid())
  })
})
