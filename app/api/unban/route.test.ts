import { beforeEach, describe, expect, test, vi } from 'vitest'
import { listBanned, logFeedback, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, post, signInAs } from '@/lib/testing/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

// Настоящий revalidateTag вне сервера Next бросает; здесь важен только тег
const revalidated = vi.hoisted(() => [] as Array<[string, unknown]>)
vi.mock('next/cache', () => ({
  revalidateTag: (tag: string, profile: unknown) => {
    revalidated.push([tag, profile])
  },
}))

/**
 * Снятие бана удаляет пользовательские строки (как и /api/unlike).
 * По вставленной ссылке на чужой профиль это было бы «вернуть человеку всё,
 * что он выгнал», поэтому права те же, что у записи фидбека.
 */

let db: Db

beforeEach(async () => {
  db = await freshDb()
  revalidated.length = 0
})

async function ban(steamid: string) {
  await logFeedback(db, { steamid, appid: 620, action: 'banned' }, nowSec())
}

describe('/api/unban', () => {
  test('без сессии — 401 nosession', async () => {
    const res = await POST(post('/api/unban', { appid: 620 }))
    expect(res.status).toBe(401)
  })

  test('сессия по ссылке — 403 needsteam, бан остаётся на месте', async () => {
    const steamid = await signInAs(db, 'claimed')
    await ban(steamid)
    const res = await POST(post('/api/unban', { appid: 620 }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'needsteam' })
    expect(await listBanned(db, steamid)).toHaveLength(1)
  })

  test('вход через Steam и демо бан снимают', async () => {
    for (const kind of ['openid', 'demo'] as const) {
      const steamid = await signInAs(db, kind)
      await ban(steamid)
      const res = await POST(post('/api/unban', { appid: 620 }))
      expect(res.status, kind).toBe(200)
      expect(await listBanned(db, steamid), kind).toEqual([])
    }
  })

  test('снятый бан сбрасывает кэш портрета: игра снова может стать стартовой', async () => {
    const steamid = await signInAs(db, 'openid')
    await ban(steamid)
    await POST(post('/api/unban', { appid: 620 }))
    expect(revalidated).toEqual([[`portrait:${steamid}`, 'max']])
  })

  /*
   * Бана не было — портрету меняться не от чего, и сбрасывать кэш незачем.
   * Иначе повтор той же кнопки (или цикл скрипта) сбрасывал бы его на каждый
   * запрос, хотя DELETE ничего не нашёл.
   */
  test('снимать было нечего — кэш портрета не сбрасывается, ответ тот же', async () => {
    const steamid = await signInAs(db, 'openid')
    const res = await POST(post('/api/unban', { appid: 620 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(revalidated).toEqual([])
    // повтор после настоящего снятия — тоже пустой
    await ban(steamid)
    await POST(post('/api/unban', { appid: 620 }))
    await POST(post('/api/unban', { appid: 620 }))
    expect(revalidated).toEqual([[`portrait:${steamid}`, 'max']])
  })

  test('отказ в правах до сброса не доходит', async () => {
    const steamid = await signInAs(db, 'claimed')
    await ban(steamid)
    await POST(post('/api/unban', { appid: 620 }))
    expect(revalidated).toEqual([])
  })
})
