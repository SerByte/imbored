import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ROOT_ISR_FILES } from '@/lib/revalidate'
import { GET } from './route'

// Настоящий revalidatePath вне сервера Next бросает — копим адреса
const { revalidated } = vi.hoisted(() => ({ revalidated: [] as string[] }))
vi.mock('next/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/cache')>()),
  revalidatePath: (path: string) => {
    revalidated.push(path)
  },
}))

/**
 * /api/cron/revalidate — ручной сброс кэша по названным адресам вместо
 * Redeploy, который выбрасывает кэш ISR целиком (докблок роута).
 */

const SECRET = 'revalidate-test-secret-0123456789'
const ROOT = path.join(__dirname, '..', '..', '..', '..')

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', SECRET)
  revalidated.length = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function ask(paths: string[], headers: Record<string, string> = { 'x-cron-secret': SECRET }) {
  const url = new URL('https://imbored.test/api/cron/revalidate')
  for (const p of paths) url.searchParams.append('path', p)
  return GET(new Request(url, { headers }))
}

describe('/api/cron/revalidate', () => {
  test('без секрета — 401 и ни одной пометки', async () => {
    // заголовки HTTP — ByteString, поэтому чужой секрет тоже ASCII
    const tries: Array<Record<string, string>> = [{}, { 'x-cron-secret': 'wrong-secret-of-same-length-0123' }]
    for (const headers of tries) {
      const res = await ask(['/game/730'], headers)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'forbidden' })
    }
    expect(revalidated).toEqual([])
  })

  test('секрет и заголовком Authorization — как у кронов (cronAuthorized)', async () => {
    const res = await ask(['/game/730'], { authorization: `Bearer ${SECRET}` })
    expect(res.status).toBe(200)
    expect(revalidated).toEqual(['/ru/game/730', '/en/game/730'])
  })

  /**
   * ISR кладёт страницу по пути маршрута, /ru/game/730 и /en/game/730, и
   * сбрасывать надо обе копии, с каким бы языком адрес ни пришёл.
   */
  test('адрес с языком или без — обе копии, повторы схлопываются', async () => {
    const res = await ask([
      '/game/730',
      '/en/game/730',
      '/ru/game/730',
      '/games/coop/opengraph-image',
      '/',
      '/en',
      '/games/coop',
      '/en/game/730/news/5000000000000000000',
    ])
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const want = [
      '/ru/game/730',
      '/en/game/730',
      '/ru/games/coop/opengraph-image',
      '/en/games/coop/opengraph-image',
      '/ru',
      '/en',
      '/ru/games/coop',
      '/en/games/coop',
      '/ru/game/730/news/5000000000000000000',
      '/en/game/730/news/5000000000000000000',
    ]
    expect(await res.json()).toEqual({ marked: want })
    expect(revalidated).toEqual(want)
  })

  test('файлы корня с ISR — одним адресом, без языка', async () => {
    const res = await ask([...ROOT_ISR_FILES])
    expect(res.status).toBe(200)
    expect(revalidated).toEqual(['/sitemap.xml', '/search-index.json'])
  })

  /**
   * Файл корня в списке, который не ISR, сбрасывать нечего: роут ответил
   * бы «помечено», ничего не сбросив. Файл — по адресу: /x.y — это
   * app/x.y/route.ts или app/x.ts (sitemap.ts отдаёт /sitemap.xml).
   */
  test('каждый файл корня из списка — правда ISR', () => {
    expect(ROOT_ISR_FILES.length).toBeGreaterThan(0)
    for (const file of ROOT_ISR_FILES) {
      const name = file.slice(1)
      const candidates = [
        path.join(ROOT, 'app', name, 'route.ts'),
        path.join(ROOT, 'app', `${name.replace(/\.xml$/, '')}.ts`),
      ]
      const src = candidates.filter((p) => fs.existsSync(p)).map((p) => fs.readFileSync(p, 'utf8'))
      expect(src.length, file).toBe(1)
      expect(src[0], file).toMatch(/^export const revalidate = [\d_]+$/m)
    }
  })

  /**
   * revalidatePath на опечатке молчит так же, как на верном адресе: роут,
   * который пометил бы «/Game/730», ответил бы успехом, ничего не сбросив.
   * Поэтому хоть один чужой адрес — отказ целиком, со списком.
   */
  test('чужой адрес — 400 со списком и ни одной пометки', async () => {
    const bad = [
      'https://evil.example/game/730',
      '//evil.example/game/730',
      'game/730',
      '/Game/730',
      '/game/abc',
      '/game/730/',
      '/game/730?x=1',
      '/game/730#top',
      '/xyz',
      '/en/xyz',
      '/api/cron/news',
      '/robots.txt',
      '',
    ]
    const res = await ask(['/game/730', ...bad])
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'not-site-path', rejected: bad })
    expect(revalidated).toEqual([])
  })

  test('без адреса — 400', async () => {
    const res = await ask([])
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'no-path' })
  })

  test('больше полусотни адресов — 400 целиком: хвост молча не обрезается', async () => {
    const many = Array.from({ length: 51 }, (_, i) => `/game/${i + 1}`)
    const res = await ask(many)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'too-many', max: 50, got: 51 })
    expect(revalidated).toEqual([])

    expect((await ask(many.slice(0, 50))).status).toBe(200)
    expect(revalidated).toHaveLength(100)
  })
})
