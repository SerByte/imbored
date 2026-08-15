import { NextResponse } from 'next/server'
import { compatibility } from '@/lib/compat'
import { countIngest, getGamesMeta, getLatestSnapshot, getPersonaName, loadTagStats } from '@/lib/db'
import { discountView } from '@/lib/discount'
import { buildGroupDeck } from '@/lib/group'
import { fetchDiscoveryPool, pickQueryTags } from '@/lib/pool'
import { buildTagProfile } from '@/lib/recommend'
import { currentSteamId, getDb, nowSec } from '@/lib/server'

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

  // Совместимость считается по двум библиотекам — весь каталог для этого не нужен
  const metas = await getGamesMeta(db, [
    ...new Set([...mySnap.games, ...otherSnap.games].map((g) => g.appid)),
  ])
  const metaOf = (appid: number) => metas.get(appid)

  // Карта тегов нужна и метрике совместимости, и подбору общих игр ниже —
  // грузим один раз, до расчёта.
  const [tagStats, catalogSize] = await Promise.all([loadTagStats(db), countIngest(db)])
  const compat = compatibility(mySnap.games, otherSnap.games, metaOf, tagStats)

  const pairProfile = buildTagProfile([...mySnap.games, ...otherSnap.games], metaOf)
  const extraPool = await fetchDiscoveryPool(db, {
    tags: pickQueryTags(pairProfile, tagStats, catalogSize),
    requireMultiplayer: true,
    limit: 80,
  })
  for (const m of extraPool) if (!metas.has(m.appid)) metas.set(m.appid, m)

  const playTogether = buildGroupDeck({
    members: [
      { steamid: me, name: nameOf(me, myName), library: mySnap.games },
      { steamid: otherRaw, name: nameOf(otherRaw, otherName), library: otherSnap.games },
    ],
    metaOf,
    extraPool,
    limit: 3,
  })

  // Ссылку на арт не угадываем шаблоном — путь Steam контент-адресуемый.
  // Отдаём то, что резолвлено в базе, остальное доберёт GameArt на клиенте.
  return NextResponse.json({
    ...compat,
    commonGames: compat.commonGames.map((g) => ({
      ...g,
      headerImage: metaOf(g.appid)?.headerImage ?? null,
      art: metaOf(g.appid)?.art ?? null,
    })),
    playTogether: playTogether.map((c) => {
      const meta = metaOf(c.appid)
      return {
        ...c,
        art: meta?.art ?? null,
        // Только показываем то, что уже замерено: за свежими ценами сюда не
        // ходим — страница открывается по ссылке и без входа в подбор.
        // И только там, где кому-то придётся покупать: у общей игры цены нет.
        discount: meta && !c.ownedByAll ? discountView(meta, nowSec()) : null,
      }
    }),
    myName: nameOf(me, myName),
    otherName: nameOf(otherRaw, otherName),
    mySteamid: me,
  })
}
