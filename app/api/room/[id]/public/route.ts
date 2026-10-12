import { NextResponse } from 'next/server'
import { getRoom, setRoomPublic } from '@/lib/db'
import { checkRatesInOrder, clientIp, rateLimitedResponse } from '@/lib/ratelimit'
import { getDb, nowSec, requireWriter } from '@/lib/server'
import { readJsonObject } from '@/lib/reqbody'
import { peekGate } from '@/lib/roompeek'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

/*
 * Потолки переключателя «На доску».
 *
 * Каждое нажатие было записью в rooms без всякого края, а хостом бывает и
 * демо-личность, которую демо-вход выдаёт даром: один скрипт крутил бы
 * тумблер своей комнаты, пока Turso не выставит счёт. Повтор того же значения
 * строку больше не пишет (setRoomPublic), но «вывесить — снять» по кругу
 * пишет каждый раз — край нужен. Двадцать за десять минут — с большим запасом
 * на «вывесил, передумал, снова вывесил» и двойной тап; живой хост жмёт это
 * раз-другой за вечер. Отказ страница показывает своей строкой — «подожди
 * несколько минут», а не «проверь связь и нажми ещё раз»: повтор упёрся бы в
 * тот же потолок (publicFailure в lib/room).
 *
 * Личный — по steamid: requireWriter выше пускает только пишущую сессию, а у
 * неё личный id и есть steamid (personalRateId). Второй — по адресу: личный
 * держит одну личность, а демо-вход чеканит их даром, и у каждой может быть
 * своя комната. В отличие от прочих потолков комнаты (lib/roomseat), адрес
 * здесь своим не мешает: переключатель только у хоста и жмётся редко, так что
 * компания в одной квартире в него не упрётся. Втрое выше личного, как у
 * /api/pick; личный первым — отказ по нему не съедает потолок адреса.
 */
const PUBLIC_LIMIT = 20
const PUBLIC_IP_LIMIT = 60
const PUBLIC_WINDOW_SEC = 600

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  // Вывесить комнату на доску — значит показать ник хоста всем на /rooms
  const writer = await requireWriter()
  if (!writer.ok) return writer.response
  const { steamid } = writer

  const db = await getDb()
  const room = await getRoom(db, id)
  // Не хост платит потолком просмотра (lib/roompeek): иначе 404 против 403 —
  // открытая проверка, существует ли комната с таким кодом
  if (room?.createdBy !== steamid) {
    const refused = await peekGate(db, req)
    if (refused) return refused
  }
  if (!room) return NextResponse.json({ error: 'notfound' }, { status: 404 })
  if (room.createdBy !== steamid) return NextResponse.json({ error: 'nothost' }, { status: 403 })

  const body = (await readJsonObject(req)) as { public?: boolean }
  if (typeof body.public !== 'boolean') {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }

  // После проверки хоста: чужой платит потолком просмотра выше, а хозяйский
  // потолок тратит только сам хост
  const gate = await checkRatesInOrder(
    db,
    [
      { bucket: 'room-public', id: steamid, limit: PUBLIC_LIMIT, windowSec: PUBLIC_WINDOW_SEC },
      { bucket: 'room-public-ip', id: clientIp(req.headers), limit: PUBLIC_IP_LIMIT, windowSec: PUBLIC_WINDOW_SEC },
    ],
    nowSec(),
  )
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  await setRoomPublic(db, id, body.public)
  return NextResponse.json({ ok: true, isPublic: body.public })
}
