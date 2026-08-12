import { NextResponse } from 'next/server'
import { bannedAppids, getAllGamesMeta, getLatestSnapshot, listFeedback } from '@/lib/db'
import { claudePicks, heuristicPicks } from '@/lib/llm'
import { parseMood } from '@/lib/mood'
import {
  applyFeedbackToProfile,
  buildTagProfile,
  explainMatch,
  scoreCandidates,
} from '@/lib/recommend'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import type { GameMeta } from '@/lib/types'

export async function POST(req: Request) {
  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { mood?: unknown }
  const mood = parseMood(body.mood)
  if (!mood) return NextResponse.json({ error: 'badmood' }, { status: 400 })

  const db = await getDb()
  const now = nowSec()
  const snapshot = await getLatestSnapshot(db, steamid)
  if (!snapshot) return NextResponse.json({ error: 'nolibrary' }, { status: 409 })

  const games = snapshot.games
  const owned = new Set(games.map((g) => g.appid))
  const metas = await getAllGamesMeta(db)
  const metaOf = (appid: number): GameMeta | undefined => metas.get(appid)

  const banned = await bannedAppids(db, steamid)
  const newPool = [...metas.values()].filter(
    (m) => !owned.has(m.appid) && !banned.has(m.appid) && Object.keys(m.tags).length > 0,
  )

  // профиль вкуса с поправкой на историю «зашло»/«не то»
  const feedback = await listFeedback(db, steamid, 300)
  const profile = applyFeedbackToProfile(buildTagProfile(games, metaOf), feedback, metaOf)
  const candidates = scoreCandidates({
    profile,
    library: games,
    metaOf,
    newPool,
    mood,
    nowSec: now,
    limit: 25,
  }).filter((c) => !banned.has(c.appid))

  if (!candidates.length) return NextResponse.json({ error: 'nocandidates' }, { status: 409 })

  const fromClaude = await claudePicks({ candidates, metaOf, library: games, mood })
  const picks = fromClaude ?? heuristicPicks(candidates, metaOf, mood, 5)

  const libByAppid = new Map(games.map((g) => [g.appid, g]))
  const enriched = picks.map((p) => {
    const meta = metaOf(p.appid)
    const lib = libByAppid.get(p.appid)
    const topTags = Object.entries(meta?.tags ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([t]) => t)
    return {
      ...p,
      headerImage:
        meta?.headerImage ??
        (p.appid > 0
          ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${p.appid}/header.jpg`
          : null),
      shortDescription: meta?.shortDescription ?? null,
      tags: topTags,
      hoursPlayed: lib ? Math.round(lib.playtimeForever / 60) : null,
      store: meta?.store ?? null,
      storeUrl: meta?.storeUrl ?? null,
      priceFinal: meta?.priceFinal ?? null,
      signals: meta ? explainMatch(profile, meta, mood) : null,
    }
  })

  return NextResponse.json({
    picks: enriched,
    engine: fromClaude ? 'claude' : 'heuristic',
    candidateCount: candidates.length,
  })
}
