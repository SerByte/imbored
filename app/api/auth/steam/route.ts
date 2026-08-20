import { NextResponse } from 'next/server'
import { destinationPath } from '@/lib/destination'
import { appBaseUrl } from '@/lib/server'
import { buildSteamLoginUrl } from '@/lib/steam-openid'

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
  let query = ''
  if (join && /^[A-Z0-9]{6}$/.test(join)) query = `?join=${join}`
  else if (compat && /^\d{17}$/.test(compat)) query = `?compat=${compat}`
  else if (next) query = `?next=${encodeURIComponent(next)}`
  return NextResponse.redirect(buildSteamLoginUrl(`${appBaseUrl()}/api/auth/steam/return${query}`))
}
