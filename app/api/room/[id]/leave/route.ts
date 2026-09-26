import { NextResponse } from 'next/server'
import { findRoomMatch, getRoom, removeRoomMember, roomMembers, setRoomMatched } from '@/lib/db'
import { memberKey } from '@/lib/roomkey'
import { currentSteamId, getDb, sessionSecret } from '@/lib/server'
import { readJsonObject } from '@/lib/reqbody'
import { peekGate } from '@/lib/roompeek'

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
  const [room, members] = await Promise.all([getRoom(db, id), roomMembers(db, id)])
  // Не-участник платит потолком просмотра (lib/roompeek): иначе этот роут —
  // открытая проверка, существует ли комната с таким кодом
  if (!members.some((m) => m.steamid === steamid)) {
    const refused = await peekGate(db, req)
    if (refused) return refused
  }
  if (!room) return NextResponse.json({ error: 'notfound' }, { status: 404 })

  /*
   * Кого убрать, называют КЛЮЧОМ, а не steamid.
   *
   * Наружу steamid не уходит вовсе — это записано в шапке lib/room.ts и
   * держится ради открытых комнат с доски, куда подсаживаются незнакомые.
   * Ростер знает только memberKey (lib/roomkey), значит и удаление обязано
   * принимать его же, а сопоставление делать здесь.
   *
   * Заодно это сужает вход: подобранный ключ бесполезен — он сверяется со
   * списком участников ЭТОЙ комнаты, и ничем, кроме удаления из неё, не станет.
   */
  const body = (await readJsonObject(req)) as { memberId?: unknown }
  const memberId = typeof body.memberId === 'string' ? body.memberId : null

  const secret = sessionSecret()
  const target = memberId
    ? (members.find((m) => memberKey(secret, id, m.steamid) === memberId)?.steamid ?? null)
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
    // Как и в голосовании: наружу — записанный матч, а не свой кандидат.
    const candidate = await findRoomMatch(db, id)
    if (candidate !== null) matched = await setRoomMatched(db, id, candidate)
  }

  return NextResponse.json({
    ok: true,
    removed,
    matched,
    left: removed ? members.length - 1 : members.length,
  })
}
