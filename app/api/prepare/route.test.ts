import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getGamesMeta, saveLibrarySnapshot, upsertGamesMeta, type Db } from '@/lib/db'
import { resetSwallowed } from '@/lib/errlog'
import { nowSec } from '@/lib/server'
import { SESSION_COOKIE } from '@/lib/server'
import { setTestCookie } from '@/lib/testing/headers'
import { freshDb, signIn } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * /api/prepare — признак «Steam не ответил», настоящим роутом.
 *
 * Без него ответ при 429 от Steam был неотличим от обычного: тот же остаток,
 * и клиент три минуты спрашивал его по кругу, каждый раз отправляя пачку
 * GetItems туда, где нас как раз ограничивают. Клиентская половина — в
 * lib/warmup.test.ts («прогрев без продвижения»).
 */

const STEAMID = '76561197960287930'
const LIBRARY = [
  { appid: 620, name: 'Portal 2', playtimeForever: 600, playtime2Weeks: 0 },
  { appid: 413150, name: 'Stardew Valley', playtimeForever: 0, playtime2Weeks: 0 },
]

/** Steam, который отвечает: словарь тегов и пачка GetItems по запрошенным appid. */
const steamUp = vi.fn(async (url: string) => {
  const u = String(url)
  if (u.includes('populartags')) {
    return new Response(JSON.stringify([{ tagid: 19, name: 'Action' }]), { status: 200 })
  }
  if (u.includes('GetItems')) {
    const input = JSON.parse(new URL(u).searchParams.get('input_json') ?? '{}') as {
      ids?: Array<{ appid: number }>
    }
    const items = (input.ids ?? []).map(({ appid }) => ({
      appid,
      id: appid,
      name: `Игра ${appid}`,
      visible: true,
    }))
    return new Response(JSON.stringify({ response: { store_items: items } }), { status: 200 })
  }
  return new Response('', { status: 404 })
})

/** Steam, который нас ограничивает. */
const steamLimited = vi.fn(async () => new Response('', { status: 429 }))

/** Вызов прогрева; адрес — для потолка адреса (PREPARE_IP_LIMIT) */
const prepare = (ip = '203.0.113.7') =>
  POST(new Request('http://localhost/api/prepare', { method: 'POST', headers: { 'x-forwarded-for': ip } }))

let db: Db

beforeEach(async () => {
  // Без ключа роут не пойдёт освежать библиотеку — в тесте нечего и некуда
  vi.stubEnv('STEAM_API_KEY', '')
  db = await freshDb()
  await signIn(db, STEAMID, { verified: true })
  await saveLibrarySnapshot(db, STEAMID, LIBRARY, nowSec())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('/api/prepare: stalled', () => {
  test('Steam ограничивает — остаток прежний и stalled: true', async () => {
    vi.stubGlobal('fetch', steamLimited)
    const res = await prepare()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { remaining: number; stalled: boolean }
    expect(body.remaining).toBeGreaterThan(0)
    expect(body.stalled).toBe(true)
  })

  test('stalled оставляет в логе причину: 429 от Steam не спутать со сбоем базы', async () => {
    resetSwallowed()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', steamLimited)
    await prepare()
    const lines = warn.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    warn.mockRestore()
    expect(lines).toContainEqual(
      expect.objectContaining({ event: 'swallowed', where: 'catalog:ensure-meta', status: 429 }),
    )
  })

  test('Steam отвечает — работа движется и stalled: false', async () => {
    vi.stubGlobal('fetch', steamUp)
    const res = await prepare()
    const body = (await res.json()) as { remaining: number; stalled: boolean }
    expect(body.stalled).toBe(false)
    expect(body.remaining).toBe(0)
  })
})

/**
 * Онлайн и цены последнего круга — после ответа, а не перед ним.
 *
 * Ответ с remaining: 0 ждут подбор (lib/warmup) и игра дня, а онлайн — это до
 * сорока запросов к Steam, у вернувшегося человека почти всегда протухших.
 * Здесь Steam на них зависает: роут обязан ответить всё равно, а замер —
 * доехать, когда Steam ответит.
 */
describe('/api/prepare: онлайн после ответа', () => {
  test('ответ не ждёт зависший GetNumberOfCurrentPlayers, а замер всё равно записывается', async () => {
    // Обе игры прогреты и сетевые: остаток ноль с первого вызова, онлайн протух
    await upsertGamesMeta(
      db,
      LIBRARY.map((g) => ({
        appid: g.appid,
        name: g.name,
        tags: { Action: 10 },
        genres: [],
        categories: [1],
        art: {},
      })),
      nowSec(),
    )
    let release = () => {}
    const hung = new Promise<void>((r) => {
      release = r
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('GetNumberOfCurrentPlayers')) {
          await hung
          return new Response(JSON.stringify({ response: { result: 1, player_count: 777 } }))
        }
        return new Response('', { status: 404 })
      }),
    )

    const answered = await Promise.race([
      prepare().then((res) => res.json() as Promise<{ remaining: number }>),
      new Promise<'ждёт Steam'>((r) => setTimeout(() => r('ждёт Steam'), 4_000)),
    ])
    expect(answered).toEqual(expect.objectContaining({ remaining: 0 }))
    expect((await getGamesMeta(db, [620])).get(620)?.ccu).toBeUndefined()

    release()
    await vi.waitFor(async () => expect((await getGamesMeta(db, [620])).get(620)?.ccu).toBe(777), {
      timeout: 4_000,
    })
  })

  test('кураторский пул других магазинов прогрев больше не сеет', async () => {
    vi.stubGlobal('fetch', steamUp)
    await prepare()
    const res = await db.execute('SELECT COUNT(*) AS n FROM games WHERE appid < 0')
    expect(Number(res.rows[0].n)).toBe(0)
  })
})

/*
 * Потолок частоты. Личный — на того, кто спрашивает (personalRateId в
 * lib/ratelimit): сессию по ссылке /api/connect выдаёт на любой публичный
 * профиль, и общий на steamid счётчик позволял чужому запереть владельцу
 * прогрев, а с ним /play и /daily. А раз сессия по ссылке — свой счётчик,
 * рядом обязан стоять потолок адреса: иначе свежие сессии с одного адреса
 * множили бы пачки GetItems в Steam.
 *
 * Профиль здесь — без снапшота: каждый пропущенный вызов — дешёвый 409, но в
 * потолок засчитан.
 */
describe('/api/prepare: потолок частоты', () => {
  const OTHER = '76561197960287939'
  const T0 = 1_760_000_000

  // Окно фиксированное, по часам: граница окна посреди теста обнулила бы счёт
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0 * 1000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('чужая сессия по ссылке выбрала свой потолок — владельцу прогрев не заперт', async () => {
    const owner = await signIn(db, OTHER, { verified: true })
    await signIn(db, OTHER)
    for (let i = 0; i < 200; i++) expect((await prepare('198.51.100.1')).status).toBe(409)
    expect((await prepare('198.51.100.1')).status).toBe(429)
    setTestCookie(SESSION_COOKIE, owner.token)
    expect((await prepare('203.0.113.7')).status).toBe(409)
  })

  test('свежие сессии по ссылке с одного адреса упираются в потолок адреса', async () => {
    for (let s = 0; s < 3; s++) {
      await signIn(db, OTHER)
      for (let i = 0; i < 200; i++) expect((await prepare('198.51.100.1')).status).toBe(409)
    }
    await signIn(db, OTHER)
    expect((await prepare('198.51.100.1')).status).toBe(429)
    expect((await prepare('198.51.100.2')).status).toBe(409)
  })
})
