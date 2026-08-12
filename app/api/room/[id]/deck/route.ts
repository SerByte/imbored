import { NextResponse } from 'next/server'
import { getAllGamesMeta, getLatestSnapshot, getRoom, myVotedAppids, roomMembers } from '@/lib/db'
import { buildGroupDeck } from '@/lib/group'
import { currentSteamId, getDb } from '@/lib/server'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/
const DECK_SIZE = 20

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  if (!(await getRoom(db, id))) return NextResponse.json({ error: 'notfound' }, { status: 404 })

  const members = await roomMembers(db, id)
  if (!members.some((m) => m.steamid === steamid)) {
    return NextResponse.json({ error: 'notmember' }, { status: 403 })
  }

  const metas = await getAllGamesMeta(db)
  const libraries = await Promise.all(
    members.map(async (m) => ({
      steamid: m.steamid,
      name: m.personaName ?? `Игрок ${m.steamid.slice(-4)}`,
      library: (await getLatestSnapshot(db, m.steamid))?.games ?? [],
    })),
  )

  const deck = buildGroupDeck({
    members: libraries,
    metaOf: (appid) => metas.get(appid),
    extraPool: [...metas.values()].filter((m) => Object.keys(m.tags).length > 0),
    limit: DECK_SIZE,
  })

  const voted = await myVotedAppids(db, id, steamid)
  const cards = deck
    .filter((c) => !voted.has(c.appid))
    .map((c) => ({
      ...c,
      headerImage:
        c.headerImage ??
        (c.appid > 0
          ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${c.appid}/header.jpg`
          : null),
    }))

  return NextResponse.json({
    cards,
    total: deck.length,
    votedCount: deck.filter((c) => voted.has(c.appid)).length,
  })
}
