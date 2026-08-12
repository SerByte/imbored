const OPENID_NS = 'http://specs.openid.net/auth/2.0'
const OPENID_IDENTIFIER = 'http://specs.openid.net/auth/2.0/identifier_select'
const LOGIN_URL = 'https://steamcommunity.com/openid/login'
const CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/

export function buildSteamLoginUrl(returnTo: string): string {
  const url = new URL(LOGIN_URL)
  url.searchParams.set('openid.ns', OPENID_NS)
  url.searchParams.set('openid.mode', 'checkid_setup')
  url.searchParams.set('openid.return_to', returnTo)
  url.searchParams.set('openid.realm', new URL(returnTo).origin)
  url.searchParams.set('openid.identity', OPENID_IDENTIFIER)
  url.searchParams.set('openid.claimed_id', OPENID_IDENTIFIER)
  return url.toString()
}

export function extractSteamId(claimedId: string): string | null {
  const m = claimedId.match(CLAIMED_ID_RE)
  return m ? m[1] : null
}

/**
 * Серверная проверка ассерта у Steam (check_authentication) — без неё
 * куку можно получить, подделав параметры возврата.
 */
export async function verifyAssertion(
  params: URLSearchParams,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const claimedId = params.get('openid.claimed_id')
  if (!claimedId) return null
  const steamid = extractSteamId(claimedId)
  if (!steamid) return null

  const body = new URLSearchParams(params)
  body.set('openid.mode', 'check_authentication')
  const res = await fetchFn(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) return null
  const text = await res.text()
  return /is_valid\s*:\s*true/.test(text) ? steamid : null
}
