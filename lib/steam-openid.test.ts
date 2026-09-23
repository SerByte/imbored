import { describe, expect, test } from 'vitest'
import {
  RETURN_PATH,
  assertionMismatch,
  buildSteamLoginUrl,
  extractSteamId,
  newLoginState,
  stateMatches,
  verifyAssertion,
} from './steam-openid'

describe('buildSteamLoginUrl', () => {
  test('строит корректный checkid_setup URL', () => {
    const url = new URL(buildSteamLoginUrl('http://localhost:3000/api/auth/steam/return'))
    expect(url.origin + url.pathname).toBe('https://steamcommunity.com/openid/login')
    expect(url.searchParams.get('openid.mode')).toBe('checkid_setup')
    expect(url.searchParams.get('openid.return_to')).toBe(
      'http://localhost:3000/api/auth/steam/return',
    )
  })
})

describe('extractSteamId', () => {
  test('достаёт steamid из claimed_id', () => {
    expect(extractSteamId('https://steamcommunity.com/openid/id/76561197960287930')).toBe(
      '76561197960287930',
    )
  })

  test('отклоняет подделки', () => {
    expect(extractSteamId('https://evil.com/openid/id/76561197960287930')).toBeNull()
    expect(extractSteamId('https://steamcommunity.com/openid/id/123')).toBeNull()
    expect(
      extractSteamId('https://steamcommunity.com/openid/id/76561197960287930/../../evil'),
    ).toBeNull()
  })
})

/*
 * Ассерт в том виде, в каком его на самом деле присылает Steam: return_to
 * с нашим query, пять подписанных полей, nonce со временем выдачи.
 */
const BASE = 'https://imbored.cc'
const EXPECTED = `${BASE}${RETURN_PATH}`
const ID = 'https://steamcommunity.com/openid/id/76561197960287930'
const STATE = 'a'.repeat(32)
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0)

function assertion(over: Record<string, string | null> = {}, query = `join=ABC123&state=${STATE}`) {
  const params = new URLSearchParams(query)
  const openid: Record<string, string> = {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': ID,
    'openid.identity': ID,
    'openid.return_to': `${EXPECTED}?${query}`,
    'openid.response_nonce': '2026-09-23T11:59:30Zabcdef',
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'c2lnbmF0dXJl',
  }
  for (const [k, v] of Object.entries({ ...openid, ...over })) {
    if (v !== null) params.set(k, v)
  }
  return params
}

const valid = (async () => new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n')) as typeof fetch

describe('verifyAssertion', () => {
  test('is_valid:true даёт steamid', async () => {
    expect(await verifyAssertion(assertion(), EXPECTED, valid, NOW)).toBe('76561197960287930')
  })

  test('is_valid:false даёт null', async () => {
    const fn = (async () => new Response('is_valid:false\n')) as typeof fetch
    expect(await verifyAssertion(assertion(), EXPECTED, fn, NOW)).toBeNull()
  })

  test('дубль claimed_id отклоняется, даже если Steam говорит is_valid:true', async () => {
    // Мы читаем первое значение, а Steam может подтвердить второе. Тогда чужой
    // подписанный ассерт удостоверил бы steamid жертвы.
    const doubled = assertion()
    doubled.append('openid.claimed_id', 'https://steamcommunity.com/openid/id/76561197960287931')
    expect(await verifyAssertion(doubled, EXPECTED, valid, NOW)).toBeNull()
  })

  test('дубль любого другого параметра тоже отклоняется', async () => {
    const doubled = assertion()
    doubled.append('openid.sig', 'def')
    expect(await verifyAssertion(doubled, EXPECTED, valid, NOW)).toBeNull()
  })

  /*
   * check_authentication подтверждает только подпись. Ассерт, который Steam
   * выдал любому другому сайту со входом через Steam, он подтвердит и нам —
   * поэтому всё, что отличает «наш» ассерт от чужого, проверяется ДО вопроса
   * к Steam, и Steam в этих случаях не спрашивается вовсе.
   */
  const cases: Array<[string, URLSearchParams, string]> = [
    [
      'чужой сайт: return_to на другой origin',
      assertion({ 'openid.return_to': `https://evil.example${RETURN_PATH}?join=ABC123&state=${STATE}` }),
      'return_to',
    ],
    [
      'наш origin, но чужой путь',
      assertion({ 'openid.return_to': `${BASE}/api/other?join=ABC123&state=${STATE}` }),
      'return_to',
    ],
    [
      'http вместо https — это другой origin',
      assertion({ 'openid.return_to': `http://imbored.cc${RETURN_PATH}?join=ABC123&state=${STATE}` }),
      'return_to',
    ],
    [
      'в подписанном return_to другой state',
      assertion({ 'openid.return_to': `${EXPECTED}?join=ABC123&state=${'b'.repeat(32)}` }),
      'return_to',
    ],
    [
      'в запросе параметр, которого нет в return_to',
      assertion(
        { 'openid.return_to': `${EXPECTED}?join=ABC123&state=${STATE}` },
        `join=ABC123&state=${STATE}&next=%2Fdaily`,
      ),
      'return_to',
    ],
    [
      'return_to не адрес',
      assertion({ 'openid.return_to': 'не адрес' }),
      'return_to',
    ],
    [
      'op_endpoint не Steam',
      assertion({ 'openid.op_endpoint': 'https://evil.example/openid/login' }),
      'op_endpoint',
    ],
    ['mode не id_res', assertion({ 'openid.mode': 'cancel' }), 'mode'],
    [
      'return_to вне openid.signed',
      assertion({ 'openid.signed': 'signed,op_endpoint,claimed_id,identity,response_nonce,assoc_handle' }),
      'signed',
    ],
    [
      'op_endpoint вне openid.signed',
      assertion({ 'openid.signed': 'signed,claimed_id,identity,return_to,response_nonce' }),
      'signed',
    ],
    ['openid.signed нет вовсе', assertion({ 'openid.signed': null }), 'signed'],
    [
      'identity не равен claimed_id',
      assertion({ 'openid.identity': 'https://steamcommunity.com/openid/id/76561197960287931' }),
      'identity',
    ],
    [
      'claimed_id не Steam',
      assertion({ 'openid.claimed_id': 'https://evil.example/openid/id/76561197960287930' }),
      'claimed_id',
    ],
    [
      'nonce старше пяти минут',
      assertion({ 'openid.response_nonce': '2026-09-23T11:54:00Zabcdef' }),
      'nonce',
    ],
    [
      'nonce из будущего дальше допуска часов',
      assertion({ 'openid.response_nonce': '2026-09-23T12:06:00Zabcdef' }),
      'nonce',
    ],
    ['nonce без времени', assertion({ 'openid.response_nonce': 'abcdef' }), 'nonce'],
  ]

  for (const [name, params, reason] of cases) {
    test(`${name} → отказ без запроса к Steam`, async () => {
      expect(assertionMismatch(params, EXPECTED, NOW)).toBe(reason)
      let asked = false
      const fn = (async () => {
        asked = true
        return new Response('is_valid:true\n')
      }) as typeof fetch
      expect(await verifyAssertion(params, EXPECTED, fn, NOW)).toBeNull()
      expect(asked, 'Steam спросили, хотя ассерт отбраковывается и так').toBe(false)
    })
  }

  test('перекодированный return_to не считается подменой', () => {
    // Steam вправе записать query по-своему: %2F вместо /, другой порядок.
    // Сверяются разобранные параметры, а не строки, — иначе вход закрылся бы всем.
    const params = assertion(
      { 'openid.return_to': `${EXPECTED}?state=${STATE}&next=/daily` },
      `next=%2Fdaily&state=${STATE}`,
    )
    expect(assertionMismatch(params, EXPECTED, NOW)).toBeNull()
  })

  test('без query тоже работает: сверяется пустое с пустым', () => {
    const params = assertion({ 'openid.return_to': EXPECTED }, '')
    expect(assertionMismatch(params, EXPECTED, NOW)).toBeNull()
  })
})

describe('state входа', () => {
  test('каждый вход получает свой state', () => {
    const a = newLoginState()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(newLoginState()).not.toBe(a)
  })

  test('совпадение куки и адреса — да, всё остальное — нет', () => {
    expect(stateMatches(STATE, STATE)).toBe(true)
    expect(stateMatches(STATE, 'b'.repeat(32))).toBe(false)
    // Нет куки — вход начат не в этом браузере (или ссылка подсунута извне)
    expect(stateMatches(undefined, STATE)).toBe(false)
    expect(stateMatches(STATE, null)).toBe(false)
    expect(stateMatches('', '')).toBe(false)
    // Другая длина не должна ронять timingSafeEqual
    expect(stateMatches(STATE, STATE.slice(1))).toBe(false)
    expect(stateMatches(STATE.toUpperCase(), STATE.toUpperCase())).toBe(false)
  })
})
