import {
  getRedirectUrl,
  unstable_doesMiddlewareMatch,
  unstable_getResponseFromNextConfig,
} from 'next/experimental/testing/server'
import { NextRequest } from 'next/server'
import { describe, expect, test } from 'vitest'
import nextConfig from '../next.config'
import { config, proxy } from '../proxy'
import { CIS_COUNTRIES, homeLocaleFor } from './homelocale'
import { LANG_COOKIE } from './i18n'
import { SESSION_COOKIE } from './session'

const BASE = 'https://imbored.cc'
const EN = 'en-US,en;q=0.9'
const RU = 'ru-RU,ru;q=0.9,en;q=0.8'

/** Обычный Chrome на Windows — не краулер */
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

describe('homeLocaleFor — куда увести вход на «/» без выбора', () => {
  test('гость из СНГ с английским браузером остаётся на русской', () => {
    for (const country of CIS_COUNTRIES) {
      expect(homeLocaleFor({ acceptLanguage: EN, country, userAgent: CHROME }), country).toBe(null)
    }
    // регистр и пробелы кода страны не в счёт
    expect(homeLocaleFor({ acceptLanguage: EN, country: 'kz' })).toBe(null)
    expect(homeLocaleFor({ acceptLanguage: EN, country: ' BY ' })).toBe(null)
  })

  test('вне СНГ браузер, который ставит русский выше английского, остаётся', () => {
    expect(homeLocaleFor({ acceptLanguage: RU, country: 'DE', userAgent: CHROME })).toBe(null)
    expect(homeLocaleFor({ acceptLanguage: 'ru', country: 'US' })).toBe(null)
    expect(homeLocaleFor({ acceptLanguage: 'de-DE,de;q=0.9,ru;q=0.8', country: 'DE' })).toBe(null)
  })

  test('английский или немецкий браузер вне СНГ — на /en', () => {
    expect(homeLocaleFor({ acceptLanguage: EN, country: 'US', userAgent: CHROME })).toBe('en')
    expect(homeLocaleFor({ acceptLanguage: 'en-US,en;q=0.9,ru;q=0.8', country: 'GB' })).toBe('en')
    expect(homeLocaleFor({ acceptLanguage: 'de-DE,de;q=0.9', country: 'DE', userAgent: CHROME })).toBe('en')
    expect(homeLocaleFor({ acceptLanguage: 'zh-CN,zh;q=0.9', country: 'CN' })).toBe('en')
  })

  test('без заголовка страны (локально, не на Vercel) решает браузер', () => {
    expect(homeLocaleFor({ acceptLanguage: EN, userAgent: CHROME })).toBe('en')
    expect(homeLocaleFor({ acceptLanguage: EN, country: null })).toBe('en')
    expect(homeLocaleFor({ acceptLanguage: EN, country: '' })).toBe('en')
    expect(homeLocaleFor({ acceptLanguage: RU, country: null })).toBe(null)
  })

  test('без Accept-Language — русская: браузер шлёт его всегда, а многие краулеры — нет', () => {
    expect(homeLocaleFor({ country: 'US', userAgent: CHROME })).toBe(null)
    expect(homeLocaleFor({ acceptLanguage: null, country: 'US' })).toBe(null)
    expect(homeLocaleFor({ acceptLanguage: '', country: 'US' })).toBe(null)
    expect(homeLocaleFor({ acceptLanguage: '   ', country: 'US' })).toBe(null)
  })

  test('краулер и бот превью ссылок — русская главная, даже с английским', () => {
    for (const userAgent of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Google-InspectionTool/1.0;)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
      'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)',
      'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
      'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1)',
      'Mozilla/5.0 (compatible;PetalBot;+https://webmaster.petalsearch.com/site/petalbot)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
      'Twitterbot/1.0',
      'TelegramBot (like TwitterBot)',
      'Mozilla/5.0 (compatible; vkShare; +http://vk.com/dev/Share)',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'WhatsApp/2.23.20.0',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
      'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
      'Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)',
      // общий хвост — для тех, кого в списке нет
      'SomeNewCrawler/1.0',
      'acme-spider',
      'Link Preview Service',
      'feed-fetcher/2.0',
    ]) {
      expect(homeLocaleFor({ acceptLanguage: EN, country: 'US', userAgent }), userAgent).toBe(null)
    }
  })

  test('обычные браузеры краулером не считаются', () => {
    for (const userAgent of [
      CHROME,
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    ]) {
      expect(homeLocaleFor({ acceptLanguage: EN, country: 'US', userAgent }), userAgent).toBe('en')
    }
  })

  test('украинский браузер: русский выше английского — остаётся, только английский — на /en', () => {
    expect(homeLocaleFor({ acceptLanguage: 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7', country: 'UA' })).toBe(null)
    expect(homeLocaleFor({ acceptLanguage: 'uk-UA,uk;q=0.9,en;q=0.8', country: 'UA' })).toBe('en')
  })

  /*
   * Список — решение владельца, а не догадка: члены СНГ и Туркменистан.
   * Украины и Грузии нет — они не в СНГ. Меняется одной строкой в
   * lib/homelocale.ts, и тогда здесь.
   */
  test('страны СНГ — ровно эти', () => {
    expect([...CIS_COUNTRIES]).toEqual(['RU', 'BY', 'KZ', 'KG', 'AM', 'AZ', 'TJ', 'UZ', 'MD', 'TM'])
    expect(CIS_COUNTRIES).not.toContain('UA')
    expect(CIS_COUNTRIES).not.toContain('GE')
  })
})

/** Вход на сайт из браузера: закладка, ввод адреса */
const ENTRY = { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none' }

const cookieHeader = (cookies: Record<string, string>) =>
  Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')

/**
 * Куда уведут GET «url» с такими заголовками и куками — тем же порядком, что
 * у Next: сначала redirects из next.config, потом прокси, если его matcher
 * совпал. null — никуда, «/» отдаёт то, что лежит по адресу.
 */
async function home(url: string, headers: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  const res = await unstable_getResponseFromNextConfig({ url: BASE + url, nextConfig, headers, cookies })
  const viaConfig = getRedirectUrl(res)
  if (viaConfig) return { by: 'config', status: res.status, to: viaConfig.replace(BASE, '') }
  if (!unstable_doesMiddlewareMatch({ config, url, headers, cookies })) return null
  const cookie = cookieHeader(cookies)
  const out = proxy(new NextRequest(BASE + url, { headers: { ...headers, ...(cookie ? { cookie } : {}) } }))
  const to = out.headers.get('location')
  return to ? { by: 'proxy', status: out.status, to: to.replace(BASE, '') } : null
}

describe('язык главной — весь путь: next.config, затем прокси', () => {
  test('английский браузер вне СНГ при входе на «/» уезжает на /en, 307', async () => {
    const to = { by: 'proxy', status: 307, to: '/en' }
    expect(await home('/', { ...ENTRY, 'accept-language': EN, 'x-vercel-ip-country': 'US' })).toEqual(to)
    expect(await home('/', { ...ENTRY, 'accept-language': 'de-DE,de;q=0.9', 'x-vercel-ip-country': 'DE' })).toEqual(to)
    // ссылка с чужого сайта — тоже вход
    expect(await home('/', { ...ENTRY, 'sec-fetch-site': 'cross-site', 'accept-language': EN })).toEqual(to)
    // HEAD — как GET
    const head = proxy(new NextRequest(`${BASE}/`, { method: 'HEAD', headers: { ...ENTRY, 'accept-language': EN } }))
    expect([head.status, head.headers.get('location')]).toEqual([307, `${BASE}/en`])
  })

  test('строка запроса едет с ним', async () => {
    expect(await home('/?next=%2Fplay', { ...ENTRY, 'accept-language': EN })).toEqual({
      by: 'proxy',
      status: 307,
      to: '/en?next=%2Fplay',
    })
  })

  test('из СНГ, с русским браузером и без Accept-Language — главная как есть', async () => {
    expect(await home('/', { ...ENTRY, 'accept-language': EN, 'x-vercel-ip-country': 'KZ' })).toBe(null)
    expect(await home('/', { ...ENTRY, 'accept-language': RU })).toBe(null)
    expect(await home('/', { ...ENTRY, 'accept-language': RU, 'x-vercel-ip-country': 'DE' })).toBe(null)
    expect(await home('/', { ...ENTRY, 'accept-language': 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7', 'x-vercel-ip-country': 'UA' })).toBe(
      null,
    )
    expect(await home('/', ENTRY)).toBe(null)
  })

  test('краулер — русская главная: с заголовками документа и без них', async () => {
    const googlebot = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
    expect(await home('/', { ...ENTRY, 'accept-language': EN, 'user-agent': googlebot })).toBe(null)
    // без Sec-Fetch-Dest прокси не будится вовсе
    expect(await home('/', { 'accept-language': EN, 'user-agent': googlebot })).toBe(null)
    expect(await home('/', { 'accept-language': 'en' })).toBe(null)
  })

  test('кука переключателя важнее страны и браузера в обе стороны', async () => {
    expect(await home('/', { ...ENTRY, 'accept-language': EN, 'x-vercel-ip-country': 'US' }, { lang: 'ru' })).toBe(null)
    const toEn = { by: 'config', status: 307, to: '/en' }
    expect(await home('/', { ...ENTRY, 'accept-language': 'ru' }, { lang: 'en' })).toEqual(toEn)
    expect(await home('/', { ...ENTRY, 'accept-language': RU, 'x-vercel-ip-country': 'RU' }, { lang: 'en' })).toEqual(toEn)
    expect(await home('/', {}, { lang: 'en' })).toEqual(toEn)
    expect(await home('/?next=%2Fplay', {}, { lang: 'en' })).toEqual({ ...toEn, to: '/en?next=%2Fplay' })
  })

  /**
   * Вошедшие до английской версии куки lang не имеют, а входили на русском.
   * Без этого условия каждый вне СНГ с английским браузером на следующем
   * входе — и на каждом запуске приложения с домашнего экрана — уезжал бы на
   * /en.
   */
  test('с сессией страна и браузер не уводят, а кука lang=en — уводит', async () => {
    const session = { [SESSION_COOKIE]: 'v1.x.y' }
    expect(await home('/', { ...ENTRY, 'accept-language': EN, 'x-vercel-ip-country': 'US' }, session)).toBe(null)
    expect(await home('/', { ...ENTRY, 'accept-language': 'en-US,en;q=0.9,ru;q=0.8' }, session)).toBe(null)
    expect(await home('/', { ...ENTRY, 'accept-language': EN }, { ...session, lang: 'en' })).toEqual({
      by: 'config',
      status: 307,
      to: '/en',
    })
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
    // даже с заголовками документа — запрос роутера не вход
    expect(await home('/', { ...ENTRY, 'accept-language': EN, rsc: '1' })).toBe(null)
    expect(await home('/', { ...ENTRY, 'accept-language': EN, 'next-router-prefetch': '1' })).toBe(null)
    // fetch без RSC, но и не документ — не вход
    expect(await home('/', { 'accept-language': EN, 'sec-fetch-dest': 'empty', 'sec-fetch-site': 'none' })).toBe(null)
  })

  test('только корень', async () => {
    for (const url of ['/play', '/en', '/quiz', '/game/730']) {
      expect(await home(url, { ...ENTRY, 'accept-language': EN }), url).toBe(null)
      expect(await home(url, { ...ENTRY, 'accept-language': EN }, { lang: 'en' }), url).toBe(null)
    }
  })
})

/**
 * Прокси на «/» — только вход без выбора: документ, без куки lang и без сессии,
 * не запрос роутера и не переход со своей страницы. Остальные просмотры
 * главной — статика с CDN, мимо функции.
 */
describe('matcher прокси на «/»', () => {
  const match = (headers: Record<string, string>, cookies: Record<string, string> = {}, url = '/') =>
    unstable_doesMiddlewareMatch({ config, url, headers, cookies })

  test('вход браузера без выбора — будит', () => {
    expect(match(ENTRY)).toBe(true)
    expect(match({ ...ENTRY, 'sec-fetch-site': 'cross-site' })).toBe(true)
    expect(match(ENTRY, {}, '/?next=%2Fplay')).toBe(true)
  })

  test('остальное — нет', () => {
    expect(match({})).toBe(false)
    expect(match({ 'sec-fetch-dest': 'empty', 'sec-fetch-site': 'none' })).toBe(false)
    expect(match(ENTRY, { [LANG_COOKIE]: 'ru' })).toBe(false)
    expect(match(ENTRY, { [LANG_COOKIE]: 'en' })).toBe(false)
    expect(match(ENTRY, { [SESSION_COOKIE]: 'v1.x.y' })).toBe(false)
    expect(match({ ...ENTRY, rsc: '1' })).toBe(false)
    expect(match({ ...ENTRY, 'next-router-prefetch': '1' })).toBe(false)
    expect(match({ ...ENTRY, 'sec-fetch-site': 'same-origin' })).toBe(false)
  })

  /*
   * Значения matcher Next читает статическим разбором на сборке, и имя
   * константы там проигнорировалось бы молча, — поэтому в proxy.ts имена кук
   * записаны строками. Переименуй LANG_COOKIE или SESSION_COOKIE — и этот
   * тест скажет, что matcher остался со старым.
   */
  test('имена кук в matcher — те же, что LANG_COOKIE и SESSION_COOKIE', () => {
    const home = config.matcher.find((m) => typeof m !== 'string')
    expect(home?.source).toBe('/')
    expect(home?.missing.filter((c) => c.type === 'cookie').map((c) => c.key)).toEqual([LANG_COOKIE, SESSION_COOKIE])
  })
})
