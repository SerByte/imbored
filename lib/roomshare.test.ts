import { describe, expect, test } from 'vitest'
import { roomShareUrl } from './roomshare'

describe('ссылка-приглашение в комнату', () => {
  test('без языка — русский адрес, как раньше', () => {
    expect(roomShareUrl('https://imbored.cc', 'ABC234')).toBe('https://imbored.cc/room/ABC234?ref=room')
  })

  test('с английской комнаты — английский адрес с той же меткой', () => {
    // друг открывает экран приглашения на языке того, кто зовёт
    expect(roomShareUrl('https://imbored.cc', 'ABC234', 'en')).toBe('https://imbored.cc/en/room/ABC234?ref=room')
  })

  test('код кодируется и на английском адресе', () => {
    expect(roomShareUrl('http://localhost:3000', 'A B', 'en')).toBe('http://localhost:3000/en/room/A%20B?ref=room')
  })
})
