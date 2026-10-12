import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  countUserRows,
  createRoom,
  createSharedPick,
  FORGET_TABLES,
  logFeedback,
  revokeAllSessions,
  saveLibrarySnapshot,
  upsertUser,
  type Db,
} from '@/lib/db'
import { FORGET_IP_LIMIT } from '@/lib/forget'
import { FORGET_CONFIRM } from '@/lib/forgetreply'
import { portraitTag } from '@/lib/portraitmodel'
import { SESSION_COOKIE, currentSession, sessionSecret } from '@/lib/server'
import { forgetSessionCache, mintSession } from '@/lib/sessions'
import { setTestCookie, setTestHeaders } from '@/lib/testing/headers'
import { STEAMID_OF, breakDbOn, freshDb, listenDb, post, signIn, signInAs, signOut } from '@/lib/testing/route'
import { GET, POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

// Сброс кэша картинок: настоящие revalidatePath и revalidateTag вне сервера
// Next бросают, а здесь важно, что и какие адреса роут сбросил
const revalidated = vi.hoisted(() => ({ paths: [] as string[], tags: [] as Array<[string, unknown]> }))
vi.mock('next/cache', () => ({
  revalidatePath: (p: string) => {
    revalidated.paths.push(p)
  },
  revalidateTag: (tag: string, profile: unknown) => {
    revalidated.tags.push([tag, profile])
  },
}))

/**
 * «Удалить всё обо мне» — настоящим роутом на базе в памяти.
 *
 * Обещания: удаляет только вход через Steam (сессия по ссылке на профиль
 * владение не доказала, демо — ничьё), только по слову подтверждения и под
 * потолком попыток; удаляет то же, что и удаление по письму (forgetUser), и
 * выпускает человека со всех устройств — а не только с того, где нажали.
 */

const T0 = 1_760_000_000
const ME = STEAMID_OF.openid

let db: Db

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0 * 1000)
  db = await freshDb()
  revalidated.paths.length = 0
  revalidated.tags.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const preview = () => {
  setTestHeaders({})
  return GET(new Request('http://localhost/api/forget'))
}
const erase = (body: unknown = { confirm: FORGET_CONFIRM }) => POST(post('/api/forget', body))

/** Кука сессии в ответе погашена */
const cleared = (res: Response) =>
  res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=;`) && /Max-Age=0/i.test(c))

/** Сколько всего строк о человеке — тем же счётом, что у удаления */
async function stored(steamid: string): Promise<number> {
  return (await countUserRows(db, steamid)).reduce((s, r) => s + r.rows, 0)
}

/** Жива ли сессия с этим токеном — как её увидел бы следующий запрос */
async function alive(token: string): Promise<boolean> {
  setTestCookie(SESSION_COOKIE, token)
  forgetSessionCache()
  return (await currentSession()) !== null
}

/** Человек, о котором есть что удалить: профиль, библиотека, оценка, выбор и комната */
async function seed(steamid: string): Promise<void> {
  await upsertUser(db, { steamid, personaName: 'Я', avatarUrl: 'https://a/me.jpg' }, T0 - 3600)
  await saveLibrarySnapshot(db, steamid, [{ appid: 570, name: 'Dota 2', playtimeForever: 60, playtime2Weeks: 0 }], T0 - 3600)
  await logFeedback(db, { steamid, appid: 570, action: 'liked' }, T0 - 3600)
  await createSharedPick(
    db,
    { id: 'mepick234567', createdBy: steamid, appid: 570, source: 'comeback', kind: 'play', reason: 'Вернись.' },
    T0 - 3600,
  )
  await createRoom(db, { id: 'MYROOM', steamid }, T0 - 3600)
}

describe('/api/forget: кто вправе', () => {
  test('гость — 401, ничего не тронуто', async () => {
    await seed(ME)
    signOut()
    for (const res of [await preview(), await erase()]) {
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'nosession' })
    }
    expect(await stored(ME)).toBeGreaterThan(0)
  })

  /*
   * Сессию по ссылке выдают на любой публичный профиль без доказательства
   * владения. Удали она — любой, кто знает чужую ссылку, стёр бы человеку
   * всё. Демо — ничьё, и удалять в нём нечего: его убирает уборка.
   */
  test.each(['claimed', 'demo'] as const)('%s — 403 needsteam: ни списка, ни удаления', async (kind) => {
    const steamid = await signInAs(db, kind)
    await seed(steamid)
    const before = await stored(steamid)
    for (const res of [await preview(), await erase()]) {
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'needsteam' })
    }
    expect(await stored(steamid)).toBe(before)
  })
})

describe('/api/forget: что хранится', () => {
  test('вход через Steam видит список, и ничего не удаляется', async () => {
    await signIn(db, ME, { verified: true })
    await seed(ME)
    const before = await stored(ME)

    const res = await preview()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control') ?? '').toContain('no-store')
    const body = (await res.json()) as { items: string[]; effects: string[] }
    expect(body.items).toContain('Профиль Steam: имя, аватар и портрет')
    expect(body.items).toContain('Снимки библиотеки — 1')
    expect(body.items).toContain('Комнаты, где ты хост — 1')
    expect(body.effects).toContain('Ты выйдешь на всех устройствах.')
    expect(await stored(ME)).toBe(before)
  })
})

describe('/api/forget: удаление', () => {
  test('без слова подтверждения — 400, ничего не тронуто', async () => {
    await signIn(db, ME, { verified: true })
    await seed(ME)
    const before = await stored(ME)
    for (const body of [{}, { confirm: 'yes' }, { confirm: true }, 'не json', null]) {
      const res = await erase(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.json()).toEqual({ error: 'badinput' })
      expect(cleared(res)).toBe(false)
    }
    expect(await stored(ME)).toBe(before)
  })

  test('удаляет всё, что удалило бы письмо, и гасит куку', async () => {
    await signIn(db, ME, { verified: true })
    await seed(ME)
    vi.setSystemTime((T0 + 60) * 1000)

    const res = await erase()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('Cache-Control') ?? '').toContain('no-store')
    expect(cleared(res)).toBe(true)
    // Счёт удаления по тем же таблицам — пусто везде, кроме отметки удаления
    const left = (await countUserRows(db, ME)).filter((r) => r.rows > 0)
    expect(left).toEqual([{ table: 'forget_marks', rows: 1 }])
    expect(FORGET_TABLES).toContain('forget_marks')
  })

  /*
   * Ради этого и стоит отметка удаления. Подпись куки — авторитет входа, и
   * кука без строки в базе пускает: стёртые sessions и users не выпускали
   * никого. Забытый телефон оставался «вошедшим», и первый же вход в пати
   * по ссылке снова записал бы человека под удалённым SteamID.
   */
  test('выпускает со всех устройств, а новый вход после — пускает', async () => {
    const phone = await signIn(db, ME, { verified: true })
    await signIn(db, ME, { verified: true })
    await seed(ME)
    vi.setSystemTime((T0 + 60) * 1000)
    expect((await erase()).status).toBe(200)

    expect(await alive(phone.token)).toBe(false)
    // Кука, выданная без строки в базе (Turso моргнула на входе), — тоже
    const rowless = mintSession(ME, sessionSecret(), T0)
    expect(await alive(rowless.token)).toBe(false)
    // Вернулся и вошёл заново — это новый человек с чистого листа
    vi.setSystemTime((T0 + 120) * 1000)
    const again = mintSession(ME, sessionSecret(), T0 + 120)
    expect(await alive(again.token)).toBe(true)
  })

  test('картинки портрета, итогов, сравнения, выборов и комнат уходят из кэша', async () => {
    await signIn(db, ME, { verified: true })
    await seed(ME)
    expect((await erase()).status).toBe(200)
    expect(revalidated.paths).toEqual(
      expect.arrayContaining([
        `/portrait/${ME}/opengraph-image`,
        `/portrait/${ME}/card.png`,
        `/portrait/${ME}/year/opengraph-image`,
        `/portrait/${ME}/year/card.png`,
        `/compat/${ME}/opengraph-image`,
        '/pick/mepick234567/opengraph-image',
        '/room/MYROOM/opengraph-image',
      ]),
    )
    // Модель портрета — немедленно, а не «отдать устаревшее и пересобрать»
    expect(revalidated.tags).toEqual([[portraitTag(ME), { expire: 0 }]])
  })

  /*
   * Состояние сессии кэшируется на процесс минуту (REVOKE_CACHE_SEC), и
   * «Выйти на всех устройствах», нажатое владельцем на соседнем экземпляре,
   * доходит сюда с опозданием. Удаление необратимо — минуты, в которую
   * погашенная кука ещё стирает всё, быть не должно: роут сверяет сессию
   * с базой мимо кэша.
   */
  test('отозванная сессия из тёплого кэша не удаляет — 401, всё на месте', async () => {
    await signIn(db, ME, { verified: true })
    await seed(ME)
    expect(await currentSession()).not.toBeNull()
    await revokeAllSessions(db, ME, T0 + 1)
    vi.setSystemTime((T0 + 2) * 1000)
    // Кэш ещё считает сессию живой — так её видел бы соседний экземпляр
    expect(await currentSession()).not.toBeNull()

    const res = await erase()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'nosession' })
    expect(await stored(ME)).toBeGreaterThan(0)
  })

  /*
   * Сверка не ответила — вход пущен на веру (fail-open), и verified у него
   * false не потому, что вошли по ссылке, а потому, что неизвестно ничего.
   * needsteam позвал бы уже вошедшего через Steam войти через Steam снова,
   * и в аварию это не помогло бы. Ответ — «не получилось», и ничего не
   * удалено.
   */
  test('сбой сверки сессии — 503 failed, а не needsteam, и ничего не удалено', async () => {
    await signIn(db, ME, { verified: true })
    await seed(ME)
    const before = await stored(ME)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    breakDbOn(db, 'LEFT JOIN forget_marks')

    for (const res of [await preview(), await erase()]) {
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'failed' })
      expect(cleared(res)).toBe(false)
    }
    expect(await stored(ME)).toBe(before)
  })

  test('сбой базы — 503, кука цела, данные целы, в логе нет SteamID', async () => {
    await signIn(db, ME, { verified: true })
    await seed(ME)
    const before = await stored(ME)
    const logs: string[] = []
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '))
      })
    }
    breakDbOn(db, 'DELETE FROM')

    const res = await erase()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'failed' })
    expect(cleared(res)).toBe(false)
    expect(await stored(ME)).toBe(before)
    expect(logs.join('\n')).not.toContain(ME)
  })
})

/*
 * Сверка мимо кэша — только для своей сессии. Раньше POST сбрасывал весь
 * кэш состояния сессий процесса ещё до того, как узнавал, есть ли кука: любой
 * запрос без входа — отбитый 401, до потолка попыток он не доходит —
 * заставлял каждый следующий вход на этом экземпляре идти в базу.
 */
describe('/api/forget: кэш сессий', () => {
  test('POST без входа не сбрасывает кэш сессий другим', async () => {
    const other = STEAMID_OF.claimed
    const { token } = await signIn(db, other)
    // Сессия соседа сверена и лежит в кэше
    expect(await currentSession()).not.toBeNull()
    let lookups = 0
    listenDb(db, (sql) => {
      if (sql.includes('LEFT JOIN forget_marks')) lookups += 1
    })

    signOut()
    for (let i = 0; i < 5; i++) expect((await erase()).status).toBe(401)

    // Соседа по-прежнему узнают по кэшу, а не новым походом в базу
    setTestCookie(SESSION_COOKIE, token)
    expect(await currentSession()).not.toBeNull()
    expect(lookups).toBe(0)
  })

  test('удаление сверяет свою сессию с базой и при тёплом кэше', async () => {
    await signIn(db, ME, { verified: true })
    await seed(ME)
    expect(await currentSession()).not.toBeNull()
    let lookups = 0
    listenDb(db, (sql) => {
      if (sql.includes('LEFT JOIN forget_marks')) lookups += 1
    })
    expect((await erase()).status).toBe(200)
    expect(lookups).toBe(1)
  })
})

describe('/api/forget: потолок попыток', () => {
  test('с одного адреса — не больше потолка, и отказ ничего не удаляет', async () => {
    await signIn(db, ME, { verified: true })
    await seed(ME)
    const headers = { 'x-forwarded-for': '203.0.113.7' }
    for (let i = 0; i < FORGET_IP_LIMIT; i++) {
      setTestHeaders(headers)
      const res = await GET(new Request('http://localhost/api/forget', { headers }))
      expect(res.status, `попытка ${i + 1}`).toBe(200)
    }
    const limited = await POST(post('/api/forget', { confirm: FORGET_CONFIRM }, headers))
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ error: 'ratelimited' })
    expect(cleared(limited)).toBe(false)
    expect(await stored(ME)).toBeGreaterThan(0)
  })
})
