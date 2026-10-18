import { describe, expect, test } from 'vitest'
import {
  alternates,
  DEFAULT_LOCALE,
  fmtDate,
  fmtNumber,
  htmlLang,
  intlLocale,
  isLocale,
  LANG_COOKIE,
  LOCALES,
  LOCALIZED_SECTIONS,
  localeFromRequest,
  lp,
  ogLocale,
  pl,
  preferredLocale,
  routePaths,
  splitLocale,
  switchLocaleHref,
  toLocale,
  tr,
  withLang,
} from './i18n'

describe('языки', () => {
  test('два языка, русский по умолчанию, кука lang', () => {
    expect(LOCALES).toEqual(['ru', 'en'])
    expect(DEFAULT_LOCALE).toBe('ru')
    expect(LANG_COOKIE).toBe('lang')
  })

  test('isLocale — только ru и en, без наследованного из прототипа', () => {
    expect(isLocale('ru')).toBe(true)
    expect(isLocale('en')).toBe(true)
    for (const v of ['RU', 'en-US', '', 'de', 'toString', '__proto__', null, undefined, 1, {}]) {
      expect(isLocale(v), String(v)).toBe(false)
    }
  })

  test('toLocale: неизвестное — русский', () => {
    expect(toLocale('en')).toBe('en')
    expect(toLocale('xx')).toBe('ru')
    expect(toLocale(undefined)).toBe('ru')
    expect(toLocale(['en'])).toBe('ru')
  })

  test('tr берёт ветку языка', () => {
    expect(tr('ru', { ru: 'Подобрать игру', en: 'Find a game' })).toBe('Подобрать игру')
    expect(tr('en', { ru: 'Подобрать игру', en: 'Find a game' })).toBe('Find a game')
    expect(tr('en', { ru: 1, en: 2 })).toBe(2)
  })

  test('htmlLang и ogLocale', () => {
    expect(htmlLang('ru')).toBe('ru')
    expect(htmlLang('en')).toBe('en')
    expect(ogLocale('ru')).toBe('ru_RU')
    expect(ogLocale('en')).toBe('en_US')
    expect(intlLocale('ru')).toBe('ru-RU')
    expect(intlLocale('en')).toBe('en-US')
  })
})

describe('pl — слово при числе', () => {
  const games = { ru: ['игра', 'игры', 'игр'] as [string, string, string], en: ['game', 'games'] as [string, string] }

  test('русский — три формы, как plural()', () => {
    expect([1, 2, 5, 11, 21, 22, 25, 111, 0].map((n) => pl('ru', n, games))).toEqual([
      'игра',
      'игры',
      'игр',
      'игр',
      'игра',
      'игры',
      'игр',
      'игр',
      'игр',
    ])
  })

  test('английский — one только у ровно 1; 0, 21 и дроби — other', () => {
    expect(pl('en', 1, games)).toBe('game')
    expect(pl('en', 0, games)).toBe('games')
    expect(pl('en', 2, games)).toBe('games')
    expect(pl('en', 21, games)).toBe('games')
    expect(pl('en', 1.5, games)).toBe('games')
    expect(pl('en', -1, games)).toBe('games')
  })
})

describe('числа и даты', () => {
  test('fmtNumber — разделители языка', () => {
    expect(fmtNumber('en', 12345.5)).toBe('12,345.5')
    // ru-RU разделяет тысячи неразрывным пробелом
    expect(fmtNumber('ru', 12345)).toMatch(/^12\s345$/u)
    expect(fmtNumber('en', 0.5, { style: 'percent' })).toBe('50%')
  })

  test('fmtDate: число — секунды unix, а не миллисекунды', () => {
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
    expect(fmtDate('en', 1_760_000_000, opts)).toBe('October 9, 2025')
    expect(fmtDate('ru', 1_760_000_000, opts)).toBe('9 октября 2025 г.')
    expect(fmtDate('en', new Date(Date.UTC(2025, 9, 9)), opts)).toBe('October 9, 2025')
  })
})

describe('lp — внутренняя ссылка на языке', () => {
  test('для ru адрес как есть — любой', () => {
    for (const href of ['/', '/play', '/en/play', 'https://x.example', '#a', '/api/x']) {
      expect(lp('ru', href), href).toBe(href)
    }
  })

  test('корень и разделы получают /en', () => {
    expect(lp('en', '/')).toBe('/en')
    expect(lp('en', '/play')).toBe('/en/play')
    expect(lp('en', '/game/730')).toBe('/en/game/730')
    expect(lp('en', '/game/730/news/1')).toBe('/en/game/730/news/1')
    expect(lp('en', '/room/new')).toBe('/en/room/new')
  })

  test('запрос и якорь едут как есть', () => {
    expect(lp('en', '/play?x=1#y')).toBe('/en/play?x=1#y')
    expect(lp('en', '/?next=%2Fplay')).toBe('/en?next=%2Fplay')
    expect(lp('en', '/#hero')).toBe('/en#hero')
    expect(lp('en', '/quiz#top')).toBe('/en/quiz#top')
  })

  test('повторный вызов ничего не меняет', () => {
    expect(lp('en', '/en')).toBe('/en')
    expect(lp('en', '/en/')).toBe('/en/')
    expect(lp('en', '/en/play')).toBe('/en/play')
    expect(lp('en', '/en?x=1')).toBe('/en?x=1')
    expect(lp('en', lp('en', '/play?x=1'))).toBe('/en/play?x=1')
  })

  test('/enx — не английский префикс и не раздел', () => {
    expect(lp('en', '/enx')).toBe('/enx')
    expect(lp('en', '/english/play')).toBe('/english/play')
  })

  test('без изменений: внешнее, протокол-относительное, якорь, запрос, относительное', () => {
    for (const href of [
      'https://imbored.cc/play',
      'http://localhost:3000/',
      '//cdn.example/play',
      'mailto:hi@imbored.cc',
      '#a',
      '?x=1',
      'play',
      './play',
      '',
    ]) {
      expect(lp('en', href), href).toBe(href)
    }
  })

  test('без изменений: /api, /_next и файлы корня', () => {
    for (const href of [
      '/api/x',
      '/api/auth/steam?next=%2Fplay',
      '/_next/static/chunks/a.js',
      '/favicon.ico',
      '/search-index.json',
      '/sitemap.xml',
      '/robots.txt',
      '/manifest.webmanifest',
      '/indexnow-key.txt',
      '/nope',
    ]) {
      expect(lp('en', href), href).toBe(href)
    }
  })

  test('карточки под разделом — на языке раздела', () => {
    expect(lp('en', '/portrait/1/card.png')).toBe('/en/portrait/1/card.png')
    expect(lp('en', '/whatsnew/feed.xml')).toBe('/en/whatsnew/feed.xml')
  })

  test('/ru/… не переводится: такого адреса снаружи нет', () => {
    expect(lp('en', '/ru/play')).toBe('/ru/play')
  })
})

describe('splitLocale и switchLocaleHref', () => {
  test('splitLocale', () => {
    expect(splitLocale('/')).toEqual({ locale: 'ru', path: '/' })
    expect(splitLocale('')).toEqual({ locale: 'ru', path: '/' })
    expect(splitLocale('/play')).toEqual({ locale: 'ru', path: '/play' })
    expect(splitLocale('/en')).toEqual({ locale: 'en', path: '/' })
    expect(splitLocale('/en/')).toEqual({ locale: 'en', path: '/' })
    expect(splitLocale('/en/play')).toEqual({ locale: 'en', path: '/play' })
    expect(splitLocale('/enx')).toEqual({ locale: 'ru', path: '/enx' })
    expect(splitLocale('/english')).toEqual({ locale: 'ru', path: '/english' })
  })

  // Статическая страница русской ветки пререндерится по /ru/…: так её
  // pathname видит сервер, а браузер видит адрес без префикса
  test('splitLocale понимает внутренний /ru', () => {
    expect(splitLocale('/ru')).toEqual({ locale: 'ru', path: '/' })
    expect(splitLocale('/ru/play')).toEqual({ locale: 'ru', path: '/play' })
    expect(splitLocale('/rux')).toEqual({ locale: 'ru', path: '/rux' })
  })

  test('switchLocaleHref — тот же адрес на другом языке', () => {
    expect(switchLocaleHref('/', 'en')).toBe('/en')
    expect(switchLocaleHref('/play', 'en')).toBe('/en/play')
    expect(switchLocaleHref('/en/play', 'ru')).toBe('/play')
    expect(switchLocaleHref('/en', 'ru')).toBe('/')
    expect(switchLocaleHref('/en/play', 'en')).toBe('/en/play')
    expect(switchLocaleHref('/play', 'ru')).toBe('/play')
    expect(switchLocaleHref('/ru/play', 'en')).toBe('/en/play')
    expect(switchLocaleHref('/ru/play', 'ru')).toBe('/play')
    expect(switchLocaleHref('/ru', 'ru')).toBe('/')
  })

  test('switchLocaleHref везёт строку запроса', () => {
    expect(switchLocaleHref('/play', 'en', '?time=short&vibe=chill')).toBe('/en/play?time=short&vibe=chill')
    expect(switchLocaleHref('/en/play', 'ru', 'time=short')).toBe('/play?time=short')
    expect(switchLocaleHref('/en', 'ru', new URLSearchParams({ next: '/play' }))).toBe('/?next=%2Fplay')
    expect(switchLocaleHref('/play', 'en', '')).toBe('/en/play')
    expect(switchLocaleHref('/play', 'en', '?')).toBe('/en/play')
  })
})

describe('язык в API', () => {
  test('withLang — en в запрос, ru без изменений', () => {
    expect(withLang('/api/recommend?x=1', 'ru')).toBe('/api/recommend?x=1')
    expect(withLang('/api/recommend?x=1', 'en')).toBe('/api/recommend?x=1&lang=en')
    expect(withLang('/api/daily', 'en')).toBe('/api/daily?lang=en')
    expect(withLang('/api/daily?lang=ru', 'en')).toBe('/api/daily?lang=en')
    expect(withLang('/api/x#y', 'en')).toBe('/api/x?lang=en#y')
    expect(withLang('https://imbored.cc/api/x?a=1', 'en')).toBe('https://imbored.cc/api/x?a=1&lang=en')
  })

  test('localeFromRequest читает ?lang', () => {
    expect(localeFromRequest(new Request('https://imbored.cc/api/x?lang=en'))).toBe('en')
    expect(localeFromRequest(new Request('https://imbored.cc/api/x?lang=de'))).toBe('ru')
    expect(localeFromRequest(new Request('https://imbored.cc/api/x'))).toBe('ru')
    expect(localeFromRequest({ url: '/api/x?lang=en' })).toBe('en')
    expect(localeFromRequest({ url: withLang('/api/x', 'en') })).toBe('en')
  })
})

describe('alternates — canonical и hreflang', () => {
  test('по умолчанию canonical русский', () => {
    expect(alternates('/privacy')).toEqual({
      canonical: '/privacy',
      languages: { ru: '/privacy', en: '/en/privacy', 'x-default': '/privacy' },
    })
  })

  test('canonical — на языке страницы, языки — те же', () => {
    expect(alternates('/game/730', 'en')).toEqual({
      canonical: '/en/game/730',
      languages: { ru: '/game/730', en: '/en/game/730', 'x-default': '/game/730' },
    })
    expect(alternates('/', 'en')).toEqual({
      canonical: '/en',
      languages: { ru: '/', en: '/en', 'x-default': '/' },
    })
  })
})

describe('preferredLocale — что показать на «/»', () => {
  test('кука важнее браузера в обе стороны', () => {
    expect(preferredLocale({ cookie: 'ru', acceptLanguage: 'en-US,en;q=0.9' })).toBe('ru')
    expect(preferredLocale({ cookie: 'en', acceptLanguage: 'ru-RU,ru;q=0.9' })).toBe('en')
    expect(preferredLocale({ cookie: 'en' })).toBe('en')
  })

  test('мусорная кука — как её нет', () => {
    expect(preferredLocale({ cookie: 'de', acceptLanguage: 'en-US,en;q=0.9' })).toBe('en')
    expect(preferredLocale({ cookie: '', acceptLanguage: 'ru' })).toBe(null)
  })

  test('без заголовка — null: краулер получает русскую главную', () => {
    expect(preferredLocale({})).toBe(null)
    expect(preferredLocale({ acceptLanguage: null, cookie: null })).toBe(null)
    expect(preferredLocale({ acceptLanguage: '' })).toBe(null)
  })

  test('английский — только выше русского', () => {
    expect(preferredLocale({ acceptLanguage: 'en-US,en;q=0.9' })).toBe('en')
    expect(preferredLocale({ acceptLanguage: 'en-US,en;q=0.9,ru;q=0.8' })).toBe('en')
    expect(preferredLocale({ acceptLanguage: 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7' })).toBe(null)
    expect(preferredLocale({ acceptLanguage: 'ru' })).toBe(null)
    expect(preferredLocale({ acceptLanguage: 'ru;q=0.5,en;q=0.9' })).toBe('en')
  })

  test('равный q — решает порядок', () => {
    expect(preferredLocale({ acceptLanguage: 'en,ru' })).toBe('en')
    expect(preferredLocale({ acceptLanguage: 'ru,en' })).toBe(null)
  })

  test('английский без русского — английский; ни того ни другого — null', () => {
    expect(preferredLocale({ acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8' })).toBe('en')
    expect(preferredLocale({ acceptLanguage: 'de-DE,de;q=0.9' })).toBe(null)
    expect(preferredLocale({ acceptLanguage: '*' })).toBe(null)
  })

  test('q=0 — «не надо», регистр и пробелы не в счёт', () => {
    expect(preferredLocale({ acceptLanguage: 'en;q=0' })).toBe(null)
    expect(preferredLocale({ acceptLanguage: ' EN-gb ; q=0.7 , ru ; q=0.6' })).toBe('en')
    expect(preferredLocale({ acceptLanguage: 'en;q=abc,ru;q=0.9' })).toBe('en')
  })
})

test('разделы — уникальны, без слэшей и в нижнем регистре', () => {
  expect(new Set(LOCALIZED_SECTIONS).size).toBe(LOCALIZED_SECTIONS.length)
  for (const s of LOCALIZED_SECTIONS) {
    expect(s, s).toMatch(/^[a-z][a-z-]*$/)
    expect(isLocale(s), s).toBe(false)
  }
  expect(LOCALIZED_SECTIONS).not.toContain('api')
})

test('fmtDate без своей зоны печатает UTC — как сервер', () => {
  // 23:30 UTC 9 октября — в Москве уже 10-е; разметка обязана сказать 9-е
  const late = Date.UTC(2025, 9, 9, 23, 30) / 1000
  expect(fmtDate('en', late, { day: 'numeric', month: 'long' })).toBe('October 9')
  expect(fmtDate('en', late, { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' })).toBe('October 10')
})

describe('routePaths — где лежит кэш ISR', () => {
  test('адрес раздела — обе копии под [lang]', () => {
    expect(routePaths('/game/730')).toEqual(['/ru/game/730', '/en/game/730'])
    expect(routePaths('/portrait/1/card.png')).toEqual(['/ru/portrait/1/card.png', '/en/portrait/1/card.png'])
    expect(routePaths('/')).toEqual(['/ru', '/en'])
    expect(routePaths('/en/game/730')).toEqual(['/ru/game/730', '/en/game/730'])
  })

  test('вне разделов — как есть', () => {
    expect(routePaths('/sitemap.xml')).toEqual(['/sitemap.xml'])
    expect(routePaths('/search-index.json')).toEqual(['/search-index.json'])
  })
})
