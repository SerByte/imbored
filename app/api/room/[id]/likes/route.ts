import { NextResponse } from 'next/server'
import { memberLabel } from '@/lib/room'
import { getGamesMeta, getRoom, roomMembers, roomVotes } from '@/lib/db'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { buildLikes } from '@/lib/roomlikes'
import { currentSteamId, getDb, nowSec } from '@/lib/server'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

/**
 * Сорок на пять минут — вдвое выше того, что может выдать честный клиент.
 *
 * Клиент дёргает этот роут не чаще раза в LIKES_MIN_GAP_MS (12 секунд, см.
 * докблок в app/room/[id]/page.tsx), то есть максимум двадцать пять раз за
 * окно. Потолок стоит выше с запасом: он тут не чтобы формировать поведение
 * страницы, а чтобы у роута вообще был край — до этого его не было ни одного,
 * при стоимости захода в roomVotes по всей комнате плюс getGamesMeta.
 */
const LIKES_LIMIT = 40
const LIKES_WINDOW_SEC = 300

/**
 * Что ты уже навыбирал и насколько вы близки.
 *
 * Намеренно НЕ в опросе комнаты: перебор голосов плюс метаданные игр каждые
 * 2.5 секунды у каждого участника — ровно та стоимость, от которой мы только
 * что избавились в самом опросе. Клиент дёргает этот роут разово при входе в
 * ожидание и потом лишь тогда, когда по опросу видно, что чьи-то голоса
 * сдвинулись. Пока пати не двигается — ноль запросов.
 */
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

  const gate = await checkRate(db, {
    bucket: 'room-likes',
    id: steamid,
    limit: LIKES_LIMIT,
    windowSec: LIKES_WINDOW_SEC,
    nowSec: nowSec(),
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  const votes = await roomVotes(db, id)
  const { mineAppids, near } = buildLikes({
    votes,
    members: members.map((m) => ({
      steamid: m.steamid,
      name: memberLabel(id, m.steamid, m.personaName),
    })),
    me: steamid,
  })

  const metas = await getGamesMeta(db, mineAppids)
  const mine = mineAppids.map((appid) => {
    const meta = metas.get(appid)
    return {
      appid,
      name: meta?.name ?? `#${appid}`,
      headerImage: meta?.headerImage ?? null,
      art: meta?.art ?? null,
    }
  })

  // near уходит как есть: в нём нет ни appid, ни названий — см. lib/roomlikes.ts
  return NextResponse.json({ mine, near, memberCount: members.length })
}
