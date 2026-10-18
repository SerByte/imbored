import { describe, expect, test } from 'vitest'
import {
  PRICE_TRUST_SEC,
  discountEndsLabel,
  discountOf,
  discountTrustedUntil,
  discountView,
  trustedPrice,
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

  test('calendar — только датой: страница из недельного кэша не считает дни', () => {
    // Отсчёт на карточке игры был бы неправдой назавтра и новым выводом
    // страницы каждые сутки — то есть записью ISR без единой новой строки
    // в базе. Дата одна и та же весь срок акции.
    const endsAt = NOW + 10 * DAY
    for (const now of [NOW, NOW + 7 * DAY, NOW + 9.5 * DAY]) {
      expect(discountEndsLabel(endsAt, now, { calendar: true })).toBe('до 24 ноября')
    }
    expect(discountEndsLabel(endsAt, endsAt, { calendar: true })).toBeNull()
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

  test('без срочности — та же скидка, но без обратного отсчёта', () => {
    const view = discountView(onSale({ discountEndsAt: NOW + 2 * DAY }), NOW, { urgency: false })
    expect(view?.percent).toBe(50)
    expect(view?.finalCents).toBe(999)
    expect(view?.endsLabel).toBeUndefined()
    // По умолчанию срок на месте: подбор, лента и колоды не меняются
    expect(discountView(onSale({ discountEndsAt: NOW + 2 * DAY }), NOW)?.endsLabel).toBe(
      'осталось 2 дня',
    )
  })

  test('calendar — срок датой и в последние дни', () => {
    const meta = onSale({ discountEndsAt: NOW + 2 * DAY })
    expect(discountView(meta, NOW, { calendar: true })?.endsLabel).toBe('до 16 ноября')
    expect(discountView(meta, NOW + DAY, { calendar: true })).toEqual(
      discountView(meta, NOW, { calendar: true }),
    )
  })
})

describe('discountTrustedUntil', () => {
  test('названный Steam срок — он и есть граница', () => {
    const meta = onSale({ priceAt: NOW - 30 * DAY, discountEndsAt: NOW + 2 * DAY })
    expect(discountTrustedUntil(meta, NOW)).toBe(NOW + 2 * DAY)
  })

  test('без срока — замер плюс PRICE_TRUST_SEC, ровно где гаснет discountOf', () => {
    const meta = onSale({ priceAt: NOW - HOUR })
    const until = discountTrustedUntil(meta, NOW)
    expect(until).toBe(NOW - HOUR + PRICE_TRUST_SEC)
    expect(discountOf(meta, until! - 1)).not.toBeNull()
    expect(discountOf(meta, until! + 1)).toBeNull()
  })

  test('скидки нет или ей уже не верят — границы нет', () => {
    expect(discountTrustedUntil(onSale({ discountPercent: 0, priceInitial: 999 }), NOW)).toBeNull()
    expect(discountTrustedUntil(onSale({ priceAt: NOW - PRICE_TRUST_SEC - 1 }), NOW)).toBeNull()
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

/**
 * Английская подпись срока: те же границы, своя фраза. Подпись считает
 * сервер на языке запроса — клиент рисует её как есть.
 */
describe('срок скидки по-английски', () => {
  const CYRILLIC = /[А-Яа-яЁё]/

  test('сутки, дни и дата — словами глоссария', () => {
    expect(discountEndsLabel(NOW + 5 * HOUR, NOW, { locale: 'en' })).toBe('last day today')
    expect(discountEndsLabel(NOW + 1.5 * DAY, NOW, { locale: 'en' })).toBe('1 day left')
    expect(discountEndsLabel(NOW + 2.5 * DAY, NOW, { locale: 'en' })).toBe('2 days left')
    expect(discountEndsLabel(NOW + 3.5 * DAY, NOW, { locale: 'en' })).toBe('3 days left')
    // 1700000000 — 14 ноября 2023 UTC, плюс десять суток
    expect(discountEndsLabel(NOW + 10 * DAY, NOW, { locale: 'en' })).toBe('until Nov 24')
    expect(discountEndsLabel(NOW - 1, NOW, { locale: 'en' })).toBeNull()
  })

  test('calendar — датой и по-английски, в UTC: день не уезжает у Тихого океана', () => {
    // 23:30 UTC — в Лос-Анджелесе ещё 24-е, в Москве уже 25-е; подпись одна
    const endsAt = Math.floor(Date.UTC(2023, 10, 24, 23, 30) / 1000)
    const tz = process.env.TZ
    try {
      for (const zone of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        process.env.TZ = zone
        expect(discountEndsLabel(endsAt, NOW, { calendar: true, locale: 'en' }), zone).toBe('until Nov 24')
      }
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })

  test('discountView печёт подпись на языке запроса', () => {
    const meta = onSale({ discountEndsAt: NOW + 2 * DAY })
    expect(discountView(meta, NOW, { locale: 'en' })?.endsLabel).toBe('2 days left')
    expect(discountView(meta, NOW, { calendar: true, locale: 'en' })?.endsLabel).toBe('until Nov 16')
    expect(discountView(meta, NOW, { urgency: false, locale: 'en' })?.endsLabel).toBeUndefined()
    // явный ru — ровно то, что без языка
    expect(discountView(meta, NOW, { locale: 'ru' })).toEqual(discountView(meta, NOW))
  })

  test('битый срок — без подписи, а не исключение на всю страницу', () => {
    // Intl на Invalid Date бросает RangeError; срок NaN или Infinity из кривой
    // записи уронил бы страницу с ценой в error.tsx
    for (const endsAt of [Number.NaN, Number.POSITIVE_INFINITY, 1e16]) {
      for (const calendar of [false, true]) {
        expect(discountEndsLabel(endsAt, NOW, { calendar, locale: 'en' }), `${endsAt} ${calendar}`).toBeNull()
        // русская ветка не бросала и не бросает
        expect(() => discountEndsLabel(endsAt, NOW, { calendar })).not.toThrow()
      }
    }
    const view = discountView(onSale({ discountEndsAt: Number.NaN }), NOW, { locale: 'en' })
    expect(view?.percent).toBe(50)
    expect(view?.endsLabel).toBeUndefined()
  })

  test('ни одной русской буквы ни на одном сроке', () => {
    for (const left of [HOUR, 1.2 * DAY, 2.2 * DAY, 3.2 * DAY, 10 * DAY, 200 * DAY]) {
      for (const calendar of [false, true]) {
        const label = discountEndsLabel(NOW + left, NOW, { calendar, locale: 'en' })
        expect(label, `${left} ${calendar}`).not.toMatch(CYRILLIC)
      }
    }
  })
})
