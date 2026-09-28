import { describe, expect, test, vi } from 'vitest'
import { ogArt } from './ogcard'

describe('ogArt', () => {
  const jpeg = () => new Response(new Uint8Array([9]), { headers: { 'content-type': 'image/jpeg' } })

  test('пробует не больше max кандидатов — краулер шесть таймаутов подряд не ждёт', async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url)
      throw new Error('таймаут')
    }) as unknown as typeof fetch
    const got = await ogArt(
      { appid: 620, art: { hero: 'https://a/hero.jpg', header: 'https://a/h.jpg' }, headerImage: 'https://a/hi.jpg' },
      'hero',
      2,
      { fetchFn },
    )
    expect(got).toBeNull()
    expect(calls).toHaveLength(2)
    expect(calls[0]).toBe('https://a/hero.jpg')
  })

  test('первый годный — data-URI; WebP пропускается', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.includes('hero') ? new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/webp' } }) : jpeg(),
    ) as unknown as typeof fetch
    const got = await ogArt({ appid: 620, art: { hero: 'https://a/hero.webp' }, headerImage: null }, 'hero', 3, {
      fetchFn,
    })
    expect(got).toBe('data:image/jpeg;base64,CQ==')
  })
})
