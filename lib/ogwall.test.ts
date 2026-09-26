import { describe, expect, test, vi } from 'vitest'
import { ogPoster } from './og'
import { CANVAS_TALL, CANVAS_WIDE, WALL_TALL, WALL_WIDE, wallColumns, wallCovers } from './ogwall'

describe('стена постеров', () => {
  test('закрывает холст целиком — без голых углов после поворота', () => {
    expect(wallCovers(WALL_WIDE, CANVAS_WIDE)).toBe(true)
    expect(wallCovers(WALL_TALL, CANVAS_TALL)).toBe(true)
    // и проверка правда умеет сказать «нет»
    expect(wallCovers({ ...WALL_WIDE, left: 0, top: 0 }, { width: 1200, height: 630 })).toBe(false)
  })

  test('клетки — построчно по кругу: самая наигранная в левом верхнем углу', () => {
    const cols = wallColumns(['a', 'b', 'c', 'd', 'e'], { cols: 3, rows: 2 })
    expect(cols).toEqual([
      ['a', 'd'],
      ['b', 'e'],
      ['c', 'a'],
    ])
    expect(wallColumns([], WALL_WIDE)).toEqual([])
    const full = wallColumns(['x'], WALL_WIDE)
    expect(full).toHaveLength(WALL_WIDE.cols)
    expect(full.every((c) => c.length === WALL_WIDE.rows)).toBe(true)
  })
})

describe('ogPoster', () => {
  const ok = (type: string) => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': type } })

  test('JPEG — data-URI', async () => {
    const fetchFn = vi.fn(async () => ok('image/jpeg')) as unknown as typeof fetch
    expect(await ogPoster(['https://a/p.jpg'], { fetchFn })).toBe('data:image/jpeg;base64,AQID')
  })

  test('WebP, отказ и сбой сети — следующий кандидат; не вышел ни один — null', async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url)
      if (url.endsWith('webp')) return ok('image/webp')
      if (url.endsWith('404')) return new Response('', { status: 404 })
      if (url.endsWith('boom')) throw new Error('таймаут')
      return ok('image/png; charset=binary')
    }) as unknown as typeof fetch
    expect(await ogPoster(['https://a/webp', 'https://a/404', 'https://a/boom', 'https://a/ok'], { fetchFn })).toBe(
      'data:image/png;base64,AQID',
    )
    expect(calls).toHaveLength(4)
    expect(await ogPoster(['https://a/webp', 'https://a/boom'], { fetchFn })).toBeNull()
    expect(await ogPoster([], { fetchFn })).toBeNull()
  })
})
