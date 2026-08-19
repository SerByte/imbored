import { describe, expect, test } from 'vitest'
import { freshness, minutesAgoLabel, nextFreshnessTickMs } from './freshness'

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
    expect(freshness(ago(7), NOW)).toBe('1 неделю назад')
    expect(freshness(ago(21), NOW)).toBe('3 недели назад')
    expect(freshness(ago(60), NOW)).toBe('2 месяца назад')
    expect(freshness(ago(400), NOW)).toBe('1 год назад')
    expect(freshness(ago(1900), NOW)).toBe('5 лет назад')
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
