import { NextResponse } from 'next/server'
import { saveLibrarySnapshot, upsertUser } from '@/lib/db'
import { seedDemo } from '@/lib/demo'
import {
  SESSION_COOKIE,
  currentSteamId,
  demoSteamId,
  getDb,
  issueSession,
  nowSec,
  sessionCookieOptions,
  steamApiKey,
} from '@/lib/server'
import { fetchOwnedGames, fetchPlayerSummary, parseProfileInput, resolveVanity } from '@/lib/steam'

async function withSession(
  res: NextResponse,
  steamid: string,
  userAgent: string | null,
): Promise<NextResponse> {
  res.cookies.set(SESSION_COOKIE, await issueSession(steamid, userAgent), sessionCookieOptions())
  return res
}

export async function POST(req: Request) {
  const userAgent = req.headers.get('user-agent')
  const body = (await req.json().catch(() => ({}))) as {
    input?: string
    demo?: boolean
    variant?: number
  }
  const db = await getDb()
  const now = nowSec()

  if (body.demo) {
    const variant = body.variant === 2 ? 2 : 1
    // Личность привязана к посетителю, а не к режиму: см. demoSteamId.
    // Текущая сессия передаётся, чтобы «демо-друг» встал в пару со своим
    // демо-игроком, а не с чужим.
    const steamid = demoSteamId(variant, await currentSteamId())
    await seedDemo(db, steamid, now, variant)
    return withSession(
      NextResponse.json({
        ok: true,
        steamid,
        personaName: variant === 2 ? 'Демо-друг' : 'Демо-игрок',
        gameCount: variant === 2 ? 10 : 22,
        demo: true,
      }),
      steamid,
      userAgent,
    )
  }

  const key = steamApiKey()
  if (!key) return NextResponse.json({ error: 'nokey' }, { status: 503 })

  const parsed = parseProfileInput(String(body.input ?? ''))
  if (!parsed) return NextResponse.json({ error: 'badinput' }, { status: 400 })

  try {
    const steamid =
      parsed.kind === 'steamid64' ? parsed.value : await resolveVanity(parsed.value, { apiKey: key })
    if (!steamid) return NextResponse.json({ error: 'notfound' }, { status: 404 })

    const summary = await fetchPlayerSummary(steamid, { apiKey: key }).catch(() => null)
    const games = await fetchOwnedGames(steamid, { apiKey: key })
    if (games === 'private') {
      return NextResponse.json(
        { error: 'private', personaName: summary?.personaName ?? null },
        { status: 403 },
      )
    }
    if (!games.length) return NextResponse.json({ error: 'empty' }, { status: 404 })

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
    return withSession(
      NextResponse.json({
        ok: true,
        steamid,
        personaName: summary?.personaName ?? null,
        gameCount: games.length,
      }),
      steamid,
      userAgent,
    )
  } catch {
    return NextResponse.json({ error: 'steam' }, { status: 502 })
  }
}
