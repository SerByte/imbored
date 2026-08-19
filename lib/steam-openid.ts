const OPENID_NS = 'http://specs.openid.net/auth/2.0'
const OPENID_IDENTIFIER = 'http://specs.openid.net/auth/2.0/identifier_select'
const LOGIN_URL = 'https://steamcommunity.com/openid/login'
const VERIFY_TIMEOUT_MS = 10_000
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
  /*
   * Ни один параметр не должен приходить дважды.
   *
   * Иначе получается расхождение: params.get отдаёт ПЕРВОЕ значение, а в теле
   * запроса к Steam уезжают оба, и какое из них подтвердит Steam — свойство
   * его разборщика, а не наше решение. Достаточно прислать свой подписанный
   * ассерт вторым значением, чтобы мы прочитали чужой steamid и получили на
   * него «is_valid:true». Единственное место, где решается, кто вошёл, не
   * может зависеть от такой удачи.
   *
   * Честные ответы Steam дублей не содержат, так что видимого поведения это
   * не меняет.
   */
  for (const key of new Set(params.keys())) {
    if (params.getAll(key).length !== 1) return null
  }

  const claimedId = params.get('openid.claimed_id')
  if (!claimedId) return null
  const steamid = extractSteamId(claimedId)
  if (!steamid) return null

  const body = new URLSearchParams(params)
  body.set('openid.mode', 'check_authentication')
  // Единственный исходящий запрос в проекте, который жил без таймаута, — и он
  // же стоял на пути входа: зависший steamcommunity.com держал бы роут до
  // платформенного потолка, съев всю инвокацию и не оставив пользователю
  // ничего, кроме белого экрана. Десять секунд — как у всех остальных вызовов.
  const res = await fetchFn(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
  })
  if (!res.ok) return null
  const text = await res.text()
  return /is_valid\s*:\s*true/.test(text) ? steamid : null
}
