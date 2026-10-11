import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PATCH_SINCE_LEAD } from '@/lib/comeback'
import { resetSwallowed } from '@/lib/errlog'
import {
  getDailyPick,
  saveDailyPick,
  saveLibrarySnapshot,
  setNewsDigest,
  upsertGamesMeta,
  upsertNewsItems,
  type Db,
} from '@/lib/db'
import { breakDbOn, freshDb, post, signIn, signInAs, signOut, STEAMID_OF, type SessionKind } from '@/lib/testing/route'
import { POST as feedback } from '../feedback/route'
import type { GameMeta, LibraryGame } from '@/lib/types'
import { pickShareOk } from '@/lib/pickshare'
import { sessionSecret } from '@/lib/server'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))
// Бан в /api/feedback сбрасывает кэш портрета, а настоящий revalidateTag вне
// сервера Next бросает; здесь важен только сброс записей дня
vi.mock('next/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/cache')>()),
  revalidateTag: () => {},
}))

/**
 * /api/daily — записанный выбор дня, настоящим роутом на базе в памяти.
 *
 * Страница спрашивает сначала «только если уже выбрано» (?cached=1) и
 * прогревает каталог лишь при промахе. Здесь закреплено то, на чём это
 * держится: промах ничего не считает и не пишет, а попадание отдаёт ровно ту
 * игру, что выбрана утром, — даже если пул с тех пор изменился.
 */

const STEAMID = '76561197960287930'
/** 12:00 по Москве 23 сентября 2026 */
const NOON_MSK = Date.parse('2026-09-23T09:00:00Z')

const TAGS = ['Roguelike', 'Deckbuilding', 'Strategy', 'Puzzle', 'Cozy', 'Farming Sim']

function game(appid: number, hours: number): LibraryGame {
  return { appid, name: `Игра ${appid}`, playtimeForever: hours * 60, playtime2Weeks: 0 }
}

function meta(appid: number, tags: string[], priceAt: number): GameMeta {
  return {
    appid,
    name: `Игра ${appid}`,
    tags: Object.fromEntries(tags.map((t, i) => [t, 500 - i * 50])),
    genres: ['Indie'],
    categories: [2],
    // Цена свежая — роут не пойдёт за ней в Steam
    priceAt,
    priceFinal: 0,
    isFree: true,
  }
}

/** Библиотека: два наигранных «якоря» вкуса и несколько нетронутых игр. */
async function seedLibrary(db: Db, appids: number[], now: number) {
  const games = [game(1, 40), game(2, 25), ...appids.map((id) => game(id, 0))]
  await upsertGamesMeta(
    db,
    [
      meta(1, TAGS.slice(0, 3), now),
      meta(2, TAGS.slice(0, 3), now),
      ...appids.map((id, i) => meta(id, TAGS.slice(i % 3, (i % 3) + 3), now)),
    ],
    now,
  )
  await saveLibrarySnapshot(db, STEAMID, games, now)
}

const get = (query = '') => GET(new Request(`http://localhost/api/daily${query}`))

async function countRows(db: Db, table: string): Promise<number> {
  const res = await db.execute(`SELECT COUNT(*) AS n FROM ${table}`)
  return Number(res.rows[0].n)
}

let db: Db

beforeEach(async () => {
  // Подменяются только часы: таймеры настоящие, иначе ожидание цены
  // (refreshDealsWithin) не дождалось бы своего срока
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOON_MSK)
  // Сеть закрыта: всё, что роуту нужно, лежит в базе
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('сеть в тесте закрыта'))))
  db = await freshDb()
  await signIn(db, STEAMID, { verified: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('/api/daily: записанный выбор дня', () => {
  test('без сессии — 401 nosession и для запроса «только записанное»', async () => {
    signOut()
    const res = await get('?cached=1')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'nosession' })
  })

  test('промах — 204: без отбора, без записи и без лимита частоты', async () => {
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(NOON_MSK / 1000))
    const res = await get('?cached=1')
    expect(res.status).toBe(204)
    expect(await countRows(db, 'daily_picks')).toBe(0)
    expect(await countRows(db, 'rate_limits')).toBe(0)
    // а обычный запрос следом — и считает, и пишет, и отмечается в лимите
    expect((await get()).status).toBe(200)
    expect(await countRows(db, 'daily_picks')).toBe(1)
    expect(await countRows(db, 'rate_limits')).toBe(1)
  })

  test('промах без библиотеки — тоже 204: про библиотеку скажет обычный запрос', async () => {
    const res = await get('?cached=1')
    expect(res.status).toBe(204)
    const full = await get()
    expect(full.status).toBe(409)
    expect(await full.json()).toEqual({ error: 'nolibrary' })
  })

  test('второй заход в тот же день — та же игра, даже когда пул изменился', async () => {
    const now = Math.floor(NOON_MSK / 1000)
    await seedLibrary(db, [10, 11, 12, 13], now)

    const first = await get()
    expect(first.status).toBe(200)
    const morning = ((await first.json()) as { pick: { appid: number; source: string } }).pick
    const chosen = morning.appid
    // «Отправить другу»: основа причины, подписанная для этой сессии
    const { share, reason } = morning as unknown as { share: { text: string; sig: string }; reason: string }
    expect(reason.startsWith(share.text)).toBe(true)
    expect(
      pickShareOk(sessionSecret(), { steamid: STEAMID, appid: chosen, source: morning.source, text: share.text }, share.sig),
    ).toBe(true)
    expect(await countRows(db, 'daily_picks')).toBe(1)

    // Утренний выбор ушёл из библиотеки, остались совсем другие игры: отбор
    // заново выбрал бы из них — запись обязана его не звать
    const others = [20, 21, 22, 23].filter((id) => id !== chosen)
    await seedLibrary(db, others, now + 60)
    vi.setSystemTime(NOON_MSK + 3 * 3600_000)

    const cached = await get('?cached=1')
    expect(cached.status).toBe(200)
    const body = (await cached.json()) as {
      pick: { appid: number; source: string }
      dateLabel: string
    }
    // и та же игра, и та же роль: пересчёт мог бы вернуть её разве что
    // находкой из каталога, а не своей
    expect(body.pick).toMatchObject(morning)
    expect(body.dateLabel).toBe('23 сентября')

    const again = await get()
    expect(((await again.json()) as { pick: { appid: number } }).pick.appid).toBe(chosen)
  })

  test('в полночь по Москве запись вчерашняя — снова промах', async () => {
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(NOON_MSK / 1000))
    vi.setSystemTime(Date.parse('2026-09-23T20:59:00Z'))
    expect((await get()).status).toBe(200)
    expect((await get('?cached=1')).status).toBe(200)

    // 00:00 24-го по Москве, в UTC ещё 23-е
    vi.setSystemTime(Date.parse('2026-09-23T21:00:00Z'))
    expect((await get('?cached=1')).status).toBe(204)
    const next = await get()
    expect(((await next.json()) as { dateLabel: string }).dateLabel).toBe('24 сентября')
  })

  test('назавтра — не вчерашний герой: вчерашняя запись уходит в исключение', async () => {
    const DAY_MS = 86_400_000
    let yesterday: number | null = null
    for (let d = 0; d < 10; d++) {
      vi.setSystemTime(NOON_MSK + d * DAY_MS)
      const now = Math.floor(Date.now() / 1000)
      // Каждый день свежий снимок и свежие цены — отбору нечем отличать дни,
      // кроме сида и вчерашней записи
      await seedLibrary(db, [10, 11, 12, 13], now)
      const res = await get()
      expect(res.status).toBe(200)
      const today = ((await res.json()) as { pick: { appid: number } }).pick.appid
      expect(today, `день ${d}`).not.toBe(yesterday)
      yesterday = today
    }
  })
})

/**
 * «Не сегодня» на /daily: отзыв сбрасывает запись дня, если он про героя, и
 * следующий отбор эту игру до полуночи не вернёт. «Не сейчас» про любую
 * другую игру выбор дня не трогает — ради этого запись и заведена.
 */
describe('/api/daily: «Не сегодня»', () => {
  const pickOf = async (query = '') =>
    ((await (await get(query)).json()) as { pick: { appid: number } }).pick.appid
  const notNow = (appid: number, source = 'daily') =>
    feedback(post('/api/feedback', { appid, action: 'skipped', reason: 'notnow', ctx: { source } }))

  test('про героя дня — другая игра сразу, и она же при следующем заходе', async () => {
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(NOON_MSK / 1000))
    const first = await pickOf()
    expect((await notNow(first)).status).toBe(200)
    expect(await countRows(db, 'daily_picks')).toBe(0)

    const second = await pickOf()
    expect(second).not.toBe(first)
    expect(await pickOf('?cached=1')).toBe(second)

    // и третий раз — ни одна из двух отложенных сегодня
    await notNow(second)
    expect([first, second]).not.toContain(await pickOf())
  })

  test('после «Не сегодня» вчерашняя запись на месте — пересчёт не вернёт и вчерашнего', async () => {
    const DAY_MS = 86_400_000
    vi.setSystemTime(NOON_MSK - DAY_MS)
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(Date.now() / 1000))
    const yesterday = await pickOf()

    vi.setSystemTime(NOON_MSK)
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(NOON_MSK / 1000))
    const first = await pickOf()
    expect(first).not.toBe(yesterday)
    await notNow(first)
    // стёрта только сегодняшняя: по вчерашней отбор помнит, кого не повторять
    const days = await db.execute('SELECT day FROM daily_picks')
    expect(days.rows.map((r) => r.day)).toEqual(['2026-09-22'])

    expect([yesterday, first]).not.toContain(await pickOf())
  })

  test('про другую игру — запись дня на месте', async () => {
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(NOON_MSK / 1000))
    const first = await pickOf()
    const other = [10, 11, 12, 13].find((id) => id !== first)!
    await notNow(other, 'play')
    expect(await countRows(db, 'daily_picks')).toBe(1)
    expect(await pickOf('?cached=1')).toBe(first)
  })
})

/**
 * «Вчера была: …» — вчерашняя запись дня тем же ключом суток (dayKey), что и
 * сегодняшняя, в обоих ответах: обычном и «только записанное». Имя — из
 * записи: сеть в тестах закрыта, и строка обязана обходиться без неё.
 */
describe('/api/daily: «Вчера была»', () => {
  const DAY_MS = 86_400_000
  type Body = { pick: { appid: number }; yesterday: { appid: number; name: string } | null }
  const body = async (query = '') => (await (await get(query)).json()) as Body

  test('вчера была игра дня — она в ответе, и при ?cached=1 тоже', async () => {
    vi.setSystemTime(NOON_MSK - DAY_MS)
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(Date.now() / 1000))
    const before = (await body()).pick.appid

    vi.setSystemTime(NOON_MSK)
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(NOON_MSK / 1000))
    const today = await body()
    expect(today.pick.appid).not.toBe(before)
    expect(today.yesterday).toEqual({ appid: before, name: `Игра ${before}` })
    expect((await body('?cached=1')).yesterday).toEqual({ appid: before, name: `Игра ${before}` })
  })

  test('вчерашней записи нет — null, а не пустая строка', async () => {
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(NOON_MSK / 1000))
    expect((await body()).yesterday).toBeNull()
    expect((await body('?cached=1')).yesterday).toBeNull()
  })

  test('вчерашняя совпадает с сегодняшней — null: «вчера была» над той же игрой читается как сбой', async () => {
    const now = Math.floor(NOON_MSK / 1000)
    await seedLibrary(db, [10, 11, 12, 13], now)
    const today = (await body()).pick.appid
    // Вчерашняя запись — копия сегодняшней: так бывает, когда, кроме
    // вчерашней, выбирать не из чего (pickDaily повторяет, а не пустеет)
    await saveDailyPick(db, STEAMID, '2026-09-22', await getDailyPick(db, STEAMID, '2026-09-23'), now)
    const cached = await body('?cached=1')
    expect(cached.pick.appid).toBe(today)
    expect(cached.yesterday).toBeNull()
  })

  /**
   * Скрытая сегодня вчерашняя — строки нет. Бан и «надоела» стирают
   * сегодняшнюю запись, а вчерашнюю — только если её герой и есть эта игра
   * (/api/feedback): иначе «Вчера была: X →» вела бы на игру, которую человек
   * только что попросил не показывать.
   */
  test.each([
    ['бан', { action: 'banned' }],
    ['«надоела»', { action: 'skipped', reason: 'tired' }],
  ])('вчерашнюю сегодня скрыли (%s) — строки нет, и при ?cached=1 тоже', async (_, fb) => {
    vi.setSystemTime(NOON_MSK - DAY_MS)
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(Date.now() / 1000))
    const before = (await body()).pick.appid

    vi.setSystemTime(NOON_MSK)
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(NOON_MSK / 1000))
    expect((await body()).yesterday?.appid).toBe(before)

    await feedback(post('/api/feedback', { appid: before, ...fb, ctx: { source: 'play' } }))
    const after = await body()
    expect(after.pick.appid).not.toBe(before)
    expect(after.yesterday).toBeNull()
    expect((await body('?cached=1')).yesterday).toBeNull()
  })

  test('скрыли другую игру — вчерашняя запись цела, строка на месте', async () => {
    vi.setSystemTime(NOON_MSK - DAY_MS)
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(Date.now() / 1000))
    const before = (await body()).pick.appid

    vi.setSystemTime(NOON_MSK)
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(NOON_MSK / 1000))
    const other = [10, 11, 12, 13].find((id) => id !== before)!
    await feedback(post('/api/feedback', { appid: other, action: 'banned', ctx: { source: 'play' } }))
    expect(await getDailyPick(db, STEAMID, '2026-09-22')).not.toBeNull()
    expect((await body()).yesterday?.appid).toBe(before)
  })

  test('вчера было «Не сегодня» — в строке замена: запись дня хранит последнего героя', async () => {
    vi.setSystemTime(NOON_MSK - DAY_MS)
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(Date.now() / 1000))
    const first = (await body()).pick.appid
    await feedback(
      post('/api/feedback', { appid: first, action: 'skipped', reason: 'notnow', ctx: { source: 'daily' } }),
    )
    const second = (await body()).pick.appid
    expect(second).not.toBe(first)

    vi.setSystemTime(NOON_MSK)
    await seedLibrary(db, [10, 11, 12, 13], Math.floor(NOON_MSK / 1000))
    expect((await body()).yesterday?.appid).toBe(second)
  })
})

/**
 * «С твоего последнего захода вышло крупное обновление» в «Игре дня».
 *
 * Запись дня одна на steamid и общая для всех его сессий: факт лежит в ней
 * отдельным полем (reasonPatched), а GET отдаёт его только writer
 * (dailyReasonBase). Здесь — склейка настоящим роутом: кто видит фразу, что
 * уходит в «Отправить другу» и что обрыв базы на чтении патча не роняет
 * отбор дня.
 */
describe('/api/daily: крупный патч с последнего захода', () => {
  const DAY = 86_400
  const STALE = 620
  const TLDR = 'Добавили новый биом и переделали бои с боссами'
  type Body = { pick: { appid: number; source: string; reason: string; share?: { text: string } } }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Одна своя — заброшенная с датой запуска, и патч после неё */
  async function setup(kind: SessionKind): Promise<void> {
    const steamid = await signInAs(db, kind)
    const now = Math.floor(NOON_MSK / 1000)
    await upsertGamesMeta(db, [meta(STALE, TAGS.slice(0, 3), now)], now)
    await saveLibrarySnapshot(
      db,
      steamid,
      [{ ...game(STALE, 40), lastPlayed: now - 200 * DAY }],
      now,
    )
    await upsertNewsItems(
      db,
      [
        {
          appid: STALE,
          gid: 'major',
          title: 'Обновление',
          url: `https://store.steampowered.com/news/app/${STALE}/view/1`,
          publishedAt: now - 30 * DAY,
          kind: 'patch',
          scale: 'major',
          blocks: [{ kind: 'p', runs: [{ text: 'правки' }] }],
          bodyHash: 'h1',
          rank: 5000,
        },
      ],
      now,
    )
    await setNewsDigest(db, STALE, 'major', { tldr: TLDR, scale: 'major' }, now)
  }

  async function dailyPick(): Promise<Body['pick']> {
    const res = await get()
    expect(res.status).toBe(200)
    const { pick } = (await res.json()) as Body
    expect(pick.appid).toBe(STALE)
    expect(pick.source).toBe('comeback')
    return pick
  }

  test('сессия по вставленной ссылке — прежняя фраза, хотя факт в записи есть', async () => {
    await setup('claimed')
    const pick = await dailyPick()
    expect(pick.reason).not.toContain(PATCH_SINCE_LEAD)
    expect(pick.reason).toContain('вернись и проверь')
    expect(pick.share!.text).not.toContain(PATCH_SINCE_LEAD)
    // Запись общая для всех сессий профиля — факт в ней лежит отдельным полем
    const stored = (await getDailyPick(db, STEAMID_OF.claimed, '2026-09-23')) as { reasonPatched?: string }
    expect(stored.reasonPatched).toContain(PATCH_SINCE_LEAD)
  })

  test.each(['openid', 'demo'] as const)('writer (%s) — фраза в причине, но не в «Отправить другу»', async (kind) => {
    await setup(kind)
    const pick = await dailyPick()
    expect(pick.reason).toContain(PATCH_SINCE_LEAD)
    expect(pick.reason).toContain('новый биом')
    // По ссылке уходит основа без факта: получатель прочёл бы его про себя
    expect(pick.share!.text).not.toContain(PATCH_SINCE_LEAD)
    expect(pick.share!.text).not.toContain('новый биом')
    expect(pick.share!.text).toContain('вернись и проверь')
  })

  /**
   * «Сегодня хочу из своего» — та же развилка у запасной своей. Отбор делает
   * её редко (магазинный день раз в три), поэтому запись собрана руками: так
   * роут проверяется на обоих путях — alternateView (причина по writer) и
   * shareView запасной (всегда основа без факта).
   */
  describe('запасная своя на магазинный день', () => {
    const HERO = 9001
    const ALT_BASE = `У тебя в «Игра ${STALE}» уже 40 ч — вернись и проверь, как она сейчас.`
    const ALT_PATCHED = `У тебя в «Игра ${STALE}» уже 40 ч. ${PATCH_SINCE_LEAD}: ${TLDR}.`
    type AltBody = { ownAlternate: { appid: number; reason: string; share?: { text: string } } | null }

    async function seedStoreDay(kind: SessionKind): Promise<AltBody['ownAlternate']> {
      const steamid = await signInAs(db, kind)
      const now = Math.floor(NOON_MSK / 1000)
      await upsertGamesMeta(db, [meta(HERO, TAGS.slice(0, 3), now), meta(STALE, TAGS.slice(0, 3), now)], now)
      await saveDailyPick(
        db,
        steamid,
        '2026-09-23',
        {
          pick: { appid: HERO, name: `Игра ${HERO}`, source: 'new' },
          shelf: [],
          hoursPlayed: null,
          reasonBase: 'Теги твои, а в библиотеке её нет.',
          sharedTags: [],
          via: null,
          hideUrgency: false,
          alt: {
            pick: { appid: STALE, name: `Игра ${STALE}`, source: 'comeback' },
            hoursPlayed: 40,
            reasonBase: ALT_BASE,
            reasonPatched: ALT_PATCHED,
            sharedTags: [],
            via: null,
          },
        },
        now,
      )
      const res = await get()
      expect(res.status).toBe(200)
      const { ownAlternate } = (await res.json()) as AltBody
      expect(ownAlternate?.appid).toBe(STALE)
      return ownAlternate
    }

    test('сессия по вставленной ссылке — ни в причине, ни в «Отправить другу»', async () => {
      const alt = (await seedStoreDay('claimed'))!
      expect(alt.reason).toContain('вернись и проверь')
      expect(alt.reason).not.toContain(PATCH_SINCE_LEAD)
      expect(alt.share!.text).toBe(ALT_BASE)
    })

    test.each(['openid', 'demo'] as const)('writer (%s) — факт в причине, по ссылке основа без него', async (kind) => {
      const alt = (await seedStoreDay(kind))!
      expect(alt.reason).toContain(PATCH_SINCE_LEAD)
      expect(alt.reason).toContain('новый биом')
      expect(alt.share!.text).toBe(ALT_BASE)
      expect(alt.share!.text).not.toContain('новый биом')
    })
  })

  test('обрыв базы на чтении патча — отбор дня собирается без факта, сбой в логе', async () => {
    await setup('openid')
    // logSwallowed глушит повтор того же where на минуту: без сброса строка
    // зависела бы от того, не залогировал ли её раньше другой тест файла
    resetSwallowed()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    breakDbOn(db, 'FROM news_items')
    const pick = await dailyPick()
    expect(pick.reason).not.toContain(PATCH_SINCE_LEAD)
    expect(pick.reason).toContain('вернись и проверь')
    expect(warn.mock.calls.map((c) => String(c[0])).join(' ')).toContain('cards:comeback-patches')
  })
})
