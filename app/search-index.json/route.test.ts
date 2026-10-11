import fs from 'node:fs'
import path from 'node:path'
import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { readSearchIndex } from '@/lib/catalogsearch'
import { upsertGameMeta, type Db } from '@/lib/db'
import { freshDb } from '@/lib/testing/route'
import * as route from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

const T0 = 1_760_000_000
let db: Db

async function put(appid: number, name: string, reviews: number, alive = 1): Promise<void> {
  await upsertGameMeta(db, { appid, name, tags: { FPS: 100 }, genres: [], categories: [], reviewsTotal: reviews }, T0)
  await db.execute({
    sql: 'UPDATE games SET alive = ?, tag_count = 3, superseded_by = NULL WHERE appid = ?',
    args: [alive, appid],
  })
}

beforeEach(async () => {
  db = await freshDb()
  await put(570, 'Dota 2', 2000)
  await put(730, 'Counter-Strike 2', 9000)
  await put(40, 'Мёртвая игра', 5000, 0)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/** База отвечает, но запрос падает — так выглядит таймаут Turso посреди перегенерации */
function queriesFail(): void {
  const timeout = () => Promise.reject(new Error('Turso: operation timed out'))
  db.execute = timeout as Db['execute']
  db.batch = timeout as Db['batch']
}

describe('индекс «Найти игру»', () => {
  test('JSON колонками, живые игры по числу отзывов — и его читает клиентский поиск', async () => {
    const res = await route.GET()
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
    const body = await res.json()
    expect(body).toEqual({ ids: [730, 570], names: ['Counter-Strike 2', 'Dota 2'] })
    expect(readSearchIndex(body)?.map((e) => e.appid)).toEqual([730, 570])
  })

  /*
   * GET-ручки по умолчанию не кэшируются вовсе (docs: route handlers,
   * Caching): без force-static каждый, кто открыл поиск, будил бы функцию и
   * читал из базы весь каталог. Число — литералом: Next читает revalidate
   * только так, импорт он не разберёт.
   */
  test('статический, с перегенерацией раз в сутки', () => {
    expect(route.dynamic).toBe('force-static')
    expect(route.revalidate).toBe(86_400)
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8')
    expect(src).toMatch(/^export const revalidate = 86_400$/m)
  })

  test('при перегенерации ошибка уходит наружу — ISR оставит вчерашний индекс', async () => {
    queriesFail()
    await expect(route.GET()).rejects.toThrow(/timed out/)
  })

  test('на сборке без базы — пустой индекс, а не упавший build', async () => {
    vi.stubEnv('NEXT_PHASE', PHASE_PRODUCTION_BUILD)
    queriesFail()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await route.GET()
    errors.mockRestore()
    expect(await res.json()).toEqual({ ids: [], names: [] })
  })
})
