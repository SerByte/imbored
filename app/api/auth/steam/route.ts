import { NextResponse } from 'next/server'
import { appBaseUrl } from '@/lib/server'
import { buildSteamLoginUrl } from '@/lib/steam-openid'

export async function GET(req: Request) {
  const search = new URL(req.url).searchParams
  const join = search.get('join')
  const compat = search.get('compat')
  let query = ''
  if (join && /^[A-Z0-9]{6}$/.test(join)) query = `?join=${join}`
  else if (compat && /^\d{17}$/.test(compat)) query = `?compat=${compat}`
  return NextResponse.redirect(buildSteamLoginUrl(`${appBaseUrl()}/api/auth/steam/return${query}`))
}
