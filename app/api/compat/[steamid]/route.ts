import { NextResponse } from 'next/server'
import { compatibility } from '@/lib/compat'
import { getAllGamesMeta, getLatestSnapshot, getPersonaName } from '@/lib/db'
import { buildGroupDeck } from '@/lib/group'
import { currentSteamId, getDb } from '@/lib/server'

export async function GET(_req: Request, ctx: { params: Promise<{ steamid: string }> }) {
  const { steamid: otherRaw } = await ctx.params
  if (!/^\d{17}$/.test(otherRaw)) return NextResponse.json({ error: 'badid' }, { status: 404 })

  const me = await currentSteamId()
  if (!me) return NextResponse.json({ error: 'nosession' }, { status: 401 })
  if (me === otherRaw) return NextResponse.json({ error: 'self' }, { status: 400 })

  const db = await getDb()
  const mySnap = await getLatestSnapshot(db, me)
  if (!mySnap) return NextResponse.json({ error: 'nolibrary' }, { status: 409 })
  const otherSnap = await getLatestSnapshot(db, otherRaw)
  if (!otherSnap) return NextResponse.json({ error: 'noprofile' }, { status: 404 })

  const [myName, otherName] = await Promise.all([
    getPersonaName(db, me),
    getPersonaName(db, otherRaw),
  ])
  const nameOf = (steamid: string, stored: string | null) =>
    stored ?? `Игрок ${steamid.slice(-4)}`

  const metas = await getAllGamesMeta(db)
  const metaOf = (appid: number) => metas.get(appid)
  const compat = compatibility(mySnap.games, otherSnap.games, metaOf)

  const playTogether = buildGroupDeck({
    members: [
      { steamid: me, name: nameOf(me, myName), library: mySnap.games },
      { steamid: otherRaw, name: nameOf(otherRaw, otherName), library: otherSnap.games },
    ],
    metaOf,
    extraPool: [...metas.values()].filter((m) => Object.keys(m.tags).length > 0),
    limit: 3,
  })

  // Ссылку на арт не угадываем шаблоном — путь Steam контент-адресуемый.
  // Отдаём то, что резолвлено в базе, остальное доберёт GameArt на клиенте.
  return NextResponse.json({
    ...compat,
    commonGames: compat.commonGames.map((g) => ({
      ...g,
      headerImage: metaOf(g.appid)?.headerImage ?? null,
    })),
    playTogether,
    myName: nameOf(me, myName),
    otherName: nameOf(otherRaw, otherName),
    mySteamid: me,
  })
}
