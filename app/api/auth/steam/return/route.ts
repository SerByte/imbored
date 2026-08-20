import { NextResponse } from 'next/server'
import { saveLibrarySnapshot, upsertUser } from '@/lib/db'
import {
  SESSION_COOKIE,
  appBaseUrl,
  getDb,
  issueSession,
  nowSec,
  sessionCookieOptions,
  steamApiKey,
} from '@/lib/server'
import { fetchOwnedGames, fetchPlayerSummary } from '@/lib/steam'
import { verifyAssertion } from '@/lib/steam-openid'
import { destinationPath } from '@/lib/destination'

export async function GET(req: Request) {
  const base = appBaseUrl()
  const params = new URL(req.url).searchParams

  const steamid = await verifyAssertion(params).catch(() => null)
  if (!steamid) return NextResponse.redirect(`${base}/?error=auth`)

  const key = steamApiKey()
  if (!key) return NextResponse.redirect(`${base}/?error=nokey`)

  try {
    const db = await getDb()
    const now = nowSec()
    const summary = await fetchPlayerSummary(steamid, { apiKey: key }).catch(() => null)
    const games = await fetchOwnedGames(steamid, { apiKey: key })
    if (games === 'private') return NextResponse.redirect(`${base}/?error=private`)
    if (!games.length) return NextResponse.redirect(`${base}/?error=empty`)

    await upsertUser(
      db,
      {
        steamid,
        ...(summary?.personaName ? { personaName: summary.personaName } : {}),
        ...(summary?.avatarUrl ? { avatarUrl: summary.avatarUrl } : {}),
      },
      now,
    )
    await saveLibrarySnapshot(db, steamid, games, now)

    const join = params.get('join')
    const compat = params.get('compat')
    // Куда человек шёл до разворота на лендинг; список закрытый —
    // произвольный адрес сюда не попадёт (см. lib/destination.ts).
    const next = destinationPath(params.get('next'))
    const target =
      join && /^[A-Z0-9]{6}$/.test(join)
        ? `${base}/room/${join}`
        : compat && /^\d{17}$/.test(compat)
          ? `${base}/compat/${compat}`
          : `${base}${next ?? '/quiz'}`
    const res = NextResponse.redirect(target)
    res.cookies.set(
      SESSION_COOKIE,
      await issueSession(steamid, req.headers.get('user-agent')),
      sessionCookieOptions(),
    )
    return res
  } catch {
    return NextResponse.redirect(`${base}/?error=steam`)
  }
}
