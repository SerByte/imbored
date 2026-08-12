import { NextResponse } from 'next/server'
import { pickDaily } from '@/lib/daily'
import { bannedAppids, getAllGamesMeta, getLatestSnapshot, listFeedback } from '@/lib/db'
import { heuristicPicks } from '@/lib/llm'
import {
  applyFeedbackToProfile,
  buildTagProfile,
  scoreCandidates,
} from '@/lib/recommend'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import type { GameMeta, Mood } from '@/lib/types'

const DAILY_MOOD: Mood = { time: 'medium', vibe: 'chill', social: 'solo' }

export async function GET() {
  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  const now = nowSec()
  const snapshot = await getLatestSnapshot(db, steamid)
  if (!snapshot) return NextResponse.json({ error: 'nolibrary' }, { status: 409 })

  const games = snapshot.games
  const owned = new Set(games.map((g) => g.appid))
  const metas = await getAllGamesMeta(db)
  const metaOf = (appid: number): GameMeta | undefined => metas.get(appid)
  const banned = await bannedAppids(db, steamid)

  const feedback = await listFeedback(db, steamid, 300)
  const profile = applyFeedbackToProfile(buildTagProfile(games, metaOf), feedback, metaOf)
  const candidates = scoreCandidates({
    profile,
    library: games,
    metaOf,
    newPool: [...metas.values()].filter(
      (m) => !owned.has(m.appid) && !banned.has(m.appid) && Object.keys(m.tags).length > 0,
    ),
    mood: DAILY_MOOD,
    nowSec: now,
    limit: 25,
  }).filter((c) => !banned.has(c.appid))

  if (!candidates.length) return NextResponse.json({ error: 'nocandidates' }, { status: 409 })

  // игра дня — в первую очередь про разгребание своего: бэклог и заброшенное
  const own = candidates.filter((c) => c.source !== 'new')
  const pool = own.length >= 5 ? own : candidates

  const dateStr = new Date().toISOString().slice(0, 10)
  const pick = pickDaily(pool, `${steamid}:${dateStr}`)!
  const reason = heuristicPicks([pick], metaOf, DAILY_MOOD, 1)[0]?.reason ?? ''

  const meta = metaOf(pick.appid)
  const lib = games.find((g) => g.appid === pick.appid)
  const topTags = Object.entries(meta?.tags ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([t]) => t)

  return NextResponse.json({
    pick: {
      ...pick,
      reason,
      headerImage:
        meta?.headerImage ??
        (pick.appid > 0
          ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${pick.appid}/header.jpg`
          : null),
      tags: topTags,
      hoursPlayed: lib ? Math.round(lib.playtimeForever / 60) : null,
      store: meta?.store ?? null,
      storeUrl: meta?.storeUrl ?? null,
    },
    dateLabel: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
  })
}
