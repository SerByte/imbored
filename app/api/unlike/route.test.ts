import { beforeEach, describe, expect, test, vi } from 'vitest'
import { listLiked, logFeedback, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, post, signInAs } from '@/lib/testing/route'
import { POST as feedback } from '../feedback/route'
import { POST } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Снятие «зашло» удаляет строки фидбека, поэтому права — те же, что у записи:
 * по вставленной ссылке на чужой профиль вкус не переписывается.
 */

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

async function like(steamid: string) {
  await logFeedback(db, { steamid, appid: 620, action: 'liked' }, nowSec())
}

describe('/api/unlike', () => {
  test('без сессии — 401 nosession', async () => {
    const res = await POST(post('/api/unlike', { appid: 620 }))
    expect(res.status).toBe(401)
  })

  test('сессия по ссылке — 403 needsteam, оценка остаётся на месте', async () => {
    const steamid = await signInAs(db, 'claimed')
    await like(steamid)
    const res = await POST(post('/api/unlike', { appid: 620 }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'needsteam' })
    expect(await listLiked(db, steamid)).toHaveLength(1)
  })

  test('вход через Steam и демо оценку снимают', async () => {
    for (const kind of ['openid', 'demo'] as const) {
      const steamid = await signInAs(db, kind)
      await like(steamid)
      const res = await POST(post('/api/unlike', { appid: 620 }))
      expect(res.status, kind).toBe(200)
      expect(await listLiked(db, steamid), kind).toEqual([])
    }
  })

  test('мусор вместо appid — 400, ничего не удалено', async () => {
    const steamid = await signInAs(db, 'openid')
    await like(steamid)
    for (const body of [{}, { appid: 0 }, { appid: 1.5 }, { appid: 'x' }, null]) {
      const res = await POST(post('/api/unlike', body))
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(await listLiked(db, steamid)).toHaveLength(1)
  })

  /*
   * Второе нажатие сердца у героя /play и /daily (lib/unlike) несёт строку,
   * которую легло первое, — /api/feedback отдаёт её в ответ на «Зашло». Сердце
   * героя о прежних «зашло» не знает (unlikeGame в lib/db), и снятие всего
   * стирало бы и лайк недельной давности: два нажатия обязаны вернуть
   * сервер туда, где он был до них.
   */
  describe('снятие у героя — только строка своего нажатия', () => {
    const tap = async () => {
      const res = await feedback(post('/api/feedback', { appid: 620, action: 'liked', ctx: { source: 'play' } }))
      expect(res.status).toBe(200)
      return ((await res.json()) as { row: number | null }).row
    }

    test('«Зашло» недельной давности переживает нажатие и снятие', async () => {
      const steamid = await signInAs(db, 'openid')
      const weekAgo = nowSec() - 7 * 86_400
      await logFeedback(db, { steamid, appid: 620, action: 'liked' }, weekAgo)

      const row = await tap()
      expect(row).toEqual(expect.any(Number))
      expect((await POST(post('/api/unlike', { appid: 620, row }))).status).toBe(200)

      expect(await listLiked(db, steamid)).toEqual([{ appid: 620, at: weekAgo }])
    })

    /*
     * «Зашло» час назад — и нажатие ничего не вставило (суточный дедуп в
     * lib/db): строки нет, снимать сердцу нечего, и прежнее остаётся.
     * Сюда такое снятие и не доходит — lib/unlike его не шлёт, — а роут
     * без строки снял бы всё, как полка.
     */
    test('нажатие, проглоченное дедупом, строки не отдаёт', async () => {
      const steamid = await signInAs(db, 'openid')
      await logFeedback(db, { steamid, appid: 620, action: 'liked' }, nowSec() - 3600)
      expect(await tap()).toBeNull()
      expect(await listLiked(db, steamid)).toHaveLength(1)
    })

    test('строка своего нажатия снимается, сердце и сервер — как до него', async () => {
      const steamid = await signInAs(db, 'openid')
      const row = await tap()
      expect(await listLiked(db, steamid)).toHaveLength(1)
      expect((await POST(post('/api/unlike', { appid: 620, row }))).status).toBe(200)
      expect(await listLiked(db, steamid)).toEqual([])
    })

    test('мусор вместо строки — 400, ничего не удалено', async () => {
      const steamid = await signInAs(db, 'openid')
      await like(steamid)
      for (const row of [0, -3, 1.5, 'x', null, Number.MAX_SAFE_INTEGER + 2]) {
        const res = await POST(post('/api/unlike', { appid: 620, row }))
        expect(res.status, JSON.stringify(row)).toBe(400)
      }
      expect(await listLiked(db, steamid)).toHaveLength(1)
    })
  })
})
