import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { countUserRows, feedLinkOwner, forgetUser, issueFeedLink, type Db } from '@/lib/db'
import { feedTokenHash, newFeedToken } from '@/lib/feedlink'
import { MUTE_COOKIE } from '@/lib/mutetags'
import { SESSION_COOKIE, currentSession } from '@/lib/server'
import { forgetSessionCache } from '@/lib/sessions'
import { signOutReply } from '@/lib/signoutreply'
import { setTestCookie } from '@/lib/testing/headers'
import { STEAMID_OF, breakDbOn, freshDb, post, signIn, signInAs, signOut } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Выход. Держит три обещания: кука гасится всегда и первой, обычный выход
 * трогает только это устройство, а «везде» — только у доказанного входа
 * через Steam (иначе чужой по ссылке на профиль выкидывал бы владельца со
 * всех устройств).
 *
 * «Везде» гасит и секретную ссылку на личную RSS-ленту: её жмут, когда
 * доступ мог утечь, а ссылка — тоже доступ, выпущенный из сессии.
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

const logout = (all = false) => POST(post(`/api/auth/logout${all ? '?scope=all' : ''}`))

/** Кука сессии в ответе погашена */
const cleared = (res: Response) =>
  res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=;`) && /Max-Age=0/i.test(c))

/** Кука «Не предлагать» погашена — по тому же пути, с которым её ставит квиз */
const mutesCleared = (res: Response) =>
  res.headers
    .getSetCookie()
    .some((c) => c.startsWith(`${MUTE_COOKIE}=;`) && /Max-Age=0/i.test(c) && /Path=\/(;|$)/i.test(c))

/** Выпустить человеку RSS-ссылку — вернуть отпечаток её ключа */
async function feedLink(steamid: string): Promise<string> {
  const hash = feedTokenHash(newFeedToken())
  await issueFeedLink(db, { steamid, sid: 'sid-feed', tokenHash: hash, nowSec: T0, replace: true })
  return hash
}

/** Жива ли сессия с этим токеном — как её увидел бы следующий запрос */
async function alive(token: string): Promise<boolean> {
  setTestCookie(SESSION_COOKIE, token)
  forgetSessionCache()
  return (await currentSession()) !== null
}

/**
 * Отметка отзыва строки сессии — прямо из базы. Жива ли сессия «глазами
 * запроса» (alive) здесь не спросить: в тестах обрыва getDb отдаёт сломанную
 * базу, и проверка состояния открылась бы на отказе.
 */
async function revokedAt(sid: string): Promise<unknown> {
  const res = await db.execute({ sql: 'SELECT revoked_at FROM sessions WHERE sid = ?', args: [sid] })
  return res.rows[0]?.revoked_at ?? null
}

async function sessionsFrom(steamid: string): Promise<unknown> {
  const res = await db.execute({ sql: 'SELECT sessions_from FROM users WHERE steamid = ?', args: [steamid] })
  return res.rows[0]?.sessions_from ?? null
}

describe('/api/auth/logout', () => {
  test('гость и мусорная кука — 200, кука погашена', async () => {
    signOut()
    const guest = await logout()
    expect(guest.status).toBe(200)
    expect(await guest.json()).toEqual({ ok: true })
    expect(cleared(guest)).toBe(true)

    setTestCookie(SESSION_COOKIE, 'не-токен')
    const junk = await logout()
    expect(junk.status).toBe(200)
    expect(cleared(junk)).toBe(true)
  })

  /*
   * «Не предлагать» (lib/mutetags.ts) — про человека, а не про браузер:
   * следующий вошедший молча получал бы выдачу без того, что запретил не он.
   * Гасится на любом пути ответа — и на гостевом, и на том, что пересобирает
   * ответ после сбоя базы.
   */
  test('выход гасит и «Не предлагать» — на любом пути ответа', async () => {
    signOut()
    expect(mutesCleared(await logout())).toBe(true)
    await signIn(db, STEAMID_OF.openid, { verified: true })
    expect(mutesCleared(await logout())).toBe(true)
    await signIn(db, STEAMID_OF.openid, { verified: true })
    breakDbOn(db, 'feed_links')
    expect(mutesCleared(await logout(true))).toBe(true)
  })

  test('обычный выход гасит только это устройство', async () => {
    const phone = await signIn(db, STEAMID_OF.openid, { verified: true })
    const laptop = await signIn(db, STEAMID_OF.openid, { verified: true })
    const rss = await feedLink(STEAMID_OF.openid)
    const res = await logout()
    expect(await res.json()).toEqual({ ok: true })
    expect(cleared(res)).toBe(true)
    expect(await alive(laptop.token)).toBe(false)
    expect(await alive(phone.token)).toBe(true)
    // Ридер — не это устройство: обычный выход подписку не рвёт
    expect(await feedLinkOwner(db, rss)).toBe(STEAMID_OF.openid)
  })

  test('«везде» у входа через Steam гасит все устройства и старые токены', async () => {
    const phone = await signIn(db, STEAMID_OF.openid, { verified: true })
    await signIn(db, STEAMID_OF.openid, { verified: true })
    vi.setSystemTime((T0 + 60) * 1000)
    const res = await logout(true)
    expect(await res.json()).toEqual({ ok: true })
    expect(cleared(res)).toBe(true)
    expect(await alive(phone.token)).toBe(false)
    expect(await sessionsFrom(STEAMID_OF.openid)).not.toBeNull()
  })

  /*
   * Тот же минутный кэш, но после «Удалить всё обо мне» на соседнем
   * экземпляре. Выход верит кэшу, и телефон проходил в «везде», а пачка
   * отзыва ставила sessions_from UPSERT'ом без условия — и заводила строку
   * users удалённому, которой уборка настоящих людей не трогает. Человеку
   * сказали «останется только отметка», а осталась ещё и строка профиля.
   * Удаление здесь — прямо в базе, мимо forgetSessionCache, как его увидел
   * бы соседний экземпляр.
   */
  test('«везде» от сессии, удалившей всё на другом экземпляре, строку users не заводит', async () => {
    const steamid = STEAMID_OF.openid
    await signIn(db, steamid, { verified: true })
    expect(await currentSession()).not.toBeNull()
    await forgetUser(db, steamid, { signOutFrom: T0 + 1 })
    vi.setSystemTime((T0 + 2) * 1000)
    // Окно настоящее: кэш ещё считает сессию живой и подтверждённой
    expect((await currentSession())?.verified).toBe(true)

    const res = await logout(true)
    expect(res.status).toBe(200)
    // Гасить нечего — отметка уже отрезала всё, что выдано до неё: «вышел
    // везде» — правда
    expect(await res.json()).toEqual({ ok: true })
    expect(cleared(res)).toBe(true)
    expect(mutesCleared(res)).toBe(true)
    const left = (await countUserRows(db, steamid)).filter((r) => r.rows > 0)
    expect(left).toEqual([{ table: 'forget_marks', rows: 1 }])
  })

  test('«везде» гасит и RSS-ссылку: её мог выпустить тот, из-за кого жмут «везде»', async () => {
    const rss = await feedLink(STEAMID_OF.openid)
    await signIn(db, STEAMID_OF.openid, { verified: true })
    expect(await (await logout(true)).json()).toEqual({ ok: true })
    expect(await feedLinkOwner(db, rss)).toBeNull()
  })

  /**
   * Два пути, которыми «везде» делает меньше обещанного, — и оба обязаны
   * быть видны в ответе: кнопка (components/SignOut) по нему решает, увести
   * ли на главную, как после удачи, или сказать, что остальные устройства и
   * ссылка на RSS живы (lib/signoutreply). Кука гасится в обоих: на этом
   * устройстве человек вышел.
   */
  test('«везде», а база отзыв не записала — кука погашена, revoked: false, ссылка жива', async () => {
    const phone = await signIn(db, STEAMID_OF.openid, { verified: true })
    const rss = await feedLink(STEAMID_OF.openid)
    const laptop = await signIn(db, STEAMID_OF.openid, { verified: true })
    // пачка revokeAllSessions падает целиком — на её DELETE из feed_links
    breakDbOn(db, 'feed_links')
    const res = await logout(true)
    expect(res.status).toBe(200)
    expect(cleared(res)).toBe(true)
    expect(await res.clone().json()).toEqual({ ok: true, revoked: false })
    expect(await signOutReply(true, res)).toBe('partial')
    // ни одна сессия не погашена, ссылка жива — ровно поэтому «вышел везде» не говорим
    expect(await feedLinkOwner(db, rss)).toBe(STEAMID_OF.openid)
    expect(await revokedAt(phone.sid)).toBeNull()
    expect(await revokedAt(laptop.sid)).toBeNull()
    expect(await sessionsFrom(STEAMID_OF.openid)).toBeNull()
  })

  test('«везде», а состояние сессии не прочлось — погашено это устройство, и сказано прямо', async () => {
    const phone = await signIn(db, STEAMID_OF.openid, { verified: true })
    const rss = await feedLink(STEAMID_OF.openid)
    const laptop = await signIn(db, STEAMID_OF.openid, { verified: true })
    // холодный экземпляр: кэша состояния нет, а чтение его падает — и
    // сессия, открытая на отказе (LIVE в lib/sessions), не подтверждена
    forgetSessionCache()
    breakDbOn(db, 'LEFT JOIN sessions')
    const res = await logout(true)
    expect(cleared(res)).toBe(true)
    expect(((await res.clone().json()) as { scope?: string }).scope).toBe('this-device')
    expect(await signOutReply(true, res)).toBe('partial')
    // погашено одно это устройство; остальные и ссылка живы
    expect(await revokedAt(laptop.sid)).not.toBeNull()
    expect(await revokedAt(phone.sid)).toBeNull()
    expect(await sessionsFrom(STEAMID_OF.openid)).toBeNull()
    expect(await feedLinkOwner(db, rss)).toBe(STEAMID_OF.openid)
  })

  test('«везде» у сессии по ссылке и у демо — только это устройство, и сказано прямо', async () => {
    for (const kind of ['claimed', 'demo'] as const) {
      const steamid = STEAMID_OF[kind]
      const other = await signIn(db, steamid)
      // Ссылку владельца сессия по ссылке на профиль не гасит: иначе чужой
      // рвал бы ему подписку тем же перевёртышем прав, что и выход везде
      const rss = await feedLink(steamid)
      await signInAs(db, kind)
      const res = await logout(true)
      const body = (await res.json()) as { scope?: string; reason?: string }
      expect(body.scope).toBe('this-device')
      expect(body.reason).toBeTruthy()
      // кука погашена и в этой ветке: ответ пересобран из заголовков
      expect(cleared(res)).toBe(true)
      expect(await alive(other.token)).toBe(true)
      expect(await sessionsFrom(steamid)).toBeNull()
      expect(await feedLinkOwner(db, rss)).toBe(steamid)
    }
  })
})
