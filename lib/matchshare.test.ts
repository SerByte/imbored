import { describe, expect, test } from 'vitest'
import { matchShareCopy, matchShareUrl } from './matchshare'

/**
 * Весть с экрана матча по-английски. Русская — в lib/matchscreen.test.ts,
 * рядом с кнопкой, которая её отправляет; здесь — что английская говорит
 * то же самое и уходит английским адресом.
 */
const CYRILLIC = /[А-Яа-яЁё]/

describe('весть о матче по-английски', () => {
  test('адрес — английская комната с той же меткой; русский — прежний', () => {
    expect(matchShareUrl('https://imbored.cc', 'ABC234', 'en')).toBe('https://imbored.cc/en/room/ABC234?ref=match')
    expect(matchShareUrl('https://imbored.cc', 'ABC234')).toBe('https://imbored.cc/room/ABC234?ref=match')
    expect(matchShareUrl('https://imbored.cc', 'ABC234', 'ru')).toBe('https://imbored.cc/room/ABC234?ref=match')
  })

  test('единогласный матч — «the whole party said yes»', () => {
    expect(matchShareCopy({ name: 'Deep Rock Galactic', forCount: 4, memberCount: 4 }, 'en')).toEqual({
      title: "We're playing “Deep Rock Galactic”",
      text: "We're playing “Deep Rock Galactic” — the whole party said yes",
    })
  })

  test('матч лидером голосов — честный счёт, а не «все за»', () => {
    const copy = matchShareCopy({ name: 'Dota 2', forCount: 3, memberCount: 4 }, 'en')
    expect(copy.text).toBe("We're playing “Dota 2”: agreed by vote, 3 of 4 said yes")
    expect(copy.text).not.toMatch(/whole party/)
  })

  test('без зова «join» и без русских букв — ни в одном случае', () => {
    for (const forCount of [4, 3, null]) {
      const { title, text } = matchShareCopy({ name: 'Hades', forCount, memberCount: 4 }, 'en')
      expect(`${title} ${text}`).not.toMatch(/join|come in/i)
      expect(`${title} ${text}`).not.toMatch(CYRILLIC)
    }
  })

  test('без языка — русский до буквы', () => {
    const args = { name: 'Dota 2', forCount: 3, memberCount: 4 }
    expect(matchShareCopy(args)).toEqual(matchShareCopy(args, 'ru'))
    expect(matchShareCopy(args).text).toBe('Играем в «Dota 2»: договорились голосами, 3 из 4 за')
  })
})
