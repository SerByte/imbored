import { NextResponse } from 'next/server'
import { memberDone, memberLabel, missingNames } from '@/lib/room'
import { memberKey } from '@/lib/roomkey'
import {
  getGameMeta,
  getGamesMetaLite,
  getRoom,
  roomForCount,
  roomMembers,
  roomVoteCounts,
  snapshotOwns,
} from '@/lib/db'
import { isDemoId } from '@/lib/demoid'
import { discountView, trustedPrice } from '@/lib/discount'
import { logSwallowed } from '@/lib/errlog'
import { localeFromRequest } from '@/lib/i18n'
import { parseMood } from '@/lib/mood'
import { inviteDoor, type InviteDoor } from '@/lib/roominvite'
import { PEEK_LIMIT, PEEK_WINDOW_SEC } from '@/lib/roompeek'
import { seatOf } from '@/lib/roomseat'
import { checkRate, clientIp, rateLimitedResponse } from '@/lib/ratelimit'
import { currentSession, getDb, isWriter, nowSec, sessionSecret } from '@/lib/server'

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
// Числа общие для всех роутов комнаты — lib/roompeek

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!ROOM_ID_RE.test(id)) return NextResponse.json({ error: 'badroom' }, { status: 404 })
  // Язык страницы, которая опрашивает (withLang): ростер, экран приглашения и
  // срок скидки — подписи для человека. Без ?lang= ответ русский, как был
  const locale = localeFromRequest(req)

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
  const [room, session, members, counts] = await Promise.all([
    getRoom(db, id),
    currentSession(),
    roomMembers(db, id),
    roomVoteCounts(db, id),
  ])
  const steamid = session?.steamid ?? null
  /*
   * Участник — тот, от чьего имени эта сессия вправе действовать (lib/roomseat).
   * Ссылка на профиль того, кто сам вошёл через Steam, видит комнату как
   * не-участник: роуты участника ей всё равно откажут needsteam, а экран
   * колоды, где каждый жест отказывает, хуже честного «войди через Steam».
   * needSteam говорит странице, почему «Войти в комнату» здесь не поможет.
   */
  const seat = session ? seatOf(members, session.steamid, isWriter(session)) : 'none'
  const isMember = seat === 'member'

  /*
   * Кому экран приглашения (inviteDoor ниже) — решается уже здесь, чтобы
   * мета игры, в которую звали, читалась ВМЕСТЕ с потолком room-peek, а не
   * после него. Её платит каждый опрос не-участника открытой комнаты с
   * затравкой — раз в 2,5 секунды, в тишине раз в 6, — и последовательным
   * она добавляла бы ему ещё один поход в Turso (см. «одним заходом» выше).
   * Цена параллельности — одно узкое чтение у запроса, которому потолок
   * откажет, и его не бывает у перебора: несуществующая комната не открыта.
   *
   * Чтение украшающее и потому не роковое: упало — экран без картинки игры,
   * а не 500 на весь опрос, после которого гость видел бы «Связь потеряна»
   * вместо приглашения.
   */
  const door = !isMember && seat !== 'needsteam' && room?.status === 'open'
  const seedAppid = door ? room.seedAppid : undefined
  const seedRead =
    seedAppid !== undefined
      ? getGamesMetaLite(db, [seedAppid])
          .then((metas) => metas.get(seedAppid))
          .catch((err: unknown) => {
            logSwallowed('room:door-seed', err)
            return undefined
          })
      : undefined

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
  //
  // Владение — у КАЖДОГО участника, а не только у смотрящего: экран матча
  // говорит всей комнате «Нет у: Дима, Саша» (missingNames в lib/room), а
  // не одному Диме «у тебя её нет». По точечному чтению на участника, их не
  // больше восьми (ROOM_MAX_MEMBERS), и платит за это не опрос: на матче он
  // останавливается (nextPollStep в lib/roompoll), так что это один заход на
  // загрузку страницы. Своё владение берётся из того же ответа.
  const matchedAppid = room.status === 'matched' ? room.matchedAppid : undefined
  const [matchedMeta, owns, forCount] =
    matchedAppid !== undefined
      ? await Promise.all([
          getGameMeta(db, matchedAppid),
          isMember && matchedAppid > 0
            ? Promise.all(members.map((m) => snapshotOwns(db, m.steamid, matchedAppid)))
            : null,
          isMember ? roomForCount(db, id, matchedAppid) : null,
        ])
      : [null, null, null]
  const mine = members.findIndex((m) => m.steamid === steamid)
  const ownedByMe = owns && mine >= 0 ? owns[mine] : null
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
      name: memberLabel(id, m.steamid, m.personaName, locale),
      // «(ты)» — у того, за кого сессия действует; не-участнику по чужой
      // ссылке чужая строка своей не становится
      me: isMember && m.steamid === steamid,
      votes,
      // То же определение, по которому предлагается лидер голосов (memberDone)
      done: memberDone(votes, room.deckSize),
    }
  })

  /*
   * Экран приглашения — тем же языком, что карточка в чате (inviteDoor в
   * lib/roominvite): кто зовёт, кто уже здесь и игра, в которую звали.
   *
   * Только не-участнику открытой комнаты: участнику это его шапка и ростер,
   * а после матча не-участнику показывают, на чём сошлись. И не сессии по
   * ссылке на профиль, который уже сидит здесь (needSteam): это не
   * приглашение, а «войди через Steam и здесь», и «Серёга зовёт» вышло бы
   * самому Серёге. Опрос участников — горячий путь — не платит ничего: мета
   * игры читается только для этого экрана (door выше), вместе с потолком
   * room-peek, который этот путь и закрывает.
   *
   * Ник хоста — personaName, как у превью (loadRoomInvite), а «Уже здесь» —
   * метками ростера: те же имена, что человек увидит, войдя. Ни steamid, ни
   * ключей участников в строки не попадает. Участнику поля нет вовсе, а не
   * null: его ответ — опрос раз в 2,5 секунды, и он остаётся прежним до байта.
   */
  let invite: InviteDoor | null = null
  if (door) {
    const seed = await seedRead
    const host = members.find((m) => m.steamid === room.createdBy)
    const hostFirst = host ? [host, ...members.filter((m) => m !== host)] : members
    // Демо-хост — признаком, не steamid: на /en его русская подпись
    // становится «Demo player», тем же словом, что в «Уже здесь» (memberLabel)
    invite = inviteDoor(
      {
        host: host?.personaName ?? null,
        hostDemo: host ? isDemoId(host.steamid) : false,
        names: hostFirst.map((m) => memberLabel(id, m.steamid, m.personaName, locale)),
        seed: seed
          ? { appid: seed.appid, name: seed.name, headerImage: seed.headerImage ?? null, art: seed.art ?? null }
          : null,
      },
      locale,
    )
  }

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
    needSteam: seat === 'needsteam',
    ...(invite ? { invite } : {}),
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
          // Кому из остальных её не хватает — метками ростера и колоды
          // (memberLabel), не steamid. Не участнику — null: у кого в чужой
          // пати чего нет, открытая ссылка не раздаёт — как и счёт голосов
          missingFor: isMember
            ? missingNames(
                memberViews.map((v, i) => ({ label: v.name, owns: owns?.[i] ?? null, me: v.me })),
              )
            : null,
          // Цена — тому, кому покупать: те же правила, что у колоды (trustedPrice,
          // «бесплатно» сильнее цены)
          isFree: matchedMeta.isFree === true,
          priceFinal: matchedMeta.isFree ? null : trustedPrice(matchedMeta, now),
          priceCc: matchedMeta.priceCc ?? null,
          // и у бесплатной: взять её в магазине региона нельзя всё равно, а
          // рядом с isFree ответ выбирает PriceTag — «не продаётся» первым
          unsold: matchedMeta.storeHidden === true,
          discount: matchedMeta.isFree ? null : discountView(matchedMeta, now, { locale }),
        }
      : null,
    now,
  })
}
