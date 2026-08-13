import { NextResponse } from 'next/server'
import {
  bannedAppids,
  countIngest,
  getGamesMeta,
  getLatestSnapshot,
  listFeedback,
  loadTagStats,
} from '@/lib/db'
import { claudePicks, heuristicPicks } from '@/lib/llm'
import { parseMood } from '@/lib/mood'
import { fetchDiscoveryPool, pickQueryTags, rotationSlot } from '@/lib/pool'
import {
  applyFeedbackToProfile,
  buildTagProfile,
  explainMatch,
  scoreCandidates,
  splitBySource,
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

  const banned = await bannedAppids(db, steamid)
  const feedback = await listFeedback(db, steamid, 300)

  // Метаданные своей библиотеки И игр из истории оценок: раньше здесь читался
  // весь каталог, что на сотне тысяч игр сожгло бы лимит прочитанных строк
  // Turso. Игры из фидбека нужны здесь же — иначе оценка игры, которой нет
  // в библиотеке, перестанет влиять на профиль вкуса.
  const libMetas = await getGamesMeta(db, [
    ...new Set([...games.map((g) => g.appid), ...feedback.map((f) => f.appid)]),
  ])
  const poolByAppid = new Map<number, GameMeta>()
  const metaOf = (appid: number): GameMeta | undefined =>
    libMetas.get(appid) ?? poolByAppid.get(appid)

  // профиль вкуса с поправкой на историю «зашло»/«не то»
  const profile = applyFeedbackToProfile(
    buildTagProfile(games, (id) => libMetas.get(id)),
    feedback,
    metaOf,
  )

  // Кандидаты из большого каталога — одним запросом с LIMIT, а не полным сканом
  const [tagStats, catalogSize] = await Promise.all([loadTagStats(db), countIngest(db)])
  const newPool = (
    await fetchDiscoveryPool(db, {
      tags: pickQueryTags(profile, tagStats, catalogSize),
      bannedAppids: [...banned],
      requireMultiplayer: mood.social === 'friends',
      rotation: rotationSlot(steamid, now),
      limit: 400,
    })
  ).filter((m) => !owned.has(m.appid))
  for (const m of newPool) poolByAppid.set(m.appid, m)
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

  // Своё и «нет в библиотеке» — разные разговоры, поэтому и разные блоки.
  // В Claude уходят только свои игры: промпт дешевле, и модель перестаёт
  // смешивать «купи новое» с «поиграй в то, что уже есть».
  const { own, discovery } = splitBySource(candidates)
  const fromClaude = own.length
    ? await claudePicks({ candidates: own, metaOf, library: games, mood })
    : null
  const picks = fromClaude ?? heuristicPicks(own.length ? own : candidates, metaOf, mood, 5)
  const discoveries = heuristicPicks(discovery, metaOf, mood, 6)

  const libByAppid = new Map(games.map((g) => [g.appid, g]))
  const enrich = (p: { appid: number; name: string; reason: string; source: string }) => {
    const meta = metaOf(p.appid)
    const lib = libByAppid.get(p.appid)
    const topTags = Object.entries(meta?.tags ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([t]) => t)
    return {
      ...p,
      headerImage: meta?.headerImage ?? null,
      art: meta?.art ?? null,
      shortDescription: meta?.shortDescription ?? null,
      tags: topTags,
      hoursPlayed: lib ? Math.round(lib.playtimeForever / 60) : null,
      store: meta?.store ?? null,
      storeUrl: meta?.storeUrl ?? null,
      priceFinal: meta?.priceFinal ?? null,
      signals: meta ? explainMatch(profile, meta, mood) : null,
    }
  }

  return NextResponse.json({
    picks: picks.map(enrich),
    discoveries: discoveries.map(enrich),
    engine: fromClaude ? 'claude' : 'heuristic',
    candidateCount: candidates.length,
  })
}
