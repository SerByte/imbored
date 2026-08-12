import { describe, expect, test } from 'vitest'
import { buildSteamLoginUrl, extractSteamId, verifyAssertion } from './steam-openid'

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

describe('verifyAssertion', () => {
  const params = new URLSearchParams({
    'openid.mode': 'id_res',
    'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561197960287930',
    'openid.sig': 'abc',
  })

  test('is_valid:true даёт steamid', async () => {
    const fn = (async () => new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n')) as typeof fetch
    expect(await verifyAssertion(params, fn)).toBe('76561197960287930')
  })

  test('is_valid:false даёт null', async () => {
    const fn = (async () => new Response('is_valid:false\n')) as typeof fetch
    expect(await verifyAssertion(params, fn)).toBeNull()
  })
})
