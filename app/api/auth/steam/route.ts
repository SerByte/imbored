import { NextResponse } from 'next/server'
import { loginCarry } from '@/lib/destination'
import { DEFAULT_LOCALE, localeFromRequest, splitLocale, type Locale } from '@/lib/i18n'
import { browserHost } from '@/lib/origin'
import { clientIp, memoryGate } from '@/lib/ratelimit'
import { OIDC_COOKIE, appBaseUrl, nowSec, oidcCookieOptions } from '@/lib/server'
import { RETURN_PATH, buildSteamLoginUrl, newLoginState } from '@/lib/steam-openid'
import { recordTelemetryLater } from '@/lib/telemetry'
import { eventKey } from '@/lib/track'

/**
 * Язык, на котором человек нажал «Войти через Steam»: ?lang= в адресе, иначе
 * путь своей же страницы из Referer (/en/library → en), иначе русский.
 *
 * Ссылок на вход два десятка, и все — голые <a href="/api/auth/steam…">,
 * собранные в том числе на сервере, где языка ссылки не знает никто, кроме
 * страницы. Referer со своей страницы браузер шлёт целиком —
 * Referrer-Policy сайта strict-origin-when-cross-origin (lib/csp.ts), — и
 * язык страницы в нём уже есть. Чужой Referer не в счёт.
 *
 * Язык едет через Steam в return_to (?lang=en), и возврат ведёт на страницу
 * того же языка, а не на русскую (app/api/auth/steam/return).
 */
function loginLocale(req: Request): Locale {
  if (new URL(req.url).searchParams.has('lang')) return localeFromRequest(req)
  const referer = req.headers.get('referer')
  if (!referer) return DEFAULT_LOCALE
  try {
    const from = new URL(referer)
    return from.hostname === browserHost(req.headers) ? splitLocale(from.pathname).locale : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

export async function GET(req: Request) {
  /*
   * join, compat или next — куда человек шёл до того, как его развернуло на
   * лендинг. Без проброса сюда вход через Steam всегда высаживал на /quiz, и
   * обещание «вернём туда, куда ты шёл» держала бы только вторая дорога
   * (ссылка на профиль). Всё сверяется в loginCarry (lib/destination),
   * поэтому в возврат не может попасть чужой адрес.
   */
  const query = loginCarry(new URL(req.url).searchParams)
  const locale = loginLocale(req)
  if (locale !== DEFAULT_LOCALE) query.set('lang', locale)
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
