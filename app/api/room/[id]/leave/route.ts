import { NextResponse } from 'next/server'
import { hashString } from '@/lib/daily'
import { findRoomMatch, getRoom, removeRoomMember, roomMembers, setRoomMatched } from '@/lib/db'
import { currentSteamId, getDb } from '@/lib/server'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

/**
 * Выйти из пати — или убрать оттуда другого, если ты хост.
 *
 * Один маршрут на оба действия, потому что действие одно и то же: участник
 * перестаёт считаться в знаменателе единогласия. Расходится только право.
 *
 * Зачем понадобилось: DELETE из room_members не существовало во всём
 * репозитории, а findRoomMatch считает знаменатель как COUNT(*) по участникам.
 * Один человек, нажавший «Войти» и закрывший вкладку, делал матч недостижимым
 * НАВСЕГДА — а сам он кнопку нажать уже не может, вкладки-то нет. Поэтому
 * одного «выйти» мало: нужна и рука хоста.
 *
 * Матч пересчитывается сразу. Иначе оставшимся, которые всё отсвайпали, нужно
 * было бы проголосовать ещё раз, чтобы что-то сдвинулось, — а свайпать больше
 * нечего.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const steamid = await currentSteamId()
  if (!steamid) return NextResponse.json({ error: 'nosession' }, { status: 401 })

  const db = await getDb()
  const room = await getRoom(db, id)
  if (!room) return NextResponse.json({ error: 'notfound' }, { status: 404 })

  /*
   * Кого убрать, называют ХЕШЕМ, а не steamid.
   *
   * Наружу steamid не уходит вовсе — это записано в шапке lib/room.ts и
   * держится ради открытых комнат с доски, куда подсаживаются незнакомые.
   * Ростер знает только hashString(roomId + steamid), значит и удаление обязано
   * принимать его же, а сопоставление делать здесь.
   *
   * Заодно это сужает вход: подобранный хеш бесполезен — он сверяется со
   * списком участников ЭТОЙ комнаты, и ничем, кроме удаления из неё, не станет.
   */
  const body = (await req.json().catch(() => ({}))) as { memberId?: unknown }
  const memberId = typeof body.memberId === 'string' ? body.memberId : null

  const members = await roomMembers(db, id)
  const target = memberId
    ? (members.find((m) => hashString(id + m.steamid).toString(36) === memberId)?.steamid ?? null)
    : steamid

  // Такого участника в комнате нет — убирать нечего, и это не ошибка.
  if (!target) {
    return NextResponse.json({ ok: true, removed: false, matched: null, left: members.length })
  }

  // Себя убрать может кто угодно, чужого — только хост. Право проверяем по
  // room.createdBy, а не по «первый в списке»: список меняется.
  if (target !== steamid && room.createdBy !== steamid) {
    return NextResponse.json({ error: 'nothost' }, { status: 403 })
  }

  // Повторный вызов безобиден: ушедшего уже нет, отвечать ошибкой не за что.
  const removed = await removeRoomMember(db, id, target)

  let matched = room.status === 'matched' ? (room.matchedAppid ?? null) : null
  if (removed && room.status === 'open') {
    matched = await findRoomMatch(db, id)
    if (matched !== null) await setRoomMatched(db, id, matched)
  }

  return NextResponse.json({
    ok: true,
    removed,
    matched,
    left: removed ? members.length - 1 : members.length,
  })
}
