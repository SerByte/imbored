import { describe, expect, test } from 'vitest'
import { storeLink } from './storelink'

/**
 * Подпись ссылки «где взять игру» по-английски — целиком, из open: русская
 * клеит «Открыть в » и where, английской клеить нечего. Русские случаи — в
 * lib/matchscreen.test.ts, рядом с экранами, которые её рисуют.
 */
const CYRILLIC = /[А-Яа-яЁё]/

describe('storeLink по-английски', () => {
  test('игра Steam — «Open in Steam»', () => {
    expect(storeLink({ appid: 620, store: null, storeUrl: null }, 'en')).toEqual({
      href: 'https://store.steampowered.com/app/620/',
      where: 'Steam',
      open: 'Open in Steam',
    })
  })

  test('игра другого магазина — его имя', () => {
    expect(storeLink({ appid: -3, store: 'epic', storeUrl: 'https://store.epicgames.com/x' }, 'en')).toEqual({
      href: 'https://store.epicgames.com/x',
      where: 'Epic Games',
      open: 'Open in Epic Games',
    })
  })

  test('магазин без метки — не «Open in store», а «Open store page»', () => {
    const link = storeLink({ appid: -4, store: 'gog', storeUrl: 'https://gog.com/x' }, 'en')
    expect(link?.open).toBe('Open store page')
    expect(link?.where).toBe('store')
    for (const s of [link!.open, link!.where]) expect(s).not.toMatch(CYRILLIC)
  })

  test('чужой магазин без ссылки — молчим и по-английски', () => {
    expect(storeLink({ appid: -3, store: 'epic', storeUrl: null }, 'en')).toBeNull()
  })

  test('русская подпись — та, что клеили на месте: «Открыть в » и where', () => {
    for (const game of [
      { appid: 620, store: null, storeUrl: null },
      { appid: -3, store: 'epic', storeUrl: 'https://store.epicgames.com/x' },
      { appid: -4, store: 'gog', storeUrl: 'https://gog.com/x' },
    ]) {
      const link = storeLink(game)!
      expect(link.open).toBe(`Открыть в ${link.where}`)
      expect(storeLink(game, 'ru')).toEqual(link)
    }
    expect(storeLink({ appid: -4, store: 'gog', storeUrl: 'https://gog.com/x' })?.open).toBe('Открыть в магазине')
  })
})
