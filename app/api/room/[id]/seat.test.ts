import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createRoom, getRoom, issueRoomDeck, joinRoom, roomMembers, roomVotes, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, params, post, signIn } from '@/lib/testing/route'
import { GET as deck } from './deck/route'
import { POST as join } from './join/route'
import { POST as leader } from './leader/route'
import { POST as leave } from './leave/route'
import { GET as likes } from './likes/route'
import { POST as round } from './round/route'
import { GET as peek } from './route'
import { GET as trivia } from './trivia/route'
import { POST as vote } from './vote/route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

// Колода освежает цены походом в Steam — в тесте сети нет и не нужно
vi.mock('@/lib/deals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/deals')>()),
  refreshDealsWithin: async () => 0,
}))

/**
 * Кем сессия сидит в комнате (lib/roomseat).
 *
 * Участник комнаты — это steamid, а сессию на любой открытый профиль выдаёт
 * /api/connect без доказательства владения. Пока членство не помнило, КАК оно
 * заведено, сессия по вставленной чужой ссылке была в комнате неотличима от
 * самого человека: читала его «играем», голосовала за него, уводила его из
 * пати, а на профиль хоста — убирала остальных.
 *
 * Теперь членство, заведённое пишущей сессией (вход через Steam или демо),
 * действует только от пишущей сессии. Вход по своей ссылке и голос от неё —
 * как и были: так в пати подключается большинство друзей (README, «Режим
 * пати»).
 */

const ROOM = 'ABC234'
const ALICE = '76561190000000001'
const BOB = '76561190000000002'

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

/** Комната Алисы: она вошла через Steam, Боб — по ссылке, колода [570, 620] */
async function alicesRoom(): Promise<void> {
  const now = nowSec()
  await createRoom(db, { id: ROOM, steamid: ALICE }, now)
  await joinRoom(db, ROOM, ALICE, 'Алиса', now, { writer: true })
  await joinRoom(db, ROOM, BOB, 'Боб', now)
  await issueRoomDeck(db, ROOM, [570, 620])
}

const at = (path: string) => `/api/room/${ROOM}${path}`
const ctx = () => params({ id: ROOM })
const get = (path: string) => new Request(`http://localhost${at(path)}`)

/** Каждый роут участника — тем запросом, каким его зовёт страница */
const memberRoutes: Array<[string, () => Promise<Response>]> = [
  ['vote', () => vote(post(at('/vote'), { appid: 570, vote: true }), ctx())],
  ['likes', () => likes(get('/likes'), ctx())],
  ['leader', () => leader(post(at('/leader'), { appid: 570 }), ctx())],
  ['deck', () => deck(get('/deck'), ctx())],
  ['round', () => round(post(at('/round')), ctx())],
  ['trivia', () => trivia(get('/trivia?round=0'), ctx())],
  ['leave', () => leave(post(at('/leave')), ctx())],
]

describe('чужая ссылка на профиль участника, вошедшего через Steam', () => {
  for (const [name, call] of memberRoutes) {
    test(`/${name} — 403 needsteam, от его имени ничего не происходит`, async () => {
      await alicesRoom()
      await signIn(db, ALICE) // сессия по вставленной ссылке на профиль Алисы
      const res = await call()
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'needsteam' })

      // Алиса на месте, голосов за неё нет, комната та же
      expect((await roomMembers(db, ROOM)).map((m) => m.steamid)).toContain(ALICE)
      expect(await roomVotes(db, ROOM)).toEqual([])
      expect(await getRoom(db, ROOM)).toMatchObject({ status: 'open', deckRound: 0 })
    })
  }

  test('опрос комнаты: такой сессии комната не своя — и она знает, почему', async () => {
    await alicesRoom()
    await signIn(db, ALICE)
    const view = (await (await peek(get(''), ctx())).json()) as {
      isMember: boolean
      needSteam: boolean
      members: Array<{ me: boolean }>
    }
    expect(view.isMember).toBe(false)
    expect(view.needSteam).toBe(true)
    // «(ты)» в ростере — у того, от чьего имени сессия может действовать
    expect(view.members.some((m) => m.me)).toBe(false)
  })

  test('/join поверх такого членства — 403 needsteam, членство не трогается', async () => {
    await alicesRoom()
    const before = (await roomMembers(db, ROOM)).find((m) => m.steamid === ALICE)
    await signIn(db, ALICE)
    const res = await join(post(at('/join')), ctx())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'needsteam' })
    expect((await roomMembers(db, ROOM)).find((m) => m.steamid === ALICE)).toEqual(before)
  })

  test('та же Алиса через Steam — участник, как и была', async () => {
    await alicesRoom()
    await signIn(db, ALICE, { verified: true })
    expect((await vote(post(at('/vote'), { appid: 570, vote: true }), ctx())).status).toBe(200)
    const view = (await (await peek(get(''), ctx())).json()) as { isMember: boolean; needSteam: boolean }
    expect(view).toMatchObject({ isMember: true, needSteam: false })
  })
})

/**
 * Обратная сторона: всё, что было открыто сессии по ссылке, открыто и дальше.
 * Друг, которого позвали в пати, чаще всего подключается своей ссылкой — и с
 * телефона, и с ноутбука, то есть двумя разными сессиями.
 *
 * Отсюда и известный остаток, который тест держит как решение, а не как
 * недосмотр: членство, заведённое по ссылке, не отличает самого человека от
 * чужой ссылки на тот же профиль. Различить их без входа через Steam нечем —
 * привязка к sid заперла бы честного гостя, переподключившегося с другого
 * устройства.
 */
describe('гость по ссылке', () => {
  test('входит, голосует и уходит сам — с любой своей сессии по ссылке', async () => {
    await alicesRoom()
    await signIn(db, BOB)
    expect((await join(post(at('/join')), ctx())).status).toBe(200)
    expect((await vote(post(at('/vote'), { appid: 570, vote: true }), ctx())).status).toBe(200)

    await signIn(db, BOB) // второе устройство, своя сессия по ссылке
    expect((await vote(post(at('/vote'), { appid: 620, vote: false }), ctx())).status).toBe(200)
    expect((await leave(post(at('/leave')), ctx())).status).toBe(200)
    expect((await roomMembers(db, ROOM)).map((m) => m.steamid)).not.toContain(BOB)
  })

  test('вход через Steam поднимает членство: прежняя ссылка дальше — needsteam', async () => {
    await alicesRoom()
    await signIn(db, BOB)
    expect((await join(post(at('/join')), ctx())).status).toBe(200)

    await signIn(db, BOB, { verified: true })
    expect((await join(post(at('/join')), ctx())).status).toBe(200)
    expect((await roomMembers(db, ROOM)).find((m) => m.steamid === BOB)?.writer).toBe(true)

    await signIn(db, BOB)
    const res = await vote(post(at('/vote'), { appid: 570, vote: true }), ctx())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'needsteam' })
  })

  /*
   * Вошёл через Steam не с приглашения, а где-то ещё — со строки на /play.
   * «Войти в комнату» он не нажимал (он и так в ней), и членство оставалось
   * заведённым по ссылке: чужая ссылка на его профиль голосовала бы за него
   * и дальше. Поднимает первый же заход — колода, — а если колода уже на
   * руках, то голос.
   */
  for (const [name, first] of [
    ['колода', () => deck(get('/deck'), ctx())],
    ['голос', () => vote(post(at('/vote'), { appid: 570, vote: true }), ctx())],
  ] as const) {
    test(`вошёл через Steam где-то ещё — членство поднимает ${name} в комнате`, async () => {
      await alicesRoom()
      await signIn(db, BOB)
      expect((await join(post(at('/join')), ctx())).status).toBe(200)

      await signIn(db, BOB, { verified: true })
      expect((await first()).status).toBe(200)
      expect((await roomMembers(db, ROOM)).find((m) => m.steamid === BOB)?.writer).toBe(true)

      await signIn(db, BOB)
      const res = await vote(post(at('/vote'), { appid: 620, vote: true }), ctx())
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'needsteam' })
    })
  }

  test('опрос комнаты членство не поднимает: он только читает', async () => {
    await alicesRoom()
    await signIn(db, BOB)
    expect((await join(post(at('/join')), ctx())).status).toBe(200)

    await signIn(db, BOB, { verified: true })
    expect((await peek(get(''), ctx())).status).toBe(200)
    expect((await roomMembers(db, ROOM)).find((m) => m.steamid === BOB)?.writer).toBe(false)
  })
})

/**
 * Личные потолки комнаты — по сессии, а не по профилю (personalRateId в
 * lib/ratelimit).
 *
 * Чужая ссылка на профиль жертвы сажала её в любую комнату — хоть в свою
 * собственную, собранную с демо, — и там выедала потолки, общие с настоящей
 * жертвой: сто двадцать голосов в минуту, и в своей пати человек свайпал в 429.
 *
 * Часы стоят: окна лимита фиксированные (windowStart в lib/ratelimit), и сто
 * двадцать один голос подряд на живых часах изредка переваливал через край
 * минуты — под нагрузкой полного прогона сто двадцать первый попадал в новое
 * окно и получал 200 вместо 429.
 */
describe('личные потолки комнаты', () => {
  const OTHER = 'XYZ789'
  /** Тридцать секунд в минутное окно голосов и пятиминутное лайков: стоящие часы его не покинут */
  const MID_WINDOW_MS = (Math.floor(1_760_000_000 / 600) * 600 + 330) * 1000

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(MID_WINDOW_MS)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Злоумышленник посадил профиль Алисы по ссылке в свою комнату */
  async function seatedElsewhere(): Promise<void> {
    await alicesRoom()
    await createRoom(db, { id: OTHER, steamid: BOB }, nowSec())
    await issueRoomDeck(db, OTHER, [570])
    await signIn(db, ALICE)
    expect((await join(post(`/api/room/${OTHER}/join`), params({ id: OTHER }))).status).toBe(200)
  }

  test('голоса чужой ссылки не тратят потолок настоящей Алисы', async () => {
    await seatedElsewhere()
    const flood = () =>
      vote(post(`/api/room/${OTHER}/vote`, { appid: 570, vote: true }), params({ id: OTHER }))
    for (let i = 0; i < 120; i++) expect((await flood()).status, String(i)).toBe(200)
    expect((await flood()).status).toBe(429)

    await signIn(db, ALICE, { verified: true })
    expect((await vote(post(at('/vote'), { appid: 570, vote: true }), ctx())).status).toBe(200)
  })

  test('лайки — так же, а два устройства Алисы через Steam делят один потолок', async () => {
    await seatedElsewhere()
    const read = (room: string) => likes(new Request(`http://localhost/api/room/${room}/likes`), params({ id: room }))
    for (let i = 0; i < 40; i++) expect((await read(OTHER)).status, String(i)).toBe(200)
    expect((await read(OTHER)).status).toBe(429)

    await signIn(db, ALICE, { verified: true })
    for (let i = 0; i < 40; i++) expect((await read(ROOM)).status, String(i)).toBe(200)
    await signIn(db, ALICE, { verified: true }) // второе устройство
    expect((await read(ROOM)).status).toBe(429)
  })
})
