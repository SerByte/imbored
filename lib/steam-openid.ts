import { randomBytes, timingSafeEqual } from 'node:crypto'

const OPENID_NS = 'http://specs.openid.net/auth/2.0'
const OPENID_IDENTIFIER = 'http://specs.openid.net/auth/2.0/identifier_select'
const LOGIN_URL = 'https://steamcommunity.com/openid/login'
const VERIFY_TIMEOUT_MS = 10_000
const CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/

/** Куда Steam возвращает человека. Один адрес на оба роута: старт кладёт его в return_to, возврат сверяет. */
export const RETURN_PATH = '/api/auth/steam/return'

/**
 * Поля, которые Steam обязан подписать. Подпись покрывает только то, что
 * перечислено в openid.signed, и всё, чего там нет, можно подменить, не
 * тронув её. Steam подписывает все пять — честный ответ проверку проходит.
 */
const MUST_SIGN = ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce']

/**
 * Возраст ответа Steam. Nonce ставится в момент возврата, а не входа, так что
 * пароль и Steam Guard в эти минуты не входят: честный редирект доезжает за
 * секунды. В обе стороны — на случай расхождения часов.
 */
const NONCE_MAX_SKEW_SEC = 300

const STATE_RE = /^[0-9a-f]{32}$/

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
 * Случайный state для одного входа. Уходит в return_to и в куку браузера,
 * который вход начал; возврат принимается, только если они совпали.
 */
export function newLoginState(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Совпал ли state из адреса с кукой этого браузера.
 *
 * Без этой сверки ассерт не привязан к человеку: свой честный ответ Steam
 * можно подсунуть чужому браузеру ссылкой, и тот молча войдёт в ЧУЖОЙ
 * профиль — дальше его квиз, фидбек и баны пишутся туда (login CSRF).
 * Сравнение постоянного времени — чтобы state нельзя было подбирать по
 * времени ответа.
 */
export function stateMatches(cookie: string | null | undefined, got: string | null | undefined): boolean {
  if (!cookie || !got || !STATE_RE.test(cookie) || !STATE_RE.test(got)) return false
  return timingSafeEqual(Buffer.from(cookie), Buffer.from(got))
}

/** Время из response_nonce («2026-09-23T12:00:00Z» + уникальный хвост), в секундах, либо null. */
function nonceTime(nonce: string): number | null {
  const m = nonce.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z/)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number)
  const ms = Date.UTC(y, mo - 1, d, h, mi, s)
  return Number.isFinite(ms) ? ms / 1000 : null
}

/**
 * return_to из ассерта указывает на НАШ возврат и несёт ровно тот query, с
 * которым пришёл запрос (без openid.*).
 *
 * Query сверяется разобранным, а не строкой: Steam вправе перекодировать
 * return_to (%2F против /, порядок параметров), и строковое сравнение
 * закрыло бы вход всем из-за формы записи, а не из-за подмены.
 */
function returnToMatches(params: URLSearchParams, expectedReturnTo: string): boolean {
  let got: URL
  let want: URL
  try {
    got = new URL(params.get('openid.return_to') ?? '')
    want = new URL(expectedReturnTo)
  } catch {
    return false
  }
  if (got.origin !== want.origin || got.pathname !== want.pathname) return false
  const sorted = (entries: Iterable<[string, string]>) =>
    [...entries].map(([k, v]) => `${k}=${v}`).sort()
  const signed = sorted(got.searchParams)
  const ours = sorted([...params].filter(([k]) => !k.startsWith('openid.')))
  return signed.length === ours.length && signed.every((e, i) => e === ours[i])
}

/**
 * Что в ассерте не так ещё ДО вопроса к Steam, либо null.
 *
 * check_authentication у Steam подтверждает только подпись и не знает, какой
 * сайт спрашивает. Поэтому ассерт, выданный любому другому сайту со входом
 * через Steam, Steam подтвердит и нам — с steamid того, кто входил туда.
 * Отличить его можно лишь по полям самого ассерта: адрес возврата, сервер,
 * выдавший ответ, и свежесть. Возвращается имя проверки, а не булево, —
 * чтобы тест видел, что отказ случился именно там, где задуман.
 */
export function assertionMismatch(
  params: URLSearchParams,
  expectedReturnTo: string,
  nowMs: number,
): string | null {
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
    if (params.getAll(key).length !== 1) return 'duplicate'
  }

  if (params.get('openid.mode') !== 'id_res') return 'mode'
  if (params.get('openid.op_endpoint') !== LOGIN_URL) return 'op_endpoint'

  const claimedId = params.get('openid.claimed_id')
  if (!claimedId || !extractSteamId(claimedId)) return 'claimed_id'
  if (params.get('openid.identity') !== claimedId) return 'identity'

  const signed = new Set((params.get('openid.signed') ?? '').split(','))
  if (MUST_SIGN.some((f) => !signed.has(f))) return 'signed'

  if (!returnToMatches(params, expectedReturnTo)) return 'return_to'

  const at = nonceTime(params.get('openid.response_nonce') ?? '')
  if (at === null || Math.abs(nowMs / 1000 - at) > NONCE_MAX_SKEW_SEC) return 'nonce'

  return null
}

/**
 * Серверная проверка ассерта у Steam (check_authentication) — без неё
 * куку можно получить, подделав параметры возврата.
 *
 * expectedReturnTo — адрес нашего возврата без query: его query обязан
 * совпасть с query пришедшего запроса (см. returnToMatches).
 */
export async function verifyAssertion(
  params: URLSearchParams,
  expectedReturnTo: string,
  fetchFn: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<string | null> {
  if (assertionMismatch(params, expectedReturnTo, nowMs)) return null
  const steamid = extractSteamId(params.get('openid.claimed_id') ?? '')
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
