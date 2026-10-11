import { NextResponse } from 'next/server'
import { castDeckVote, findRoomMatch, getRoom, raiseRoomSeat, roomMembers, setRoomMatched } from '@/lib/db'
import { checkRate, personalRateId, rateLimitedResponse } from '@/lib/ratelimit'
import { currentSession, getDb, isWriter, nowSec } from '@/lib/server'
import { readJsonObject } from '@/lib/reqbody'
import { forgetRoomCard } from '@/lib/roomcard'
import { peekGate } from '@/lib/roompeek'
import { seatOf, seatRefusal, seatToRaise } from '@/lib/roomseat'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

/**
 * Предел appid. Отрицательные у нас свои (кураторский пул вне Steam, см.
 * lib/otherstores), а целое за пределами 32 бит — это уже не игра, а мусор,
 * который до выборки из room_deck пускать незачем.
 */
const APPID_BOUND = 2 ** 31

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const session = await currentSession()
  if (!session) return NextResponse.json({ error: 'nosession' }, { status: 401 })
  const { steamid } = session
  const writer = isWriter(session)

  const db = await getDb()
  const [room, members] = await Promise.all([getRoom(db, id), roomMembers(db, id)])
  // Голосует участник — и только тот, от чьего имени сессия вправе действовать
  // (lib/roomseat): чужая ссылка на профиль вошедшего через Steam за него не
  // голосует, ни добирая единогласие до матча, ни «нет» на чужую любимую игру
  const seat = seatOf(members, steamid, writer)
  // Не-участник платит потолком просмотра (lib/roompeek): иначе этот роут —
  // открытая проверка, существует ли комната с таким кодом
  if (seat !== 'member') {
    const refused = await peekGate(db, req)
    if (refused) return refused
  }
  if (!room) return NextResponse.json({ error: 'notfound' }, { status: 404 })

  // Матч терминален (см. setRoomMatched): голос после него уже ничего не
  // решает, а запись шла — и в сматченную комнату тоже, без края. matched в
  // ответе — чтобы экран, чей опрос ещё не увидел матч, сразу его показал.
  if (room.status !== 'open') {
    return NextResponse.json(
      { error: 'matched', matched: room.matchedAppid ?? null },
      { status: 409 },
    )
  }

  const refusal = seatRefusal(seat)
  if (refusal) return refusal

  // Свайп — самая частая запись в приложении. Сто двадцать в минуту это
  // вдвое быстрее самого быстрого живого свайпа. Счёт — по сессии, а не по
  // профилю: почему и почему без потолка адреса — lib/roomseat
  const gate = await checkRate(db, {
    bucket: 'room-vote',
    id: personalRateId(session, writer),
    limit: 120,
    windowSec: 60,
    nowSec: nowSec(),
  })
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  const body = (await readJsonObject(req)) as { appid?: number; vote?: boolean }
  const appid = Number(body.appid)
  if (
    !Number.isSafeInteger(appid) ||
    Math.abs(appid) >= APPID_BOUND ||
    typeof body.vote !== 'boolean'
  ) {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }

  // Обычно членство поднимает колода (deck/route.ts). Но вошедший по ссылке
  // мог войти через Steam в соседней вкладке и свайпать дальше уже
  // разданную: кука общая, колоду никто не перечитал. Тогда — здесь, однажды
  // (lib/roomseat)
  if (seatToRaise(members, steamid, writer)) await raiseRoomSeat(db, id, steamid)

  // Голос — только за карту, которую комнате раздали. Лимит выше держит
  // скорость, а не объём: без этой проверки участник публичной комнаты
  // набивал room_votes любыми appid, и каждый опрос каждого участника
  // перечитывал их все. legacy — см. castDeckVote.
  const accepted = await castDeckVote(
    db,
    {
      roomId: id,
      steamid,
      appid,
      vote: body.vote ? 1 : 0,
      legacy: room.deckSize !== null && room.deckSize > 0,
    },
    nowSec(),
  )
  if (!accepted) return NextResponse.json({ error: 'notindeck' }, { status: 409 })

  // Клиенту уходит то, что записано в комнате, а не свой кандидат: при двух
  // завершающих голосах в одну секунду кандидаты у запросов разные, и экран,
  // получивший проигравший, показал бы не ту игру и остановил опрос.
  let matched: number | null = null
  const candidate = await findRoomMatch(db, id)
  if (candidate !== null) matched = await setRoomMatched(db, id, candidate)
  // Комната сошлась — билет-приглашение в кэше карточки устарел (lib/roomcard)
  if (matched !== null) forgetRoomCard(id)

  return NextResponse.json({ matched })
}
