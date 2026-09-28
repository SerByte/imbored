import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getSharedPick, upsertGamesMeta, type Db } from '@/lib/db'
import { pickShareSig } from '@/lib/pickshare'
import { nowSec, sessionSecret } from '@/lib/server'
import { SHARED_PICK_ID_RE } from '@/lib/sharedpick'
import { freshDb, post, signInAs, STEAMID_OF } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * «Отправить другу» публикует текст на imbored.cc/pick/…, поэтому здесь
 * закреплено, ЧТО может стать публичным: только текст, который сервер сам
 * подписал для этой сессии, только пишущей сессией и только про игру, у
 * которой есть страница.
 */

const TEXT = '«Portal 2» ждёт с покупки — вечер на головоломки.'

let db: Db

beforeEach(async () => {
  db = await freshDb()
  await upsertGamesMeta(
    db,
    [{ appid: 620, name: 'Portal 2', tags: { Puzzle: 100 }, genres: [], categories: [] }],
    nowSec(),
  )
})

/** Тело, как его шлёт кнопка: текст и подпись из выдачи этой сессии */
function body(steamid: string, over: Partial<{ appid: number; source: string; kind: string; text: string }> = {}) {
  const v = { appid: 620, source: 'untouched', kind: 'play', text: TEXT, ...over }
  return { ...v, sig: pickShareSig(sessionSecret(), { steamid, appid: v.appid, source: v.source, text: v.text }) }
}

async function share(b: unknown, ip = '203.0.113.7') {
  return POST(post('/api/pick', b, { 'x-forwarded-for': ip }))
}

describe('/api/pick: кто может', () => {
  test('без сессии — 401', async () => {
    const res = await share(body(STEAMID_OF.openid))
    expect(res.status).toBe(401)
  })

  test('сессия по ссылке — 403 needsteam: это чужая библиотека', async () => {
    const steamid = await signInAs(db, 'claimed')
    const res = await share(body(steamid))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'needsteam' })
  })

  test('вход через Steam и демо — ссылка, и в ответе нет steamid', async () => {
    for (const kind of ['openid', 'demo'] as const) {
      const steamid = await signInAs(db, kind)
      const res = await share(body(steamid))
      expect(res.status, kind).toBe(200)
      const got = (await res.json()) as { id: string }
      expect(Object.keys(got), kind).toEqual(['id'])
      expect(got.id, kind).toMatch(SHARED_PICK_ID_RE)
      expect(JSON.stringify(got), kind).not.toContain(steamid)
    }
  })
})

describe('/api/pick: что может стать публичным', () => {
  test('подпись чужой сессии — 403 badsig, ничего не записано', async () => {
    await signInAs(db, 'openid')
    const res = await share(body(STEAMID_OF.demo))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'badsig' })
    expect(await countPicks()).toBe(0)
  })

  test('подменённый текст, игра или источник — 403 badsig', async () => {
    const steamid = await signInAs(db, 'openid')
    const b = body(steamid)
    for (const tampered of [
      { ...b, text: 'Заходи на мой сайт: example.com' },
      { ...b, appid: 621 },
      { ...b, source: 'new' },
    ]) {
      const res = await share(tampered)
      expect(res.status, JSON.stringify(tampered)).toBe(403)
    }
    expect(await countPicks()).toBe(0)
  })

  test('мусор в теле — 400 badinput', async () => {
    await signInAs(db, 'openid')
    for (const b of [null, {}, { appid: 620 }, 'не json']) {
      const res = await share(b)
      expect(res.status, JSON.stringify(b)).toBe(400)
    }
  })

  test('игры нет в каталоге — 404: страница рисуется по её строке', async () => {
    const steamid = await signInAs(db, 'openid')
    const res = await share(body(steamid, { appid: 999_999 }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'nogame' })
  })

  test('хранится очищенный текст, автор — только в базе', async () => {
    const steamid = await signInAs(db, 'openid')
    const raw = `  ${TEXT}\n‮ `
    const res = await share(body(steamid, { text: raw }))
    const { id } = (await res.json()) as { id: string }
    const pick = await getSharedPick(db, id, nowSec() - 60)
    expect(pick).toMatchObject({ id, appid: 620, source: 'untouched', kind: 'play', reason: TEXT })
    expect(pick).not.toHaveProperty('createdBy')
  })
})

describe('/api/pick: повтор и потолок', () => {
  test('через сутки — новая ссылка со своим сроком, а не вчерашняя строка', async () => {
    const steamid = await signInAs(db, 'openid')
    const a = (await (await share(body(steamid))).json()) as { id: string }
    // строка «вчерашняя»: сдвигаем её назад на сутки с запасом
    await db.execute({ sql: 'UPDATE shared_picks SET created_at = created_at - ? WHERE id = ?', args: [86_401, a.id] })
    const b = (await (await share(body(steamid))).json()) as { id: string }
    expect(b.id).not.toBe(a.id)
  })

  test('тот же текст игрой дня — своя ссылка: у страниц разные подписи', async () => {
    const steamid = await signInAs(db, 'openid')
    const play = (await (await share(body(steamid))).json()) as { id: string }
    const daily = (await (await share(body(steamid, { kind: 'daily' }))).json()) as { id: string }
    expect(daily.id).not.toBe(play.id)
    expect((await getSharedPick(db, daily.id, 0))?.kind).toBe('daily')
  })

  test('то же нажатие ещё раз — та же ссылка, другой текст — новая', async () => {
    const steamid = await signInAs(db, 'openid')
    const a = (await (await share(body(steamid))).json()) as { id: string }
    const b = (await (await share(body(steamid))).json()) as { id: string }
    expect(b.id).toBe(a.id)
    const c = (await (await share(body(steamid, { text: TEXT + ' Ещё.' }))).json()) as { id: string }
    expect(c.id).not.toBe(a.id)
    expect(await countPicks()).toBe(2)
  })

  test('двадцать в час на человека — дальше 429 с Retry-After', async () => {
    const steamid = await signInAs(db, 'openid')
    for (let i = 0; i < 20; i++) {
      const res = await share(body(steamid, { text: `${TEXT} ${i}` }))
      expect(res.status, `нажатие ${i}`).toBe(200)
    }
    const res = await share(body(steamid, { text: `${TEXT} ещё` }))
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(await countPicks()).toBe(20)
  })
})

async function countPicks(): Promise<number> {
  const res = await db.execute('SELECT COUNT(*) AS n FROM shared_picks')
  return Number(res.rows[0].n)
}
