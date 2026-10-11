import { NextResponse } from 'next/server'
import {
  findRoomMatch,
  getRoom,
  liftRoomKick,
  removeRoomMember,
  roomKickedSince,
  roomMembers,
  setRoomMatched,
} from '@/lib/db'
import { ROOM_KICK_SEC } from '@/lib/room'
import { memberKey } from '@/lib/roomkey'
import { currentSession, getDb, isWriter, nowSec, sessionSecret } from '@/lib/server'
import { readJsonObject } from '@/lib/reqbody'
import { peekGate } from '@/lib/roompeek'
import { seatOf } from '@/lib/roomseat'

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
 *
 * Убранный хостом не входит обратно ROOM_KICK_SEC (lib/room): иначе рука
 * хоста действовала только на ушедшего в AFK, а тролль с доски нажимал
 * «Войти» и снова запирал единогласие. Ушёл хост сам — рука переходит к
 * следующему (removeRoomMember): без неё комната снова запиралась первым же
 * закрывшим вкладку.
 *
 * Третье действие того же маршрута — { unkick: memberId }: хост снимает
 * запрет с того, кого убрал («Пустить обратно» на странице). Полчаса за
 * дверью — цена ✕, и без отмены её платил и друг, по чьей строке хост просто
 * промахнулся.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const session = await currentSession()
  if (!session) return NextResponse.json({ error: 'nosession' }, { status: 401 })
  const { steamid } = session
  const writer = isWriter(session)

  const db = await getDb()
  const [room, members] = await Promise.all([getRoom(db, id), roomMembers(db, id)])
  const seat = seatOf(members, steamid, writer)
  // Не-участник платит потолком просмотра (lib/roompeek): иначе этот роут —
  // открытая проверка, существует ли комната с таким кодом
  if (seat !== 'member') {
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
  const body = (await readJsonObject(req)) as { memberId?: unknown; unkick?: unknown }
  const memberId = typeof body.memberId === 'string' ? body.memberId : null
  const secret = sessionSecret()

  /*
   * «Пустить обратно»: снять запрет на возвращение с убранного.
   *
   * Права — ровно те же, что у самого ✕ (ниже): хост, и со входом через
   * Steam. Убранного в ростере уже нет, поэтому ключ сверяется не с
   * участниками, а с отметками этой комнаты, которые ещё действуют, — тем же
   * memberKey, каким хост его и убирал. Подобранный ключ так же бесполезен:
   * он снимет разве что запрет в этой комнате, и только руками её хоста.
   *
   * Обратно в ростер не сажает: войти — дело самого человека, «Войти в
   * комнату» у него на экране. Голоса его стёрты ещё ✕ (removeRoomMember),
   * и вернуть их нечем.
   */
  if (typeof body.unkick === 'string') {
    if (room.createdBy !== steamid) return NextResponse.json({ error: 'nothost' }, { status: 403 })
    if (!writer) return NextResponse.json({ error: 'needsteam' }, { status: 403 })
    const kicked = await roomKickedSince(db, id, nowSec() - ROOM_KICK_SEC)
    const who = kicked.find((s) => memberKey(secret, id, s) === body.unkick)
    // Отметки нет или срок вышел — снимать нечего, и это не ошибка
    const lifted = who ? await liftRoomKick(db, id, who) : false
    return NextResponse.json({ ok: true, lifted })
  }

  const target = memberId
    ? (members.find((m) => memberKey(secret, id, m.steamid) === memberId)?.steamid ?? null)
    : steamid

  // Такого участника в комнате нет — убирать нечего, и это не ошибка.
  if (!target) {
    return NextResponse.json({ ok: true, removed: false, matched: null, left: members.length })
  }

  // Себя убрать может кто угодно, чужого — только хост. Право проверяем по
  // room.createdBy, а не по «первый в списке»: список меняется.
  const kick = target !== steamid
  if (kick && room.createdBy !== steamid) {
    return NextResponse.json({ error: 'nothost' }, { status: 403 })
  }
  // Убрать другого — управление комнатой, как и вывесить её на доску
  // (public/route.ts), и без доказательства владения не делается. Сессию на
  // профиль хоста /api/connect выдаёт любому, кто знает его ссылку, — и тот
  // убирал бы людей из чужой пати. Хост, создавший комнату, всегда пишущий
  // (create — через requireWriter); отказ видит лишь хост по ссылке — тот,
  // кому рука перешла от ушедшего, или вернувшийся по ссылке, — и страница
  // говорит ему «войди через Steam».
  if (kick && !writer) {
    return NextResponse.json({ error: 'needsteam' }, { status: 403 })
  }
  // Себя — тоже от своего имени: чужая ссылка на профиль участника, который
  // вошёл через Steam, не уводит его из пати вместе со всеми голосами
  // (lib/roomseat). Не-участнику отвечаем как раньше, ниже: убирать нечего.
  if (!kick && seat === 'needsteam') {
    return NextResponse.json({ error: 'needsteam' }, { status: 403 })
  }

  // Повторный вызов безобиден: ушедшего уже нет, отвечать ошибкой не за что.
  // Убранный хостом получает отметку — вернуться сразу он не сможет.
  const removed = await removeRoomMember(db, id, target, kick ? { kickedAt: nowSec() } : {})

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
