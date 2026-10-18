import { NextRequest } from 'next/server'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { describe, expect, test } from 'vitest'
import { config, proxy } from '../proxy'
import { homeLocale } from './homelocale'

const BASE = 'https://imbored.cc'
const EN = 'en-US,en;q=0.9'

const req = (url: string, headers: Record<string, string> = {}, method = 'GET') =>
  new NextRequest(BASE + url, { method, headers })

describe('язык главной', () => {
  test('английский браузер на «/» уезжает на /en', () => {
    expect(homeLocale(req('/', { 'accept-language': EN }))).toBe('/en')
    expect(homeLocale(req('/', { 'accept-language': 'de-DE,de;q=0.9,en;q=0.8' }))).toBe('/en')
  })

  test('строка запроса едет с ним', () => {
    expect(homeLocale(req('/?next=%2Fplay', { 'accept-language': EN }))).toBe('/en?next=%2Fplay')
  })

  test('без заголовка, с русским и без английского — главная как есть', () => {
    expect(homeLocale(req('/'))).toBe(null)
    expect(homeLocale(req('/', { 'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8' }))).toBe(null)
    expect(homeLocale(req('/', { 'accept-language': 'de-DE,de;q=0.9' }))).toBe(null)
  })

  test('кука переключателя важнее браузера в обе стороны', () => {
    expect(homeLocale(req('/', { 'accept-language': EN, cookie: 'lang=ru' }))).toBe(null)
    expect(homeLocale(req('/', { 'accept-language': 'ru', cookie: 'lang=en' }))).toBe('/en')
    expect(homeLocale(req('/', { cookie: 'lang=en' }))).toBe('/en')
  })

  test('только GET и только корень', () => {
    expect(homeLocale(req('/', { 'accept-language': EN }, 'HEAD'))).toBe(null)
    expect(homeLocale(req('/', { 'accept-language': EN }, 'POST'))).toBe(null)
    expect(homeLocale(req('/play', { 'accept-language': EN }))).toBe(null)
    expect(homeLocale(req('/en', { 'accept-language': EN }))).toBe(null)
  })

  /**
   * Человек читал русскую карточку игры из поиска и нажал логотип: роутер
   * просит «/» запросом RSC, а префетч шапки — ещё раньше. Увести их на /en
   * — сменить язык на полпути.
   */
  test('запросы роутера и переходы со своей страницы не уводятся', () => {
    // RSC и префетч роутера — fetch: Sec-Fetch-Dest у них empty, а не document
    expect(homeLocale(req('/', { 'accept-language': EN, 'sec-fetch-dest': 'empty' }))).toBe(null)
    expect(homeLocale(req('/', { 'accept-language': EN, 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'document' }))).toBe(null)
    expect(homeLocale(req('/', { 'accept-language': EN, referer: `${BASE}/game/730` }))).toBe(null)
    // вход: адрес руками, закладка, ссылка извне
    expect(homeLocale(req('/', { 'accept-language': EN, 'sec-fetch-site': 'none', 'sec-fetch-dest': 'document' }))).toBe('/en')
    expect(homeLocale(req('/', { 'accept-language': EN, 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'document' }))).toBe('/en')
    // чужой Referer — это вход на сайт
    expect(homeLocale(req('/', { 'accept-language': EN, referer: 'https://www.google.com/' }))).toBe('/en')
    expect(homeLocale(req('/', { 'accept-language': EN, referer: 'not a url' }))).toBe('/en')
  })

  test('прокси отвечает настоящим 307, а русскую главную пропускает', () => {
    const away = proxy(req('/?x=1', { 'accept-language': EN }))
    expect(away.status).toBe(307)
    expect(away.headers.get('location')).toBe(`${BASE}/en?x=1`)
    const stay = proxy(req('/', { 'accept-language': 'ru' }))
    expect(stay.headers.get('x-middleware-next')).toBe('1')
  })

  test('прокси стоит на корне точным адресом', () => {
    expect(unstable_doesMiddlewareMatch({ config, url: '/' })).toBe(true)
    expect(unstable_doesMiddlewareMatch({ config, url: '/?next=%2Fplay' })).toBe(true)
    for (const url of ['/en', '/play', '/quiz', '/game/730']) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(false)
    }
  })
})
