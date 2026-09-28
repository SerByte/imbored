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
