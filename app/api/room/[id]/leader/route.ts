import { NextResponse } from 'next/server'
import { getRoom, roomMembers, roomVotes, setRoomMatched } from '@/lib/db'
import { checkRate, personalRateId, rateLimitedResponse } from '@/lib/ratelimit'
import { pickLeader } from '@/lib/roomlikes'
import { currentSession, getDb, isWriter, nowSec } from '@/lib/server'
import { readJsonObject } from '@/lib/reqbody'
import { forgetRoomCard } from '@/lib/roomcard'
import { peekGate } from '@/lib/roompeek'
import { seatOf, seatRefusal } from '@/lib/roomseat'

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
 * Сессии по ссылке — можно, за своё членство: это голос внутри комнаты, и
 * так же открыты join и vote. Но не за участника, который сам вошёл через
 * Steam: от его имени действует только пишущая сессия (lib/roomseat).
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

  const session = await currentSession()
  if (!session) return NextResponse.json({ error: 'nosession' }, { status: 401 })
  const writer = isWriter(session)

  const db = await getDb()
  const [room, members] = await Promise.all([getRoom(db, id), roomMembers(db, id)])
  const seat = seatOf(members, session.steamid, writer)
  // Не-участник платит потолком просмотра (lib/roompeek): иначе этот роут —
  // открытая проверка, существует ли комната с таким кодом
  if (seat !== 'member') {
    const refused = await peekGate(db, req)
    if (refused) return refused
  }
  if (!room) return NextResponse.json({ error: 'notfound' }, { status: 404 })

  // Матч терминален: второй раз договариваться не о чем. matched — чтобы
  // экран, чей опрос его ещё не увидел, сразу показал церемонию.
  if (room.status !== 'open') {
    return NextResponse.json(
      { error: 'matched', matched: room.matchedAppid ?? null },
      { status: 409 },
    )
  }

  const refusal = seatRefusal(seat)
  if (refusal) return refusal

  // Счёт по сессии, а не по профилю: почему и почему без потолка адреса —
  // lib/roomseat
  const gate = await checkRate(db, {
    bucket: 'room-leader',
    id: personalRateId(session, writer),
    limit: LEADER_LIMIT,
    windowSec: LEADER_WINDOW_SEC,
    nowSec: nowSec(),
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  const body = (await readJsonObject(req)) as { appid?: unknown }
  const appid = Number(body.appid)
  if (!Number.isSafeInteger(appid) || Math.abs(appid) >= APPID_BOUND) {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }

  const leader = pickLeader({ votes: await roomVotes(db, id), members, deckSize: room.deckSize })
  if (!leader || leader.appid !== appid) {
    return NextResponse.json({ error: 'noleader' }, { status: 409 })
  }

  const matched = await setRoomMatched(db, id, appid)
  // Комната сошлась — билет-приглашение в кэше карточки устарел (lib/roomcard)
  if (matched !== null) forgetRoomCard(id)
  return NextResponse.json({ matched })
}
