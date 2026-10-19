import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  byPrices,
  formatPrice,
  LEGACY_PRICE_CC,
  META_CC,
  notSold,
  notSoldShort,
  priceRegion,
  priceWhere,
  regionCurrency,
  STEAM_REGIONS,
  steamRegion,
} from './steamregion'

/** Неразрывный пробел: им Intl в ru-RU разбивает разряды и отделяет знак */
const NB = String.fromCharCode(0xa0)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('регион', () => {
  test('нормализуется: регистр и пробелы не важны, неизвестное — us', () => {
    expect(steamRegion(' RU ')).toBe('ru')
    expect(steamRegion('KZ')).toBe('kz')
    // «eu» стоял в старом .env.example, а такого региона у Steam нет
    for (const raw of ['eu', 'uk', '', 'россия', null, undefined]) {
      expect(steamRegion(raw), String(raw)).toBe(LEGACY_PRICE_CC)
    }
    expect(LEGACY_PRICE_CC).toBe('us')
    expect(META_CC).toBe('us')
  })

  test('регион цен читается из STEAM_STORE_CC на каждый вызов', () => {
    expect(priceRegion({})).toBe('us')
    vi.stubEnv('STEAM_STORE_CC', 'ru')
    expect(priceRegion()).toBe('ru')
    vi.stubEnv('STEAM_STORE_CC', 'kz')
    expect(priceRegion()).toBe('kz')
  })

  test('опечатка в переменной — us и одна строка в лог на процесс, а не падение', async () => {
    vi.resetModules()
    const fresh = await import('./steamregion')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(fresh.priceRegion({ STEAM_STORE_CC: 'eu' })).toBe('us')
    expect(fresh.priceRegion({ STEAM_STORE_CC: 'eu' })).toBe('us')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('steam-region-unknown')
    // пустая переменная — не опечатка: её просто не задали
    expect(fresh.priceRegion({ STEAM_STORE_CC: '' })).toBe('us')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('валюта региона; Турция и Аргентина — в долларах с 2023-го', () => {
    expect(regionCurrency('ru')).toBe('RUB')
    expect(regionCurrency('us')).toBe('USD')
    expect(regionCurrency('tr')).toBe('USD')
    expect(regionCurrency('ar')).toBe('USD')
    expect(regionCurrency('мусор')).toBe('USD')
  })
})

describe('formatPrice', () => {
  test('по-русски, знаком после числа, с неразрывными пробелами', () => {
    // BG3: 1 999 ₽ в российском Steam и 59,99 $ в американском
    expect(formatPrice(199_900, 'ru')).toBe(`1${NB}999${NB}₽`)
    expect(formatPrice(5999, 'us')).toBe(`59,99${NB}$`)
    expect(formatPrice(449_900, 'kz')).toBe(`4${NB}499${NB}₸`)
  })

  test('копейки и центы — только когда они есть', () => {
    expect(formatPrice(199_950, 'ru')).toBe(`1${NB}999,50${NB}₽`)
    expect(formatPrice(6000, 'us')).toBe(`60${NB}$`)
    expect(formatPrice(0, 'ru')).toBe(`0${NB}₽`)
  })

  test('целыми — с округлением: для строк, где копейкам нет места', () => {
    expect(formatPrice(5999, 'us', { whole: true })).toBe(`60${NB}$`)
    expect(formatPrice(4_150_049, 'ru', { whole: true })).toBe(`41${NB}500${NB}₽`)
  })

  test('каждая валюта таблицы проходит Intl — неизвестный код уронил бы ценник', () => {
    for (const cc of Object.keys(STEAM_REGIONS)) {
      const text = formatPrice(123_456, cc)
      expect(text, cc).toMatch(/^1\u00a0234,56\u00a0\S+$/)
      expect(formatPrice(123_400, cc, { whole: true }), cc).toMatch(/^1\u00a0234\u00a0\S+$/)
    }
  })
})

describe('подписи', () => {
  test('российский и американский регионы — по-русски и в нужном падеже', () => {
    expect(priceWhere('ru')).toBe('цена в российском Steam')
    expect(notSold('ru')).toBe('не продаётся в российском Steam')
    expect(notSoldShort('ru')).toBe('нет в российском Steam')
    expect(byPrices('ru')).toBe('по ценам российского Steam')
    expect(priceWhere('us')).toBe('цена в американском Steam')
    expect(byPrices('us')).toBe('по ценам американского Steam')
  })

  test('у каждого региона таблицы есть обе формы', () => {
    // «в российском» и «российского» — одна основа, разные падежи
    for (const [cc, r] of Object.entries(STEAM_REGIONS)) {
      expect(r.where, cc).toMatch(/ом$/)
      expect(r.whose, cc).toBe(`${r.where.slice(0, -2)}ого`)
    }
  })
})

/**
 * Регион цен — решение сервера. В клиентском бандле STEAM_STORE_CC нет, и
 * priceRegion там молча ответила бы «us» у всех: ценник в браузере рисовал бы
 * доллары рядом с рублёвыми числами. Клиент получает регион рядом с ценой.
 */
describe('сторож: клиентский код не зовёт priceRegion', () => {
  const ROOT = path.join(__dirname, '..')

  function clientFiles(): Array<[string, string]> {
    const out: Array<[string, string]> = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`
        if (e.isDirectory()) walk(rel)
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
          if (/^\s*['"]use client['"]/.test(src)) out.push([rel, src])
        }
      }
    }
    for (const dir of ['app', 'components', 'lib']) walk(dir)
    return out
  }

  test('ни один файл с use client не читает регион сам', () => {
    const files = clientFiles()
    // сторож, который ничего не нашёл, — сломанный сторож
    expect(files.length).toBeGreaterThan(10)
    expect(files.filter(([, src]) => /\bpriceRegion\s*\(/.test(src)).map(([f]) => f)).toEqual([])
  })
})

/**
 * Английская версия показывает те же цены того же региона — регион один на
 * развёртывание. Поэтому подпись называет его прямо, а не «your region»:
 * регион читателя сервис не знает.
 */
describe('по-английски', () => {
  const CYRILLIC = /[А-Яа-яЁё]/

  test('formatPrice: знак перед числом, разряды запятой, центы — только когда есть', () => {
    expect(formatPrice(5999, 'us', { locale: 'en' })).toBe('$59.99')
    expect(formatPrice(6000, 'us', { locale: 'en' })).toBe('$60')
    expect(formatPrice(5999, 'us', { whole: true, locale: 'en' })).toBe('$60')
    expect(formatPrice(199_900, 'ru', { locale: 'en' })).toBe('₽1,999')
    expect(formatPrice(199_950, 'ru', { locale: 'en' })).toBe('₽1,999.50')
    expect(formatPrice(4_150_049, 'ru', { whole: true, locale: 'en' })).toBe('₽41,500')
    expect(formatPrice(0, 'ru', { locale: 'en' })).toBe('₽0')
  })

  test('кэш форматтеров различает языки: русский вызов после английского — снова русский', () => {
    expect(formatPrice(5999, 'us', { locale: 'en' })).toBe('$59.99')
    expect(formatPrice(5999, 'us')).toBe(`59,99${NB}$`)
    expect(formatPrice(5999, 'us', { locale: 'en' })).toBe('$59.99')
  })

  test('каждая валюта таблицы проходит Intl и по-английски', () => {
    for (const cc of Object.keys(STEAM_REGIONS)) {
      expect(formatPrice(123_456, cc, { locale: 'en' }), cc).toMatch(/1,234\.56/)
      expect(formatPrice(123_400, cc, { whole: true, locale: 'en' }), cc).toMatch(/1,234(?!\.)/)
    }
  })

  test('подписи называют регион развёртывания прямо', () => {
    expect(priceWhere('ru', 'en')).toBe('price on Russian Steam')
    expect(notSold('ru', 'en')).toBe('not sold on Russian Steam')
    expect(notSoldShort('ru', 'en')).toBe('not on Russian Steam')
    expect(byPrices('ru', 'en')).toBe('at Russian Steam prices')
    expect(priceWhere('us', 'en')).toBe('price on US Steam')
    expect(byPrices('us', 'en')).toBe('at US Steam prices')
    // неизвестный регион — как у русских подписей, LEGACY_PRICE_CC
    expect(priceWhere('мусор', 'en')).toBe('price on US Steam')
  })

  test('у каждого региона есть английское прилагательное, без кириллицы и без «your»', () => {
    for (const [cc, r] of Object.entries(STEAM_REGIONS)) {
      expect(r.en, cc).toMatch(/^[A-Z][A-Za-z]+$/)
      for (const label of [priceWhere(cc, 'en'), notSold(cc, 'en'), notSoldShort(cc, 'en'), byPrices(cc, 'en')]) {
        expect(label, cc).not.toMatch(CYRILLIC)
        expect(label, cc).not.toMatch(/\byour\b/i)
      }
    }
  })

  test('короткая подпись для чипа колоды не длиннее русской там, где сервис живёт', () => {
    // ru — регион развёртывания, us — прежний (LEGACY_PRICE_CC). Буквы
    // кириллицы шире латиницы, так что равная длина в символах — запас
    for (const cc of ['ru', 'us']) {
      expect(notSoldShort(cc, 'en').length, cc).toBeLessThanOrEqual(notSoldShort(cc).length)
    }
  })

  test('явный ru — те же строки, что без языка', () => {
    expect(formatPrice(199_900, 'ru', { locale: 'ru' })).toBe(formatPrice(199_900, 'ru'))
    expect(priceWhere('ru', 'ru')).toBe(priceWhere('ru'))
    expect(byPrices('us', 'ru')).toBe(byPrices('us'))
  })
})
