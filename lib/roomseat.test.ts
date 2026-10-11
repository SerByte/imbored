import { describe, expect, test } from 'vitest'
import { seatOf, seatRefusal, seatToRaise } from './roomseat'

/**
 * Таблица истинности одного правила: членство, заведённое пишущей сессией,
 * действует только от пишущей; заведённое по ссылке — от любой сессии на
 * этот профиль (вход в пати своей ссылкой — сам продукт).
 */
describe('seatOf', () => {
  const members = [
    { steamid: 'steam', writer: true },
    { steamid: 'link', writer: false },
  ]

  test('вошёл через Steam: пишущая сессия — участник, ссылка — needsteam', () => {
    expect(seatOf(members, 'steam', true)).toBe('member')
    expect(seatOf(members, 'steam', false)).toBe('needsteam')
  })

  test('вошёл по ссылке: участник от любой своей сессии', () => {
    expect(seatOf(members, 'link', false)).toBe('member')
    expect(seatOf(members, 'link', true)).toBe('member')
  })

  test('не в комнате — none, кем бы ни пришёл', () => {
    expect(seatOf(members, 'stranger', true)).toBe('none')
    expect(seatOf(members, 'stranger', false)).toBe('none')
  })
})

/**
 * Когда членство поднимать: пишущая сессия на членстве по ссылке — и только
 * тогда. Остальные случаи не пишут ничего: поднятое не поднимают дважды,
 * ссылка не поднимает ничего, а не-участника поднимать некуда.
 */
describe('seatToRaise', () => {
  const members = [
    { steamid: 'steam', writer: true },
    { steamid: 'link', writer: false },
  ]

  test('вошёл по ссылке, пришёл через Steam — поднять', () => {
    expect(seatToRaise(members, 'link', true)).toBe(true)
  })

  test('уже поднято, сессия по ссылке или не участник — не трогать', () => {
    expect(seatToRaise(members, 'steam', true)).toBe(false)
    expect(seatToRaise(members, 'link', false)).toBe(false)
    expect(seatToRaise(members, 'stranger', true)).toBe(false)
  })
})

describe('seatRefusal', () => {
  test('коды — те, что страница уже различает: needsteam и notmember', async () => {
    expect(seatRefusal('member')).toBeNull()
    expect(await seatRefusal('needsteam')?.json()).toEqual({ error: 'needsteam' })
    expect(seatRefusal('needsteam')?.status).toBe(403)
    expect(await seatRefusal('none')?.json()).toEqual({ error: 'notmember' })
  })
})
