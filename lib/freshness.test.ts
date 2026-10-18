import { describe, expect, test } from 'vitest'
import { dateLabel, dayLabel, freshness, minutesAgoLabel, nextFreshnessTickMs } from './freshness'

const NOW = 1_700_000_000
const DAY = 86_400
const ago = (days: number, secs = 0) => NOW - days * DAY - secs

describe('freshness', () => {
  test('сегодня и вчера — словами', () => {
    expect(freshness(NOW, NOW)).toBe('сегодня')
    expect(freshness(ago(0, 3600), NOW)).toBe('сегодня')
    expect(freshness(ago(1), NOW)).toBe('вчера')
  })

  test('дни, недели, месяцы, годы — со склонением', () => {
    expect(freshness(ago(2), NOW)).toBe('2 дня назад')
    expect(freshness(ago(5), NOW)).toBe('5 дней назад')
    expect(freshness(ago(7), NOW)).toBe('неделю назад')
    expect(freshness(ago(21), NOW)).toBe('3 недели назад')
    expect(freshness(ago(35), NOW)).toBe('месяц назад')
    expect(freshness(ago(60), NOW)).toBe('2 месяца назад')
    expect(freshness(ago(400), NOW)).toBe('год назад')
    expect(freshness(ago(1900), NOW)).toBe('5 лет назад')
  })

  test('на подходе к году подпись не проваливается в «0 лет назад»', () => {
    // Границы считались по производным: m = days/30 при 360 днях уже 12, а
    // y = days/365 ещё 0. Пять дней в году подпись врала нулём.
    expect(freshness(ago(359), NOW)).toBe('11 месяцев назад')
    expect(freshness(ago(360), NOW)).toBe('12 месяцев назад')
    expect(freshness(ago(364), NOW)).toBe('12 месяцев назад')
    expect(freshness(ago(365), NOW)).toBe('год назад')
    // «10 месяцев назад» ноль содержит законно — врёт только ведущий
    for (let d = 2; d < 4000; d++) expect(freshness(ago(d), NOW).startsWith('0')).toBe(false)
  })

  test('запись из будущего не срывается в отрицательные сутки', () => {
    expect(freshness(NOW + 5000, NOW)).toBe('сегодня')
  })
})

describe('nextFreshnessTickMs', () => {
  test('будильник ставится на границу суток именно этой записи', () => {
    // до границы пять секунд — столько и спим
    expect(nextFreshnessTickMs([ago(1, -5)], NOW)).toBe(5000)
    expect(nextFreshnessTickMs([ago(3, -3600)], NOW)).toBe(3_600_000)
  })

  test('далёкая граница срезается потолком, а не ждёт сутки', () => {
    // опубликовано секунду назад: своя граница почти через сутки, но спать
    // столько нельзя — setTimeout не тикает в suspend, и проснувшийся ноутбук
    // показывал бы «сегодня» до следующего рендера
    expect(nextFreshnessTickMs([NOW - 1], NOW)).toBe(6 * 3_600_000)
  })

  test('берём ближайшую границу по всей ленте', () => {
    const items = [NOW - 1, ago(1, -10), ago(3, -50)]
    expect(nextFreshnessTickMs(items, NOW)).toBe(10_000)
  })

  test('пустая лента — потолок, а не ноль и не бесконечность', () => {
    const v = nextFreshnessTickMs([], NOW)
    expect(v).toBe(6 * 3_600_000)
  })

  test('никогда не чаще секунды: кривая дата из будущего не крутит цикл', () => {
    expect(nextFreshnessTickMs([NOW + 10 * DAY], NOW)).toBeGreaterThanOrEqual(1000)
    expect(nextFreshnessTickMs([NOW], NOW)).toBeGreaterThanOrEqual(1000)
  })

  test('никогда не реже шести часов: ноутбук просыпается и пересчитывает', () => {
    expect(nextFreshnessTickMs([NOW - 1], NOW)).toBeLessThanOrEqual(6 * 3_600_000)
  })
})

describe('minutesAgoLabel', () => {
  test('минуты, часы и дни — каждый в своих словах', () => {
    expect(minutesAgoLabel(0)).toBe('только что')
    expect(minutesAgoLabel(1)).toBe('1 мин назад')
    expect(minutesAgoLabel(59)).toBe('59 мин назад')
    expect(minutesAgoLabel(60)).toBe('1 час назад')
    expect(minutesAgoLabel(125)).toBe('2 часа назад')
    expect(minutesAgoLabel(300)).toBe('5 часов назад')
  })

  test('комната суточной давности не пишет «1380 мин назад»', () => {
    // Доска держит комнату до суток (PUBLIC_ROOM_MAX_AGE_SEC), и ровно это
    // подпись и показывала до появления часов.
    expect(minutesAgoLabel(1380)).toBe('23 часа назад')
    expect(minutesAgoLabel(1440)).toBe('1 день назад')
  })
})

describe('dayLabel', () => {
  test('ключ суток превращается в подпись', () => {
    expect(dayLabel('2026-08-19')).toBe('19 августа')
    expect(dayLabel('2026-01-01')).toBe('1 января')
    expect(dayLabel('2026-12-31')).toBe('31 декабря')
  })

  test('зона зафиксирована: подпись не зависит от TZ рантайма', () => {
    // toLocaleDateString без timeZone берёт зону процесса. На Vercel это UTC,
    // но зависимость подразумеваемая — достаточно кому-нибудь задать TZ, и
    // подпись разъедется с ключом записи навсегда.
    const tz = process.env.TZ
    try {
      process.env.TZ = 'Pacific/Kiritimati' // UTC+14
      expect(dayLabel('2026-08-19')).toBe('19 августа')
      process.env.TZ = 'Pacific/Niue' // UTC-11
      expect(dayLabel('2026-08-19')).toBe('19 августа')
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })
})

describe('dateLabel', () => {
  test('дата события словами, с годом и без', () => {
    // 2026-08-12T22:50:00Z — вечер по UTC
    const at = Math.floor(Date.UTC(2026, 7, 12, 22, 50) / 1000)
    expect(dateLabel(at)).toBe('12 августа')
    expect(dateLabel(at, { year: true })).toBe('12 августа 2026 г.')
  })

  test('зона зафиксирована — сервер и браузер печатают один день', () => {
    // Ровно тот разрыв, который ломал гидратацию: событие после 21:00 UTC.
    // На /game/730 так расходились четыре подписи из шести.
    const at = Math.floor(Date.UTC(2026, 7, 12, 22, 50) / 1000)
    const tz = process.env.TZ
    try {
      const seen = new Set<string>()
      for (const zone of ['UTC', 'Europe/Moscow', 'Asia/Vladivostok', 'America/Los_Angeles']) {
        process.env.TZ = zone
        seen.add(dateLabel(at, { year: true }))
      }
      expect(seen.size).toBe(1)
      expect([...seen][0]).toBe('12 августа 2026 г.')
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })
})

/** Кириллица в английской подписи — недопереведённый кусок */
const CYRILLIC = /[А-Яа-яЁё]/

/**
 * Английская версия: те же границы, свои слова. Русский по умолчанию держат
 * тесты выше — без языка функции отвечают ровно как раньше.
 */
describe('по-английски', () => {
  test('freshness: единица без цифры — с артиклем, дальше числом', () => {
    const en = (days: number, secs = 0) => freshness(ago(days, secs), NOW, 'en')
    expect(en(0, 3600)).toBe('today')
    expect(en(1)).toBe('yesterday')
    expect(en(2)).toBe('2 days ago')
    expect(en(7)).toBe('a week ago')
    expect(en(21)).toBe('3 weeks ago')
    expect(en(35)).toBe('a month ago')
    expect(en(60)).toBe('2 months ago')
    expect(en(364)).toBe('12 months ago')
    expect(en(400)).toBe('a year ago')
    expect(en(1900)).toBe('5 years ago')
    expect(freshness(NOW + 5000, NOW, 'en')).toBe('today')
    for (let d = 0; d < 4000; d += 3) {
      const label = en(d)
      expect(label, String(d)).not.toMatch(CYRILLIC)
      expect(label.startsWith('0'), String(d)).toBe(false)
    }
  })

  test('minutesAgoLabel: минуты сокращением, час и день — словами', () => {
    expect(minutesAgoLabel(0, 'en')).toBe('just now')
    expect(minutesAgoLabel(1, 'en')).toBe('1 min ago')
    expect(minutesAgoLabel(59, 'en')).toBe('59 min ago')
    expect(minutesAgoLabel(60, 'en')).toBe('an hour ago')
    expect(minutesAgoLabel(125, 'en')).toBe('2 hours ago')
    expect(minutesAgoLabel(1380, 'en')).toBe('23 hours ago')
    expect(minutesAgoLabel(1440, 'en')).toBe('a day ago')
    expect(minutesAgoLabel(2 * 1440, 'en')).toBe('2 days ago')
  })

  test('dayLabel и dateLabel: месяц словом, в UTC', () => {
    expect(dayLabel('2026-08-19', 'en')).toBe('August 19')
    expect(dayLabel('2026-01-01', 'en')).toBe('January 1')
    const at = Math.floor(Date.UTC(2026, 7, 12, 22, 50) / 1000)
    expect(dateLabel(at, { locale: 'en' })).toBe('August 12')
    expect(dateLabel(at, { year: true, locale: 'en' })).toBe('August 12, 2026')
    // явный ru — тот же ответ, что без языка
    expect(dateLabel(at, { year: true, locale: 'ru' })).toBe(dateLabel(at, { year: true }))
  })

  test('английская дата тоже не зависит от зоны рантайма', () => {
    const at = Math.floor(Date.UTC(2026, 7, 12, 22, 50) / 1000)
    const tz = process.env.TZ
    try {
      const seen = new Set<string>()
      for (const zone of ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
        process.env.TZ = zone
        seen.add(dateLabel(at, { year: true, locale: 'en' }))
        seen.add(`${dayLabel('2026-08-12', 'en')}, 2026`)
      }
      expect([...seen]).toEqual(['August 12, 2026'])
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })
})
