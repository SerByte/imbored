import { NextResponse } from 'next/server'
import { castDeckVote, findRoomMatch, getRoom, roomMembers, setRoomMatched } from '@/lib/db'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { readJsonObject } from '@/lib/reqbody'

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

  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  const room = await getRoom(db, id)
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

  if (!(await roomMembers(db, id)).some((m) => m.steamid === steamid)) {
    return NextResponse.json({ error: 'notmember' }, { status: 403 })
  }

  // Свайп — самая частая запись в приложении. Сто двадцать в минуту это
  // вдвое быстрее самого быстрого живого свайпа.
  const gate = await checkRate(db, {
    bucket: 'room-vote',
    id: steamid,
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

  return NextResponse.json({ matched })
}
