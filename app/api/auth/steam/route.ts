import { NextResponse } from 'next/server'
import { destinationPath } from '@/lib/destination'
import { OIDC_COOKIE, appBaseUrl, oidcCookieOptions } from '@/lib/server'
import { RETURN_PATH, buildSteamLoginUrl, newLoginState } from '@/lib/steam-openid'

export async function GET(req: Request) {
  const search = new URL(req.url).searchParams
  const join = search.get('join')
  const compat = search.get('compat')
  /*
   * next — куда человек шёл до того, как его развернуло на лендинг.
   * Без проброса сюда вход через Steam всегда высаживал на /quiz, и
   * обещание «вернём туда, куда ты шёл» держала бы только вторая дорога
   * (ссылка на профиль). Адрес сверяется со списком в lib/destination,
   * поэтому в возврат не может попасть чужой.
   */
  const next = destinationPath(search.get('next'))
  const query = new URLSearchParams()
  if (join && /^[A-Z0-9]{6}$/.test(join)) query.set('join', join)
  else if (compat && /^\d{17}$/.test(compat)) query.set('compat', compat)
  else if (next) query.set('next', next)
  /*
   * state привязывает вход к ЭТОМУ браузеру: он едет в return_to (Steam его
   * подписывает вместе с адресом) и в куку, и возврат принимается, только
   * если они совпали. См. stateMatches в lib/steam-openid.
   */
  const state = newLoginState()
  query.set('state', state)
  const res = NextResponse.redirect(buildSteamLoginUrl(`${appBaseUrl()}${RETURN_PATH}?${query}`))
  res.cookies.set(OIDC_COOKIE, state, oidcCookieOptions())
  return res
}
