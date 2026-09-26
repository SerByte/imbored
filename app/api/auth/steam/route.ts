import { NextResponse } from 'next/server'
import { loginCarry } from '@/lib/destination'
import { browserHost } from '@/lib/origin'
import { clientIp, memoryGate } from '@/lib/ratelimit'
import { OIDC_COOKIE, appBaseUrl, nowSec, oidcCookieOptions } from '@/lib/server'
import { RETURN_PATH, buildSteamLoginUrl, newLoginState } from '@/lib/steam-openid'
import { recordTelemetryLater } from '@/lib/telemetry'
import { eventKey } from '@/lib/track'

export async function GET(req: Request) {
  /*
   * join, compat или next — куда человек шёл до того, как его развернуло на
   * лендинг. Без проброса сюда вход через Steam всегда высаживал на /quiz, и
   * обещание «вернём туда, куда ты шёл» держала бы только вторая дорога
   * (ссылка на профиль). Всё сверяется в loginCarry (lib/destination),
   * поэтому в возврат не может попасть чужой адрес.
   */
  const query = loginCarry(new URL(req.url).searchParams)
  const base = appBaseUrl()

  /*
   * Сначала — на канонический хост, и только там кука state.
   *
   * Steam возвращает человека на appBaseUrl(), а кука живёт на том хосте,
   * где её поставили. Начатый на превью, на адресе *.vercel.app или локально
   * на 127.0.0.1 при localhost в APP_BASE_URL вход возвращался на хост без
   * куки, stateMatches отказывал — и каждая попытка кончалась ?error=auth.
   * До куки state такой вход просто заканчивался на боевом домене; так он
   * заканчивается и теперь.
   *
   * Цель прыжка — всегда appBaseUrl(), а не заголовок запроса, так что
   * подделанный Host никуда, кроме нашего же адреса, не уведёт. Без
   * заголовков (скрипт, тест) решать не из чего — идём как есть.
   */
  const host = browserHost(req.headers)
  if (host !== null && host !== new URL(base).hostname) {
    return NextResponse.redirect(`${base}/api/auth/steam${query.size ? `?${query}` : ''}`)
  }

  /*
   * state привязывает вход к ЭТОМУ браузеру: он едет в return_to (Steam его
   * подписывает вместе с адресом) и в куку, и возврат принимается, только
   * если они совпали. См. stateMatches в lib/steam-openid.
   */
  const state = newLoginState()
  query.set('state', state)
  const res = NextResponse.redirect(buildSteamLoginUrl(`${base}${RETURN_PATH}?${query}`))
  res.cookies.set(OIDC_COOKIE, state, oidcCookieOptions())
  // Шаг воронки — здесь, после прыжка на канонический хост: иначе один вход
  // считался бы дважды. Под потолком в памяти: ручка открыта GET'ом без
  // сессии, и обход ссылок ботом иначе писал бы в базу без предела
  if (
    memoryGate({ bucket: 'connect-start', id: clientIp(req.headers), limit: 10, windowSec: 600, nowSec: nowSec() })
  ) {
    recordTelemetryLater('event', eventKey('connect_start', 'openid'))
  }
  return res
}
