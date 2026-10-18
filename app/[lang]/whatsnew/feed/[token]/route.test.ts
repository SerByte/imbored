import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  dropFeedLink,
  forgetUser,
  issueFeedLink,
  saveLibrarySnapshot,
  setNewsDigest,
  setNewsDigestEn,
  upsertGameMeta,
  upsertNewsItems,
  upsertUser,
  type Db,
  type StoredNews,
} from '@/lib/db'
import { FEED_POLL_LIMIT, feedTokenHash, newFeedToken } from '@/lib/feedlink'
import { breakDbOn, freshDb, listenDb, params, signInAs, signOut } from '@/lib/testing/route'
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

const poll = (token: string) => GET(new Request(`http://localhost/whatsnew/feed/${token}`), params({ lang: 'ru', token }))

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

  /**
   * ЦЕНА ОПРОСА (докблок роута): описание записи — пересказ, если он есть, и
   * тело патча ради него не нужно. Ридер ходит до шестидесяти раз в час, и
   * тридцать тел на каждый опрос — сотни килобайт из Turso ради строк,
   * которые в ленту не попадут.
   */
  test('у патча с пересказом описание — пересказ, а тело из базы не едет', async () => {
    await setNewsDigest(db, 620, '6200', { tldr: 'Коротко: починили всё.', scale: 'major' }, NOW)
    const bodies: unknown[] = []
    listenDb(db, (_sql, rows) => {
      for (const r of rows) if ('blocks_json' in r) bodies.push(r.blocks_json)
    })
    const xml = await (await poll(key)).text()
    expect(xml).toContain('<description>Коротко: починили всё.</description>')
    expect(xml).not.toContain('Починили всё в 620')
    expect(bodies).toEqual(['[]'])
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

  /*
   * Имя канала ридер показывает всегда — в списке подписок, над каждой
   * записью. Демо-личности выпуск открыт (FeedLink), но библиотека у неё
   * чужая: «твои игры» были бы той самой неправдой, которую строка на
   * /whatsnew ей уже не говорит («Патчи игр демо-библиотеки»). Владелец —
   * по ключу, а не по куке: ридер ходит без неё.
   */
  test('канал называет игры владельца ключа: свои — «твоих», демо — «демо-библиотеки»', async () => {
    const own = await (await poll(key)).text()
    expect(own).toContain('<title>Что нового в твоих играх — imbored</title>')
    expect(own).toContain('<description>Крупные патчи игр из твоей библиотеки — коротко и по-русски.</description>')

    const demo = await signInAs(db, 'demo')
    const demoKey = newFeedToken()
    await issueFeedLink(db, { steamid: demo, sid: 'sid-demo', tokenHash: feedTokenHash(demoKey), nowSec: NOW, replace: true })
    // Ридер демо-ссылки тоже без куки — и уж точно не с куки демо
    signOut()
    const res = await poll(demoKey)
    expect(res.status).toBe(200)
    const xml = await res.text()
    expect(xml).toContain('<title>Что нового в играх демо-библиотеки — imbored</title>')
    expect(xml).toContain('<description>Крупные патчи игр демо-библиотеки — коротко и по-русски.</description>')
    expect(xml).not.toContain('твоих играх')
    expect(xml).not.toContain('твоей библиотеки')
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

describe('/whatsnew/feed/[token]: язык', () => {
  /**
   * notFound() корневого layout до обработчика не доходит, а адрес под
   * чужим языком (/_x/whatsnew/feed/<ключ>) маршрут находит: лента
   * отдавалась бы и там — без noindex и с записью кэша на каждый «язык».
   */
  test('под чужим языком — 404, даже с живым ключом', async () => {
    const res = await GET(new Request(`http://localhost/_x/whatsnew/feed/${key}`), params({ lang: '_x', token: key }))
    expect(res.status).toBe(404)
    expect((await poll(key)).status).toBe(200)
  })
})

/**
 * Английская лента по тому же ключу: /en/whatsnew/feed/<ключ> (строка FeedLink
 * на /en ставит язык сама). Канал, заголовки записей и адреса — английские;
 * русского пересказа и русского тела на /en нет (docs/i18n.md, п. 8–9).
 */
describe('/en/whatsnew/feed/[token]: английская лента', () => {
  const pollEn = (token: string) =>
    GET(new Request(`http://localhost/en/whatsnew/feed/${token}`), params({ lang: 'en', token }))

  beforeEach(async () => {
    // Названия игр — английские, как в каталоге: кириллица в ленте тогда — только наша
    await upsertGameMeta(db, { ...game(620), name: 'Portal 2' }, NOW)
  })

  test('канал по-английски, язык en, адреса — английские страницы', async () => {
    const res = await pollEn(key)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toContain('private')
    const xml = await res.text()
    expect(xml).toContain("<title>What&apos;s new in your games — imbored</title>")
    expect(xml).toContain('<description>Major patches for games in your library, in short.</description>')
    expect(xml).toContain('<language>en</language>')
    expect(xml).toContain('<link>http://localhost:3000/en/whatsnew</link>')
    expect(xml).toContain('/en/game/620/news/6200')
  })

  test('английский пересказ — описание; русский заголовок без перевода — «{Game} update»', async () => {
    await setNewsDigest(db, 620, '6200', { tldr: 'Коротко: починили всё.', scale: 'major' }, NOW)
    await setNewsDigestEn(db, 620, '6200', { tldrEn: 'In short: fixed everything.' }, NOW)
    const xml = await (await pollEn(key)).text()
    expect(xml).toContain('<description>In short: fixed everything.</description>')
    expect(xml).toMatch(/<title>Portal 2: Update \([A-Z][a-z]{2} \d{1,2}, \d{4}\) — what changed<\/title>/)
    expect(xml).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('без английского пересказа русское тело не едет — описание из заголовка', async () => {
    const xml = await (await pollEn(key)).text()
    expect(xml.match(/<item>/g)).toHaveLength(1)
    expect(xml).not.toContain('Починили всё в 620')
    expect(xml).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('демо-ключ — лента демо-библиотеки, по-английски', async () => {
    const demo = await signInAs(db, 'demo')
    const demoKey = newFeedToken()
    await issueFeedLink(db, { steamid: demo, sid: 'sid-demo', tokenHash: feedTokenHash(demoKey), nowSec: NOW, replace: true })
    signOut()
    const xml = await (await pollEn(demoKey)).text()
    expect(xml).toContain("<title>What&apos;s new in the demo library&apos;s games — imbored</title>")
    expect(xml).not.toContain('your library')
  })

  test('русская лента по тому же ключу — прежняя', async () => {
    const xml = await (await poll(key)).text()
    expect(xml).toContain('<language>ru</language>')
    expect(xml).toContain('<link>http://localhost:3000/whatsnew</link>')
    expect(xml).toContain('Починили всё в 620')
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
