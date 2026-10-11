import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { InStatement } from '@libsql/client'
import { getGamesMeta, saveLibrarySnapshot, updateGamePrices, upsertGamesMeta, type Db } from '@/lib/db'
import { META_MAX_AGE_SEC } from '@/lib/catalog'
import { resetSwallowed } from '@/lib/errlog'
import { nowSec } from '@/lib/server'
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
    const res = await POST()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { remaining: number; stalled: boolean }
    expect(body.remaining).toBeGreaterThan(0)
    expect(body.stalled).toBe(true)
  })

  test('stalled оставляет в логе причину: 429 от Steam не спутать со сбоем базы', async () => {
    resetSwallowed()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', steamLimited)
    await POST()
    const lines = warn.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    warn.mockRestore()
    expect(lines).toContainEqual(
      expect.objectContaining({ event: 'swallowed', where: 'catalog:ensure-meta', status: 429 }),
    )
  })

  test('Steam отвечает — работа движется и stalled: false', async () => {
    vi.stubGlobal('fetch', steamUp)
    const res = await POST()
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
      POST().then((res) => res.json() as Promise<{ remaining: number }>),
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
    await POST()
    const res = await db.execute('SELECT COUNT(*) AS n FROM games WHERE appid < 0')
    expect(Number(res.rows[0].n)).toBe(0)
  })
})

/**
 * Тёплый каталог — обычный случай: прогрев зовут каждый заход в /play,
 * /daily, /explore и /library, предразогрев квиза и ConnectCard главной, и
 * почти всегда вся библиотека уже прогрета.
 *
 * Свежесть библиотеки читалась дважды подряд одним и тем же списком: внутри
 * ensureMeta и сразу следом — ради остатка, который на тёплом каталоге ноль
 * без всякого второго вопроса. Это лишний проход по каждой строке библиотеки
 * (Turso считает их в счёт) и лишний круг перед remaining: 0, которого ждёт
 * подбор.
 */
describe('/api/prepare: тёплый каталог', () => {
  test('свежесть библиотеки спрашивается один раз', async () => {
    const now = nowSec()
    // Прогреты, одиночные и с замеренной ценой: работе после ответа нечего
    // делать в Steam, и в сеть она не уйдёт и после конца теста
    await upsertGamesMeta(
      db,
      LIBRARY.map((g) => ({
        appid: g.appid,
        name: g.name,
        tags: { Puzzle: 10 },
        genres: [],
        categories: [2],
        art: { header: `https://cdn.example/${g.appid}.jpg` },
      })),
      now,
    )
    await updateGamePrices(db, LIBRARY.map((g) => ({ appid: g.appid, priceFinal: 999, priceInitial: 999 })), now)
    // Чарты Steam для бедного пула — мимо: пул в тесте пуст, а ходить некуда
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))

    const freshness = watchFreshness(db)

    const res = await POST()
    expect(await res.json()).toMatchObject({ remaining: 0, stalled: false })
    expect(freshness).toHaveLength(1)
  })
})

/** Один вопрос о свежести каталога (getStaleAppids): какие appid и с какой границы. */
type FreshnessAsk = { appids: number[]; cutoff: number }

/**
 * Подменяет базу, которую отдаст getDb(), на ту же, но с записью каждого
 * вопроса getStaleAppids — списка appid и границы `updated_at >= ?`.
 */
function watchFreshness(db: Db): FreshnessAsk[] {
  const asks: FreshnessAsk[] = []
  const spy = new Proxy(db, {
    get(target, prop) {
      if (prop !== 'execute') {
        // Привязка к самой базе: у клиента libsql приватные поля, и batch,
        // вызванный на прокси, падает (холодный прогрев пишет пачкой)
        const value: unknown = Reflect.get(target, prop, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
      return (q: InStatement) => {
        const sql = (typeof q === 'string' ? q : q.sql).replace(/\s+/g, ' ')
        // getStaleAppids: свежесть строк каталога по списку appid
        if (
          typeof q !== 'string' &&
          /FROM games WHERE appid IN \(SELECT value FROM json_each\(\?\)\)/.test(sql) &&
          sql.includes('art_json')
        ) {
          const args = q.args as unknown[]
          asks.push({ appids: JSON.parse(String(args[0])) as number[], cutoff: Number(args[1]) })
        }
        return target.execute(q)
      }
    },
  })
  ;(globalThis as typeof globalThis & { __imboredDb?: Promise<Db> }).__imboredDb = Promise.resolve(spy)
  return asks
}

/**
 * Холодная библиотека — первый заход человека, у которого каталог ещё пуст.
 *
 * Прогрев отбирает протухшее сам и отдаёт ensureMeta только отобранное, а
 * значит, две вещи держатся только договорённостью, которую ничто не
 * проверяло бы: что отбор и ensureMeta судят о свежести одним сроком, и что
 * ensureMeta перепроверяет пачку, которую возьмёт, а не всю протухшую часть.
 */
describe('/api/prepare: холодная библиотека', () => {
  // Больше пачки GetItems (BATCH = 200): за один вызов прогреется не всё
  const BIG = Array.from({ length: 250 }, (_, i) => ({
    appid: 10_000 + i,
    name: `Игра ${i}`,
    playtimeForever: i,
    playtime2Weeks: 0,
  }))

  beforeEach(async () => {
    // Позже засеянного в общем beforeEach — getLatestSnapshot возьмёт этот
    await saveLibrarySnapshot(db, STEAMID, BIG, nowSec())
    vi.stubGlobal('fetch', steamUp)
  })

  test('ensureMeta перепроверяет только свою пачку, остаток считается по всей протухшей части', async () => {
    const asks = watchFreshness(db)

    const res = await POST()
    expect(await res.json()).toMatchObject({ remaining: BIG.length - 200, stalled: false })
    // Отбор по всей библиотеке, перепроверка пачки, остаток. Без среза второй
    // вопрос вёз бы все 250 — у полутора тысяч игр это полторы тысячи строк
    // ради первых двухсот
    expect(asks.map((a) => a.appids.length)).toEqual([BIG.length, 200, BIG.length])
    // Пачка — голова отбора, в порядке плана прогрева
    expect(asks[1].appids).toEqual(asks[0].appids.slice(0, 200))
  })

  test('отбор и ensureMeta судят о свежести одним сроком — META_MAX_AGE_SEC каталога', async () => {
    const asks = watchFreshness(db)
    const before = nowSec()

    await POST()
    const after = nowSec()
    expect(asks.length).toBeGreaterThanOrEqual(2)
    // Своя копия срока в маршруте, разойдись она с каталожной, дала бы здесь
    // две разные границы: строки между ними отбор прятал бы от ensureMeta
    for (const { cutoff } of asks) {
      expect(cutoff).toBeGreaterThanOrEqual(before - META_MAX_AGE_SEC)
      expect(cutoff).toBeLessThanOrEqual(after - META_MAX_AGE_SEC)
    }
  })
})
