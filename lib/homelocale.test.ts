import {
  getRedirectUrl,
  unstable_doesMiddlewareMatch,
  unstable_getResponseFromNextConfig,
} from 'next/experimental/testing/server'
import { describe, expect, test } from 'vitest'
import nextConfig from '../next.config'
import { config } from '../proxy'
import { ENGLISH_FIRST } from './homelocale'
import { preferredLocale } from './i18n'
import { SESSION_COOKIE } from './session'

const BASE = 'https://imbored.cc'
const EN = 'en-US,en;q=0.9'

/** Вход на сайт из браузера: закладка, ввод адреса, ссылка извне */
const ENTRY = { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' }

/** Куда next.config уведёт GET «url» с такими заголовками и куками; null — никуда */
async function home(url: string, headers: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  const res = await unstable_getResponseFromNextConfig({ url: BASE + url, nextConfig, headers, cookies })
  const to = getRedirectUrl(res)
  return to ? { status: res.status, to: to.replace(BASE, '') } : null
}

describe('язык главной', () => {
  test('английский браузер при входе на «/» уезжает на /en, 307', async () => {
    expect(await home('/', { ...ENTRY, 'accept-language': EN })).toEqual({ status: 307, to: '/en' })
    expect(await home('/', { ...ENTRY, 'accept-language': 'de-DE,de;q=0.9,en;q=0.8' })).toEqual({ status: 307, to: '/en' })
    // ссылка с чужого сайта — тоже вход
    expect(await home('/', { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'cross-site', 'accept-language': EN })).toEqual({
      status: 307,
      to: '/en',
    })
  })

  test('строка запроса едет с ним', async () => {
    expect(await home('/?next=%2Fplay', { ...ENTRY, 'accept-language': EN })).toEqual({ status: 307, to: '/en?next=%2Fplay' })
  })

  test('русский раньше английского, без английского и без заголовка — главная как есть', async () => {
    expect(await home('/', ENTRY)).toBe(null)
    expect(await home('/', { ...ENTRY, 'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8' })).toBe(null)
    expect(await home('/', { ...ENTRY, 'accept-language': 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7' })).toBe(null)
    expect(await home('/', { ...ENTRY, 'accept-language': 'de-DE,de;q=0.9' })).toBe(null)
  })

  /**
   * «/» — x-default в hreflang: краулер, который пришёл без заголовков
   * браузера, обязан получить саму русскую главную, а не редирект.
   */
  test('краулер и скрипт с английским Accept-Language — русская главная', async () => {
    expect(await home('/', { 'accept-language': EN })).toBe(null)
    expect(await home('/', { 'accept-language': 'en' })).toBe(null)
  })

  test('кука переключателя важнее браузера в обе стороны', async () => {
    expect(await home('/', { ...ENTRY, 'accept-language': EN }, { lang: 'ru' })).toBe(null)
    expect(await home('/', { ...ENTRY, 'accept-language': 'ru' }, { lang: 'en' })).toEqual({ status: 307, to: '/en' })
    expect(await home('/', {}, { lang: 'en' })).toEqual({ status: 307, to: '/en' })
  })

  /**
   * Вошедшие до английской версии куки lang не имеют, а входили на русском.
   * Без этого условия каждый с английским браузером на следующем входе —
   * и на каждом запуске приложения с домашнего экрана — уезжал бы на /en.
   */
  test('с сессией английский браузер не уводит, а кука lang=en — уводит', async () => {
    const session = { [SESSION_COOKIE]: 'v1.x.y' }
    expect(await home('/', { ...ENTRY, 'accept-language': EN }, session)).toBe(null)
    expect(await home('/', { ...ENTRY, 'accept-language': 'en-US,en;q=0.9,ru;q=0.8' }, session)).toBe(null)
    expect(await home('/', { ...ENTRY, 'accept-language': EN }, { ...session, lang: 'en' })).toEqual({ status: 307, to: '/en' })
  })

  /**
   * Человек читал русскую карточку игры из поиска и нажал логотип: роутер
   * просит «/» запросом RSC, а префетч шапки — ещё раньше. Увести их на /en
   * — сменить язык на полпути.
   */
  test('запросы роутера и переходы со своей страницы не уводятся', async () => {
    for (const cookies of [{}, { lang: 'en' }] as Array<Record<string, string>>) {
      const al = { 'accept-language': EN }
      expect(await home('/', { ...al, rsc: '1', 'sec-fetch-dest': 'empty', 'sec-fetch-site': 'same-origin' }, cookies)).toBe(null)
      expect(await home('/', { ...al, rsc: '1', 'next-router-prefetch': '1' }, cookies)).toBe(null)
      expect(await home('/', { ...al, 'sec-fetch-dest': 'document', 'sec-fetch-site': 'same-origin' }, cookies)).toBe(null)
    }
    // fetch без RSC, но и не документ — не вход
    expect(await home('/', { 'accept-language': EN, 'sec-fetch-dest': 'empty', 'sec-fetch-site': 'none' })).toBe(null)
  })

  test('только корень', async () => {
    for (const url of ['/play', '/en', '/quiz', '/game/730']) {
      expect(await home(url, { ...ENTRY, 'accept-language': EN }, { lang: 'en' }), url).toBe(null)
    }
  })

  /**
   * Главная — статика с CDN, и прокси на «/» будил бы функцию на каждом
   * входе и каждом префетче логотипа. Язык решают redirects.
   */
  test('прокси на «/» не стоит', () => {
    expect(unstable_doesMiddlewareMatch({ config, url: '/' })).toBe(false)
    expect(unstable_doesMiddlewareMatch({ config, url: '/?next=%2Fplay' })).toBe(false)
  })
})

/**
 * Регулярка для has.value в next.config и preferredLocale — одно решение.
 * preferredLocale сравнивает q, регулярка — порядок; на заголовках, какие
 * пишут браузеры (по убыванию q), они обязаны совпасть.
 */
describe('ENGLISH_FIRST', () => {
  const re = new RegExp(`^${ENGLISH_FIRST}$`)
  const SAMPLES = [
    'en',
    'en-US',
    'en-US,en;q=0.9',
    'en-GB,en-US;q=0.9,en;q=0.8',
    'EN-us',
    'en-US,en;q=0.9,ru;q=0.8',
    'en;q=0.8,ru;q=0.8',
    'ru;q=0.8,en;q=0.8',
    'de-DE,de;q=0.9,en;q=0.8',
    'fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5',
    'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
    'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7',
    'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'ru',
    'ru-RU',
    'RU-ru,en',
    'de-DE,de;q=0.9',
    'zh-CN,zh;q=0.9',
    '*',
    'eng',
    'rue,en',
    'kk-KZ,kk;q=0.9,ru-RU;q=0.8,ru;q=0.7,en-US;q=0.6,en;q=0.5',
    'be,en-US;q=0.9,en;q=0.8',
  ]

  test('совпадает с preferredLocale на заголовках браузеров', () => {
    for (const h of SAMPLES) {
      expect(re.test(h), h).toBe(preferredLocale({ acceptLanguage: h }) === 'en')
    }
  })

  test('английский в хвосте после русского не находится поиском', () => {
    // без собственных якорей поиск без ^…$ нашёл бы «en-US» в хвосте
    expect(new RegExp(ENGLISH_FIRST).test('ru-RU,ru;q=0.9,en-US;q=0.8')).toBe(false)
  })
})
