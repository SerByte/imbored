import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  dropFeedLink,
  forgetUser,
  issueFeedLink,
  saveLibrarySnapshot,
  upsertGameMeta,
  upsertNewsItems,
  upsertUser,
  type Db,
  type StoredNews,
} from '@/lib/db'
import { FEED_POLL_LIMIT, feedTokenHash, newFeedToken } from '@/lib/feedlink'
import { breakDbOn, freshDb, params, signInAs, signOut } from '@/lib/testing/route'
import type { GameMeta } from '@/lib/types'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Личная RSS-лента по секретной ссылке.
 *
 * Лента — это вкладка «В твоих играх» с /whatsnew и ничего сверх неё: те же
 * свежие крупные патчи своих игр, без добивки чужими и без имени профиля.
 * Ключ — единственное доказательство (ридер ходит без куки), поэтому всё,
 * что не похоже на живой ключ, — 404, а отозванный гаснет сразу.
 */

const NOW = 1_760_000_000
const DAY = 86_400
const NICK = 'Тайный Ник'

let db: Db
let me: string
let key: string

/** Выпустить ссылку на ключ — как роут после подтверждения замены */
function give(k: string, at: number) {
  return issueFeedLink(db, { steamid: me, sid: 'sid-feed', tokenHash: feedTokenHash(k), nowSec: at, replace: true })
}

function game(appid: number): GameMeta {
  return { appid, name: `Игра ${appid}`, tags: { Action: 100 }, genres: [], categories: [] }
}

function patch(appid: number, daysAgo: number, rank = 50_000): StoredNews {
  return {
    appid,
    gid: `${appid}0`,
    title: `Обновление ${appid}`,
    url: `https://store.steampowered.com/news/app/${appid}/view/${appid}0`,
    publishedAt: NOW - daysAgo * DAY,
    kind: 'patch',
    scale: 'major',
    blocks: [{ kind: 'p', runs: [{ text: `Починили всё в ${appid}` }] }],
    bodyHash: `h${appid}`,
    rank,
  }
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW * 1000)
  db = await freshDb()
  me = await signInAs(db, 'openid')
  await upsertUser(db, { steamid: me, personaName: NICK }, NOW)
  for (const appid of [620, 730, 570]) await upsertGameMeta(db, game(appid), NOW)
  await upsertNewsItems(
    db,
    [
      // своя игра, патч трёхдневный — в ленте
      patch(620, 3),
      // своя, но патч старше трёх месяцев — как и на /whatsnew, не новость
      patch(730, 200),
      // чужая популярная — добивка страницы, в ридер не идёт
      patch(570, 1, 900_000),
    ],
    NOW,
  )
  await saveLibrarySnapshot(
    db,
    me,
    [
      { appid: 620, name: 'Игра 620', playtimeForever: 600, playtime2Weeks: 0 },
      { appid: 730, name: 'Игра 730', playtimeForever: 300, playtime2Weeks: 0 },
    ],
    NOW - 60,
  )
  key = newFeedToken()
  await give(key, NOW)
  // Ридер ходит без нашей куки — лента обязана открываться и так
  signOut()
})

afterEach(() => {
  vi.useRealTimers()
})

const poll = (token: string) => GET(new Request(`http://localhost/whatsnew/feed/${token}`), params({ token }))

describe('/whatsnew/feed/[token]: что в ленте', () => {
  test('вкладка «В твоих играх»: свежий патч своей игры — без старья и без чужих', async () => {
    const res = await poll(key)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/rss+xml; charset=utf-8')
    const xml = await res.text()
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain('/game/620/news/6200')
    expect(xml).toContain('Починили всё в 620')
    expect(xml).not.toContain('/game/730/')
    expect(xml).not.toContain('/game/570/')
    expect(xml.match(/<item>/g)).toHaveLength(1)
  })

  test('в ленте нет ни SteamID, ни имени профиля, ни самого ключа', async () => {
    const xml = await (await poll(key)).text()
    expect(xml).not.toContain(me)
    expect(xml).not.toContain(NICK)
    // адрес ленты — секрет: atom:link rel=self не повторяет его в теле
    expect(xml).not.toContain(key)
    expect(xml).not.toContain('<atom:link')
  })

  test('чужая кука лент не меняет: лента — по ключу, а не по сессии', async () => {
    await signInAs(db, 'demo')
    const xml = await (await poll(key)).text()
    expect(xml).toContain('/game/620/news/6200')
  })

  test('свежего нет — пустой, но валидный канал, а не общая лента', async () => {
    await saveLibrarySnapshot(
      db,
      me,
      [{ appid: 730, name: 'Игра 730', playtimeForever: 300, playtime2Weeks: 0 }],
      NOW,
    )
    const res = await poll(key)
    expect(res.status).toBe(200)
    const xml = await res.text()
    expect(xml).toContain('<channel>')
    expect(xml).not.toContain('<item>')
  })
})

describe('/whatsnew/feed/[token]: ключ', () => {
  test('мусор вместо ключа — 404 без похода в базу', async () => {
    breakDbOn(db, 'feed_links')
    for (const junk of ['abc', key.toUpperCase(), `${key}0`, feedTokenHash(key)]) {
      expect((await poll(junk)).status, junk).toBe(404)
    }
  })

  test('похожий на ключ, но не выпущенный — 404', async () => {
    expect((await poll(newFeedToken())).status).toBe(404)
  })

  test('перевыпуск, отключение и «удалить всё» гасят ссылку сразу', async () => {
    const next = newFeedToken()
    await give(next, NOW + 1)
    expect((await poll(key)).status).toBe(404)
    expect((await poll(next)).status).toBe(200)

    await dropFeedLink(db, me)
    expect((await poll(next)).status).toBe(404)

    const again = newFeedToken()
    await give(again, NOW + 2)
    await forgetUser(db, me)
    expect((await poll(again)).status).toBe(404)
  })
})

describe('/whatsnew/feed/[token]: кэш и поиск', () => {
  /**
   * Ответ персональный. CDN кэширует по адресу, и s-maxage положил бы чужую
   * ленту в общий кэш, откуда её не достать ни перевыпуском, ни удалением:
   * отозванная ссылка продолжала бы отвечать до конца срока. private —
   * копию держит только сам читатель.
   */
  test('лента — только в кэше читателя: private, без s-maxage', async () => {
    const res = await poll(key)
    const cc = res.headers.get('Cache-Control') ?? ''
    expect(cc).toContain('private')
    expect(cc).not.toMatch(/s-maxage|public/)
  })

  test('отказ не кэшируется вовсе: перевыпущенная ссылка не застрянет в 404', async () => {
    const res = await poll(newFeedToken())
    expect(res.headers.get('Cache-Control')).toContain('no-store')
  })

  test('noindex и на ленте, и на отказе', async () => {
    expect((await poll(key)).headers.get('X-Robots-Tag')).toBe('noindex')
    expect((await poll('abc')).headers.get('X-Robots-Tag')).toBe('noindex')
  })
})

describe('/whatsnew/feed/[token]: потолок опросов', () => {
  test('утёкшую ссылку не дёрнуть скриптом: сверх потолка — 429 с Retry-After', async () => {
    for (let i = 0; i < FEED_POLL_LIMIT; i++) expect((await poll(key)).status).toBe(200)
    const over = await poll(key)
    expect(over.status).toBe(429)
    expect(Number(over.headers.get('Retry-After'))).toBeGreaterThan(0)
    // Счётчик — по steamid владельца: forgetUser находит его вместе с остальным
    const keys = await db.execute("SELECT key FROM rate_limits WHERE key LIKE 'feedrss:%'")
    expect(keys.rows.map((r) => String(r.key)).every((k) => k.includes(`:${me}:`))).toBe(true)
  })
})
