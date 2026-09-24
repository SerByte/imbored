import { NextResponse } from 'next/server'
import { getRoom, roomMembers, roomVotes, setRoomMatched } from '@/lib/db'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { pickLeader } from '@/lib/roomlikes'
import { currentSteamId, getDb, nowSec } from '@/lib/server'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

/** Тот же предел appid, что у голоса (см. vote/route.ts) */
const APPID_BOUND = 2 ** 31

/**
 * Жмут это раз за вечер. Десять на пять минут — с запасом на двойной тап и
 * повтор после обрыва сети, но без перебора: каждая попытка перечитывает
 * голоса всей комнаты.
 */
const LEADER_LIMIT = 10
const LEADER_WINDOW_SEC = 300

/**
 * «Берём «X»?» — комната соглашается на лидера голосов, и это матч.
 *
 * Кто может нажать. Любой участник, а не только хост, — по той же причине,
 * по какой «Ещё 20 игр» поднимает раунд любой (round/route.ts): это решение
 * комнаты, а не вкус одного человека. Правило выбирает игру само (все
 * отсвайпали, за неё не меньше половины и не меньше двоих — pickLeader), и
 * кнопка только подтверждает то, что правило уже выбрало. Хост к тому же
 * мог выйти, и тогда тупик остался бы без выхода вовсе.
 *
 * Сессии по ссылке — можно: это голос внутри комнаты, профиль он не трогает
 * (так же открыты join и vote, см. requireWriter в lib/server).
 *
 * Лидер пересчитывается здесь, а не берётся на веру из запроса: клиент
 * присылает, КОГО он видел лидером, и если голоса сдвинулись (кто-то добрал
 * ещё игр — и уже не «все отсвайпали», или вышел участник), ответ 409
 * noleader, и экран перечитывает предложение. Иначе один запрос мог бы
 * назначить комнате любую игру из колоды.
 *
 * Запись — тем же setRoomMatched, что у единогласного матча: он пишет только
 * в открытую комнату и возвращает то, что в ней в итоге оказалось, так что
 * гонка с последним голосом, давшим настоящий матч, решается одинаково.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  const [room, members] = await Promise.all([getRoom(db, id), roomMembers(db, id)])
  if (!room) return NextResponse.json({ error: 'notfound' }, { status: 404 })

  // Матч терминален: второй раз договариваться не о чем. matched — чтобы
  // экран, чей опрос его ещё не увидел, сразу показал церемонию.
  if (room.status !== 'open') {
    return NextResponse.json(
      { error: 'matched', matched: room.matchedAppid ?? null },
      { status: 409 },
    )
  }

  if (!members.some((m) => m.steamid === steamid)) {
    return NextResponse.json({ error: 'notmember' }, { status: 403 })
  }

  const gate = await checkRate(db, {
    bucket: 'room-leader',
    id: steamid,
    limit: LEADER_LIMIT,
    windowSec: LEADER_WINDOW_SEC,
    nowSec: nowSec(),
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  const body = (await req.json().catch(() => ({}))) as { appid?: unknown }
  const appid = Number(body.appid)
  if (!Number.isSafeInteger(appid) || Math.abs(appid) >= APPID_BOUND) {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }

  const leader = pickLeader({ votes: await roomVotes(db, id), members, deckSize: room.deckSize })
  if (!leader || leader.appid !== appid) {
    return NextResponse.json({ error: 'noleader' }, { status: 409 })
  }

  const matched = await setRoomMatched(db, id, appid)
  return NextResponse.json({ matched })
}
