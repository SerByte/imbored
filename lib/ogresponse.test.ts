import { createElement } from 'react'
import { ImageResponse } from 'next/og'
import { describe, expect, test } from 'vitest'
import { isrImage } from './ogresponse'

/**
 * Картинка с revalidate обязана уходить без своего Cache-Control.
 *
 * Здесь настоящий next/og, а не подмена: сторожится ровно его заголовок.
 * Первый тест закрепляет то, ради чего isrImage существует, — если Next
 * однажды перестанет ставить max-age=0 сам, он покраснеет и скажет, что
 * помощник можно пересмотреть, а не будет молча зелёным.
 */
describe('isrImage', () => {
  const el = () => createElement('div', { style: { width: 8, height: 8, display: 'flex', background: '#000' } })

  test('голый ImageResponse ставит max-age=0 — тот, из-за которого ISR не держал карточку', () => {
    const res = new ImageResponse(el(), { width: 8, height: 8 })
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
  })

  test('без Cache-Control: срок кэша ставит revalidate маршрута, а не next/og', async () => {
    const res = isrImage(el(), { width: 8, height: 8 })
    expect(res.headers.get('cache-control')).toBeNull()
    // остальное как у ImageResponse: тип и сама картинка на месте
    expect(res.headers.get('content-type')).toBe('image/png')
    const png = new Uint8Array(await res.arrayBuffer())
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  test('свои заголовки опций доезжают, кроме срока', () => {
    const res = isrImage(el(), { width: 8, height: 8, headers: { 'x-robots-tag': 'noindex' } })
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    expect(res.headers.get('cache-control')).toBeNull()
  })
})
