import { NextResponse } from 'next/server'
import { memberDone, memberLabel } from '@/lib/room'
import { memberKey } from '@/lib/roomkey'
import {
  getGameMeta,
  getRoom,
  roomForCount,
  roomMembers,
  roomVoteCounts,
  snapshotOwns,
} from '@/lib/db'
import { discountView, trustedPrice } from '@/lib/discount'
import { parseMood } from '@/lib/mood'
import { checkRate, clientIp, rateLimitedResponse } from '@/lib/ratelimit'
import { currentSteamId, getDb, nowSec, sessionSecret } from '@/lib/server'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

/**
 * Потолок на взгляд снаружи: для всех, кто не участник, — гость без сессии,
 * чужая сессия, перебор кодов. Ключ — адрес: демо-сессия бесплатна, и потолок
 * по steamid перебор обошёл бы сменой куки.
 *
 * Код комнаты — шесть знаков из 31, около 8,9·10^8 вариантов, и больше её
 * ничто не закрывает: ответ несёт ростер с никами и голосами. Без потолка
 * перебор кодов упирался только в скорость клиента.
 *
 * Триста за десять минут, а не шестьдесят, как предлагал аудит: страница
 * приглашения опрашивает комнату и до входа — раз в 2,5 секунды, в тишине
 * раз в 6. Шестьдесят кончились бы у гостя, просто оставившего ссылку
 * открытой, минуты через три, и экран сказал бы «Связь потеряна». Триста —
 * одна вкладка на быстром шаге все десять минут, с запасом на вторую. Перебору
 * это оставляет порядка сорока тысяч кодов в сутки с адреса против 8,9·10^8.
 */
const PEEK_LIMIT = 300
const PEEK_WINDOW_SEC = 600

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })

  const db = await getDb()

  /*
   * Четыре независимых чтения — одним заходом.
   *
   * Это самый частый запрос продукта: он крутится у КАЖДОГО открытого таба
   * раз в 2.5 секунды, то есть на комнате из пятерых это две пары глаз в
   * секунду. Ровно поэтому голоса тут уже сведены в один агрегат вместо
   * запроса на участника — но сами четыре чтения всё равно шли по очереди.
   *
   * Ни одно из них не зависит от результата другого: комнате, составу и
   * агрегату нужен только id, сессии — только кука. Каждый поход в Turso из
   * функции стоит десятки-сотни миллисекунд (замер: маршрут отвечал за 0,6 с
   * при том, что ни один запрос не тяжёлый), и складывались именно они.
   *
   * Цена промаха — три лишних чтения у несуществующей комнаты. В опросе
   * такого не бывает по определению: клиент уже стоит на её странице.
   */
  const [room, steamid, members, counts] = await Promise.all([
    getRoom(db, id),
    currentSteamId(),
    roomMembers(db, id),
    roomVoteCounts(db, id),
  ])
  const isMember = steamid ? members.some((m) => m.steamid === steamid) : false

  // До ответа 404: промах перебора обязан стоить так же, как попадание, иначе
  // потолок считал бы только найденные комнаты. Участников не трогаем — их
  // опрос и есть горячий путь, и он закрыт членством.
  if (!isMember) {
    const gate = await checkRate(db, {
      bucket: 'room-peek',
      id: clientIp(req.headers),
      limit: PEEK_LIMIT,
      windowSec: PEEK_WINDOW_SEC,
      nowSec: nowSec(),
    })
    if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)
  }

  if (!room) return NextResponse.json({ error: 'notfound' }, { status: 404 })

  // Зависит от room.matchedAppid, поэтому остаётся после — и случается редко.
  //
  // Владение — вместе с метой, одним заходом. Матч бывает и на игре, которой
  // у кого-то нет (колода сознательно берёт «не у всех»), а церемония всем
  // показывала «Запустить»: steam://run у не-владельца открывал окно покупки
  // без цены и без объяснения. null — «не знаем»: не участник, нет снапшота
  // или игра другого магазина (отрицательный appid), которой в библиотеке
  // Steam не бывает по определению.
  //
  // Счёт «за» — тем же заходом и только участникам: матч мог быть взят
  // лидером голосов (leader/route.ts), и церемония обязана сказать «3 из 4»,
  // а не «все хотят одного». Чужому, кто зашёл по ссылке, счёт голосов
  // комнаты ни к чему.
  const matchedAppid = room.status === 'matched' ? room.matchedAppid : undefined
  const [matchedMeta, ownedByMe, forCount] =
    matchedAppid !== undefined
      ? await Promise.all([
          getGameMeta(db, matchedAppid),
          steamid && isMember && matchedAppid > 0 ? snapshotOwns(db, steamid, matchedAppid) : null,
          isMember ? roomForCount(db, id, matchedAppid) : null,
        ])
      : [null, null, null]
  const now = nowSec()

  const secret = sessionSecret()
  const memberViews = members.map((m) => {
    const votes = counts.get(m.steamid) ?? 0
    return {
      // Стабильный ключ для React: имена не уникальны — двое зашедших
      // «Демо-другом» получают одинаковое, и строки ростера с анимацией
      // перемешиваются вместе с чужим прогрессом. Ключ, а не сырой steamid:
      // в открытую комнату с доски подсаживаются незнакомые. И ключ с
      // секретом, а не прежний хеш без него — тот обращался перебором, см.
      // lib/roomkey. Им же хост называет, кого убрать (leave/route.ts)
      id: memberKey(secret, id, m.steamid),
      name: memberLabel(id, m.steamid, m.personaName),
      me: m.steamid === steamid,
      votes,
      // То же определение, по которому предлагается лидер голосов (memberDone)
      done: memberDone(votes, room.deckSize),
    }
  })

  return NextResponse.json({
    room: {
      id: room.id,
      status: room.status,
      matchedAppid: room.matchedAppid ?? null,
      isPublic: room.isPublic,
      deckRound: room.deckRound,
      deckSize: room.deckSize,
      // Под какое настроение собрана колода — его выбирал хост, а видеть
      // должны все: без подписи «пара быстрых каток» у пришедшего по ссылке
      // колода из коротких матчей выглядит случайной
      mood: parseMood(room.mood),
    },
    isHost: steamid === room.createdBy,
    members: memberViews,
    hasSession: Boolean(steamid),
    isMember,
    matchedGame: matchedMeta
      ? {
          appid: matchedMeta.appid,
          name: matchedMeta.name,
          headerImage: matchedMeta.headerImage ?? null,
          art: matchedMeta.art ?? null,
          store: matchedMeta.store ?? null,
          storeUrl: matchedMeta.storeUrl ?? null,
          ownedByMe,
          forCount,
          // Цена — тому, кому покупать: те же правила, что у колоды (trustedPrice,
          // «бесплатно» сильнее цены)
          isFree: matchedMeta.isFree === true,
          priceFinal: matchedMeta.isFree ? null : trustedPrice(matchedMeta, now),
          discount: matchedMeta.isFree ? null : discountView(matchedMeta, now),
        }
      : null,
    now,
  })
}
