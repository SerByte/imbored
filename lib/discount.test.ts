import { describe, expect, test } from 'vitest'
import {
  PRICE_TRUST_SEC,
  discountEndsLabel,
  discountOf,
  discountView,
  formatPrice,  trustedPrice,
} from './discount'
import type { GameMeta } from './types'

const NOW = 1_700_000_000
const HOUR = 3600
const DAY = 86_400

/** Игра со скидкой −50%, замеренной только что */
function onSale(over: Partial<GameMeta> = {}): GameMeta {
  return {
    appid: 1,
    name: 'Игра 1',
    tags: {},
    genres: [],
    categories: [2],
    priceFinal: 999,
    priceInitial: 1999,
    discountPercent: 50,
    priceAt: NOW,
    ...over,
  }
}

describe('discountOf', () => {
  test('свежий замер со скидкой показывается', () => {
    expect(discountOf(onSale(), NOW)).toEqual({
      percent: 50,
      finalCents: 999,
      initialCents: 1999,
    })
  })

  test('полная цена — не скидка', () => {
    expect(discountOf(onSale({ discountPercent: 0, priceInitial: 999 }), NOW)).toBeNull()
  })

  test('срок в прошлом гасит скидку даже у свежего замера', () => {
    // Распродажа кончилась ровно тогда, когда обещала: замер был час назад,
    // но верить ему больше нечему
    const meta = onSale({ priceAt: NOW - HOUR, discountEndsAt: NOW - 60 })
    expect(discountOf(meta, NOW)).toBeNull()
  })

  test('срок в будущем оживляет старый замер — Steam сам назвал дату', () => {
    const meta = onSale({ priceAt: NOW - 30 * DAY, discountEndsAt: NOW + 2 * DAY })
    expect(discountOf(meta, NOW)?.endsAt).toBe(NOW + 2 * DAY)
  })

  test('старый замер без срока не показывается', () => {
    // Главная защита от вранья: метаданные живут две недели, распродажа — дни.
    // Без этой проверки «−50%» висело бы на карточке ещё десять дней.
    const meta = onSale({ priceAt: NOW - PRICE_TRUST_SEC - 1 })
    expect(discountOf(meta, NOW)).toBeNull()
    expect(discountOf(onSale({ priceAt: NOW - PRICE_TRUST_SEC + 1 }), NOW)).not.toBeNull()
  })

  test('замера не было вовсе — скидке верить нечему', () => {
    const noMeasure = onSale()
    delete noMeasure.priceAt
    expect(discountOf(noMeasure, NOW)).toBeNull()
  })

  test('битые данные не превращаются в скидку', () => {
    expect(discountOf(onSale({ priceInitial: 999 }), NOW)).toBeNull()
    expect(discountOf(onSale({ priceInitial: 500 }), NOW)).toBeNull()
    const noPrice = onSale()
    delete noPrice.priceFinal
    expect(discountOf(noPrice, NOW)).toBeNull()
  })

  test('процент больше 99 срезается — на карточке это ширина плашки', () => {
    expect(discountOf(onSale({ discountPercent: 100 }), NOW)?.percent).toBe(99)
  })
})

describe('discountEndsLabel', () => {
  test('меньше суток — сегодня последний день', () => {
    expect(discountEndsLabel(NOW + 5 * HOUR, NOW)).toBe('сегодня последний день')
  })

  test('пара дней — считаем днями, с русским окончанием', () => {
    expect(discountEndsLabel(NOW + 1.5 * DAY, NOW)).toBe('остался 1 день')
    expect(discountEndsLabel(NOW + 2.5 * DAY, NOW)).toBe('осталось 2 дня')
  })

  test('дальше трёх дней — датой', () => {
    // 1700000000 — 14 ноября 2023 UTC, плюс десять суток
    expect(discountEndsLabel(NOW + 10 * DAY, NOW)).toBe('до 24 ноября')
  })

  test('срок в прошлом подписи не даёт', () => {
    expect(discountEndsLabel(NOW - 1, NOW)).toBeNull()
  })
})

describe('discountView', () => {
  test('подпись срока считается здесь — у клиента свой часовой пояс', () => {
    const view = discountView(onSale({ discountEndsAt: NOW + 10 * DAY }), NOW)
    expect(view?.endsLabel).toBe('до 24 ноября')
  })

  test('без срока подписи нет, а скидка есть', () => {
    const view = discountView(onSale(), NOW)
    expect(view?.percent).toBe(50)
    expect(view?.endsLabel).toBeUndefined()
  })
})

describe('formatPrice', () => {
  test('центы превращаются в цену с двумя знаками', () => {
    expect(formatPrice(999)).toBe('$9.99')
    expect(formatPrice(0)).toBe('$0.00')
    expect(formatPrice(5999)).toBe('$59.99')
  })
})

describe('trustedPrice', () => {
  test('цена без скидки отдаётся как есть, даже если замер старый', () => {
    // Неточная цена — полбеды; правило модуля.
    expect(trustedPrice({ priceFinal: 1999 }, NOW)).toBe(1999)
    expect(trustedPrice({ priceFinal: 1999, discountPercent: 0, priceAt: NOW - 10 * DAY }, NOW)).toBe(1999)
  })

  test('живая скидка — цена акционная и её показывать можно', () => {
    expect(trustedPrice(onSale(), NOW)).toBe(999)
  })

  test('срок скидки вышел — цены нет вовсе', () => {
    // Ровно случай Heavy Rain: $0.99 при настоящих $19.99. Показывать
    // price_final как обычную цену — не неточность, а двадцатая часть правды.
    expect(trustedPrice(onSale({ discountEndsAt: NOW - 1 }), NOW)).toBeNull()
  })

  test('замер скидки протух — цены тоже нет', () => {
    expect(trustedPrice(onSale({ priceAt: NOW - PRICE_TRUST_SEC - 1 }), NOW)).toBeNull()
  })

  test('price_initial не подставляется: «продлили» и «кончилась» неразличимы', () => {
    const dead = onSale({ discountEndsAt: NOW - 1 })
    expect(trustedPrice(dead, NOW)).not.toBe(dead.priceInitial)
    expect(trustedPrice(dead, NOW)).toBeNull()
  })

  test('про цену ничего не известно — тоже null', () => {
    expect(trustedPrice({}, NOW)).toBeNull()
  })
})
