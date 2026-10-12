import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { countUserRows, feedLinkOwner, forgetUser, getFeedLink, revokeAllSessions, type Db } from '@/lib/db'
import { FEED_LINK_LIMIT, feedTokenHash } from '@/lib/feedlink'
import { issueReply } from '@/lib/feedlinkreply'
import { currentSession } from '@/lib/server'
import { freshDb, post, signInAs, signOut } from '@/lib/testing/route'
import { DELETE, POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Выпуск, перевыпуск и отключение секретной ссылки на личную RSS-ленту.
 *
 * Обещания: выпускает только пишущая и не отозванная сессия (вход через
 * Steam или демо — requireWriter, отзыв — в самой записи), ключ показывается
 * один раз и в базу не попадает, перевыпуск гасит прежнюю ссылку только по
 * просьбе, а ответ с ключом нигде не кэшируется.
 */

const T0 = 1_760_000_000

let db: Db

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0 * 1000)
  db = await freshDb()
})

afterEach(() => {
  vi.useRealTimers()
})

// Кто — из сессии, в теле только просьба заменить. Межсайтовый POST/DELETE
// отсекает proxy.ts по Origin ещё до роута (lib/origin.test.ts)
const issue = (body: unknown = { replace: false }) => POST(post('/api/whatsnew/feedlink', body))
/** «Да, выпустить новую»: человек видел, что старая погаснет */
const reissue = () => issue({ replace: true })
const disable = () => DELETE()

/** Ключ из ответа на выпуск — последний сегмент пути */
async function keyOf(res: Response): Promise<string> {
  const body = (await res.json()) as { path?: unknown }
  expect(typeof body.path).toBe('string')
  const path = body.path as string
  expect(path).toMatch(/^\/whatsnew\/feed\/[0-9a-f]{32}$/)
  return path.split('/').pop()!
}

async function linkRows(): Promise<number> {
  const res = await db.execute('SELECT COUNT(*) AS n FROM feed_links')
  return Number(res.rows[0]?.n)
}

describe('/api/whatsnew/feedlink: кто выпускает', () => {
  test('гость — 401, ссылки нет', async () => {
    signOut()
    expect((await issue()).status).toBe(401)
    expect((await disable()).status).toBe(401)
    expect(await linkRows()).toBe(0)
  })

  /**
   * Сессия по вставленной ссылке на профиль владение не доказала. Выпусти
   * она ключ — любой, кто знает чужой профиль, получил бы постоянный доступ
   * к его ленте мимо входа, и ещё мог бы отключить владельцу его ссылку.
   */
  test('сессия по ссылке на профиль — 403 needsteam: ни выпустить, ни отключить', async () => {
    await signInAs(db, 'claimed')
    const res = await issue()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'needsteam' })
    expect((await reissue()).status).toBe(403)
    expect((await disable()).status).toBe(403)
    expect(await linkRows()).toBe(0)
  })

  test('вход через Steam и демо — выпускают', async () => {
    const steamid = await signInAs(db, 'openid')
    expect((await issue()).status).toBe(200)
    expect(await getFeedLink(db, steamid)).toEqual({ createdAt: T0 })

    signOut()
    const demo = await signInAs(db, 'demo')
    expect((await issue()).status).toBe(200)
    expect(await getFeedLink(db, demo)).toEqual({ createdAt: T0 })
  })

  /**
   * Состояние сессии кэшируется на процесс минуту, а «Выйти на всех
   * устройствах» чистит кэш только того экземпляра, что обслужил выход. На
   * соседнем тот, кто сидит в чужой сессии, ещё проходит requireWriter — и
   * ссылка, выпущенная в это окно, пережила бы отзыв навсегда: ридеру кука
   * не нужна. Здесь «соседний экземпляр» — отзыв прямо в базе, мимо
   * forgetSessionCache.
   */
  test('отозванная сессия из тёплого кэша ссылку не выпускает — 401, ссылки нет', async () => {
    const steamid = await signInAs(db, 'openid')
    const before = await keyOf(await issue())

    await revokeAllSessions(db, { steamid, sid: (await currentSession())!.sid }, T0 + 1)
    // Окно настоящее: кэш ещё считает сессию живой
    expect(await currentSession()).not.toBeNull()

    for (const send of [issue, reissue]) {
      const res = await send()
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'nosession' })
      expect(res.headers.get('Cache-Control') ?? '').toContain('no-store')
    }
    expect(await feedLinkOwner(db, feedTokenHash(before))).toBeNull()
    expect(await getFeedLink(db, steamid)).toBeNull()
    expect(await linkRows()).toBe(0)
  })

  /*
   * То же окно, но после «Удалить всё обо мне» на соседнем экземпляре. Оно
   * строки сессий не отзывает, а стирает — и проверка «строка не отозвана»
   * молчала: строки нет, отзыва тоже. Телефон с /whatsnew выпускал вечную
   * ссылку, и SteamID снова лежал в базе после «всё удалено». Удаление здесь
   * — прямо в базе, мимо forgetSessionCache, как его увидел бы соседний
   * экземпляр.
   */
  test('сессия, удалившая всё на другом экземпляре, ссылку не выпускает — 401, в базе пусто', async () => {
    const steamid = await signInAs(db, 'openid')
    expect(await currentSession()).not.toBeNull()
    await forgetUser(db, steamid, { signOutFrom: T0 + 1 })
    vi.setSystemTime((T0 + 2) * 1000)
    // Окно настоящее: кэш ещё считает сессию живой и пишущей
    expect(await currentSession()).not.toBeNull()

    for (const send of [issue, reissue]) {
      const res = await send()
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'nosession' })
    }
    expect(await linkRows()).toBe(0)
    // От человека — отметка удаления и счётчик выпуска: он считается до
    // записи и уходит уборкой после своего окна, как любой потолок
    const left = (await countUserRows(db, steamid)).filter((r) => r.rows > 0)
    expect(left.map((r) => r.table)).toEqual(['forget_marks', 'rate_limits'])
  })
})

describe('/api/whatsnew/feedlink: ключ', () => {
  test('ключ в ответе, в базе — только его отпечаток', async () => {
    const steamid = await signInAs(db, 'openid')
    const key = await keyOf(await issue())

    expect(await feedLinkOwner(db, feedTokenHash(key))).toBe(steamid)
    const cells = await db.execute('SELECT * FROM feed_links')
    expect(JSON.stringify(cells.rows)).not.toContain(key)
  })

  test('ответ с ключом не кэшируется нигде', async () => {
    await signInAs(db, 'openid')
    const res = await issue()
    const cc = res.headers.get('Cache-Control') ?? ''
    expect(cc).toContain('no-store')
    expect(cc).toContain('private')
  })

  test('перевыпуск по просьбе: новый ключ, прежняя ссылка больше не открывает', async () => {
    const steamid = await signInAs(db, 'openid')
    const first = await keyOf(await issue())
    const second = await keyOf(await reissue())

    expect(second).not.toBe(first)
    expect(await feedLinkOwner(db, feedTokenHash(first))).toBeNull()
    expect(await feedLinkOwner(db, feedTokenHash(second))).toBe(steamid)
    expect(await linkRows()).toBe(1)
  })

  /**
   * Страница знает о ссылке по своему первому кадру, а он бывает старым:
   * «назад» с патча достаёт /whatsnew из роутерного кэша без ссылки, вторая
   * вкладка открыта до выпуска. «Получить ссылку» оттуда не просит замены —
   * и ссылка, которую человек только что положил в ридер, обязана уцелеть.
   */
  test('без просьбы заменить — 409 exists с датой живой ссылки, ничего не записано', async () => {
    const steamid = await signInAs(db, 'openid')
    const kept = await keyOf(await issue())

    vi.setSystemTime((T0 + 600) * 1000)
    // Пустое тело, мусор и replace не-true — всё это «не просили»
    for (const body of [{ replace: false }, {}, 'не json', { replace: 'true' }, { replace: 1 }]) {
      const res = await issue(body)
      expect(res.status, JSON.stringify(body)).toBe(409)
      expect(await res.json()).toEqual({ error: 'exists', since: T0 })
      expect(res.headers.get('Cache-Control') ?? '').toContain('no-store')
    }
    expect(await feedLinkOwner(db, feedTokenHash(kept))).toBe(steamid)
    expect(await getFeedLink(db, steamid)).toEqual({ createdAt: T0 })
    expect(await linkRows()).toBe(1)
  })

  /** Разбор, которым строка FeedLink узнаёт «уже есть», читает ровно этот ответ */
  test('ответ 409 узнаёт клиентский разбор — страница переспросит, а не скажет «не получилось»', async () => {
    await signInAs(db, 'openid')
    await issue()
    expect(await issueReply(await issue())).toEqual({ kind: 'exists', since: T0 })
    expect((await issueReply(await reissue())).kind).toBe('shown')
  })

  test('отключение: ссылка гаснет, повтор — тоже 200', async () => {
    const steamid = await signInAs(db, 'openid')
    const key = await keyOf(await issue())

    const res = await disable()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(await feedLinkOwner(db, feedTokenHash(key))).toBeNull()
    expect(await getFeedLink(db, steamid)).toBeNull()
    expect((await disable()).status).toBe(200)
    // После отключения «Получить ссылку» выпускает без всякой просьбы
    expect((await issue()).status).toBe(200)
  })
})

describe('/api/whatsnew/feedlink: потолок частоты', () => {
  test('выпуск — под потолком на человека; сверх — 429 с Retry-After', async () => {
    const steamid = await signInAs(db, 'openid')
    for (let i = 0; i < FEED_LINK_LIMIT; i++) expect((await reissue()).status).toBe(200)

    const over = await reissue()
    expect(over.status).toBe(429)
    expect(Number(over.headers.get('Retry-After'))).toBeGreaterThan(0)

    // Счётчик ключуется steamid — forgetUser находит его по ':' + steamid + ':'
    const keys = await db.execute("SELECT key FROM rate_limits WHERE key LIKE 'feedlink:%'")
    expect(keys.rows.map((r) => String(r.key)).every((k) => k.includes(`:${steamid}:`))).toBe(true)
  })

  /**
   * Отключение — сама защита: ссылка утекла, и гасят её сейчас. С общим
   * потолком тот, кто сидит в чужой сессии, десятком выпусков запирал бы
   * владельцу «Отключить» на час.
   */
  test('отключение потолком не заперто: выпуски выбрали потолок, а «Отключить» всё равно гасит ссылку', async () => {
    const steamid = await signInAs(db, 'openid')
    for (let i = 0; i < FEED_LINK_LIMIT + 3; i++) await reissue()
    expect((await reissue()).status).toBe(429)
    expect(await getFeedLink(db, steamid)).not.toBeNull()

    const res = await disable()
    expect(res.status).toBe(200)
    expect(await getFeedLink(db, steamid)).toBeNull()
    for (let i = 0; i < FEED_LINK_LIMIT; i++) expect((await disable()).status).toBe(200)
  })
})
