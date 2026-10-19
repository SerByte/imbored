import { NextResponse } from 'next/server'
import { memberDone, memberLabel } from '@/lib/room'
import { getGamesMetaLite, getRoom, roomMembers, roomVotes } from '@/lib/db'
import { localeFromRequest } from '@/lib/i18n'
import { checkRate, personalRateId, rateLimitedResponse } from '@/lib/ratelimit'
import { buildLikes, pickLeader, type LeaderOffer } from '@/lib/roomlikes'
import { currentSession, getDb, isWriter, nowSec } from '@/lib/server'
import { peekGate } from '@/lib/roompeek'
import { seatOf, seatRefusal } from '@/lib/roomseat'

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
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const session = await currentSession()
  if (!session) return NextResponse.json({ error: 'nosession' }, { status: 401 })
  const { steamid } = session
  const writer = isWriter(session)

  const db = await getDb()
  const [room, members] = await Promise.all([getRoom(db, id), roomMembers(db, id)])
  // «Твои играем» — по именам игр, то есть чужие голоса для того, кто взял
  // ссылку на профиль участника, вошедшего через Steam (lib/roomseat)
  const seat = seatOf(members, steamid, writer)
  // Не-участник платит потолком просмотра (lib/roompeek): иначе этот роут —
  // открытая проверка, существует ли комната с таким кодом
  if (seat !== 'member') {
    const refused = await peekGate(db, req)
    if (refused) return refused
  }
  if (!room) return NextResponse.json({ error: 'notfound' }, { status: 404 })

  const refusal = seatRefusal(seat)
  if (refusal) return refusal

  // Счёт по сессии, а не по профилю: почему и почему без потолка адреса —
  // lib/roomseat
  const gate = await checkRate(db, {
    bucket: 'room-likes',
    id: personalRateId(session, writer),
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
      // Имена «почти совпали» — на языке страницы (withLang): «Demo friend»,
      // «Player ab12»
      name: memberLabel(id, m.steamid, m.personaName, localeFromRequest(req)),
    })),
    me: steamid,
    // Только расклады, где ты уже «за», — почему, см. ниже и lib/roomlikes
    onlyMine: true,
  })

  // Лидер голосов — только когда все отсвайпали (см. pickLeader): тогда
  // портить уже нечего, а наружу идёт один счёт без имён
  const leader = pickLeader({ votes, members, deckSize: room.deckSize })

  // Мета лидера — тем же заходом, что и своих лайков
  const metas = await getGamesMetaLite(db, leader ? [...mineAppids, leader.appid] : mineAppids)
  const view = (appid: number) => {
    const meta = metas.get(appid)
    return {
      appid,
      name: meta?.name ?? `#${appid}`,
      headerImage: meta?.headerImage ?? null,
      art: meta?.art ?? null,
    }
  }
  const mine = mineAppids.map(view)
  const offer: LeaderOffer | null = leader ? { ...leader, ...view(leader.appid) } : null

  /*
   * «Вы почти совпали» — только тому, кто сам дошёл до конца колоды.
   *
   * Названий в near нет (lib/roomlikes.ts), но одного этого мало: блок
   * группирует карты по раскладу «кто за, кого ждём», а свой голос смотрящего
   * этот расклад двигает. «Нет» на карту, перечитать, сравнить счёт игр — и
   * за два десятка кругов видно, кто за какую игру, незнакомцу с доски в том
   * числе. Дошедший до конца свои голоса уже отдал, а отданный голос не
   * меняется (castDeckVote), — двигать расклад ему нечем.
   *
   * Честный экран этого не замечает: /likes зовут, когда рука пуста (экран
   * ожидания), то есть когда колода и так пройдена. memberDone — то же
   * определение «дошёл», что у ростера и у лидера голосов.
   *
   * И одного «дошёл» мало: оно считает свои голоса против размера последней
   * колоды, а колоду пересобирают при входе нового человека. Отсвайпавший
   * первую остаётся «дошедшим» с новыми картами на руках, и каждая — снова
   * зонд. Его закрывает onlyMine выше: расклады «ждём тебя» не приходят
   * вовсе, а у своих раскладов «нет» на чужую карту ничего не двигает. Заодно
   * ушло «ждём тебя» про карты, которых у человека в руке уже нет.
   */
  const myVotes = votes.filter((v) => v.steamid === steamid).length
  const nearShown = memberDone(myVotes, room.deckSize) ? near : []

  // near уходит без appid и названий — см. lib/roomlikes.ts
  return NextResponse.json({ mine, near: nearShown, leader: offer, memberCount: members.length })
}
