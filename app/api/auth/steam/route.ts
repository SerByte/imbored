import { NextResponse } from 'next/server'
import { safeNext } from '@/lib/nav'
import { appBaseUrl } from '@/lib/server'
import { buildSteamLoginUrl } from '@/lib/steam-openid'

/**
 * Куда вернуть человека после Steam — решается ЗДЕСЬ, а не на возврате.
 *
 * return_to уезжает внутрь подписанного ассерта, и дописать его на обратном
 * пути уже нельзя. Поэтому и join/compat, и next валидируются на этом конце;
 * на возврате те же проверки повторяются как защита в глубину.
 *
 * Порядок ветвления сохранён: join и compat — конкретные приглашения и важнее
 * общего «вернись, где стоял».
 */
export async function GET(req: Request) {
  const search = new URL(req.url).searchParams
  const join = search.get('join')
  const compat = search.get('compat')
  const next = safeNext(search.get('next'))
  let query = ''
  if (join && /^[A-Z0-9]{6}$/.test(join)) query = `?join=${join}`
  else if (compat && /^\d{17}$/.test(compat)) query = `?compat=${compat}`
  else if (next) query = `?next=${encodeURIComponent(next)}`
  return NextResponse.redirect(buildSteamLoginUrl(`${appBaseUrl()}/api/auth/steam/return${query}`))
}
