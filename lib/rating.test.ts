import { describe, expect, test } from 'vitest'
import { ratingOf } from './rating'

const SUMMARY = { scoreDesc: 'Very Positive', totalPositive: 900, totalNegative: 100 }

describe('ratingOf', () => {
  test('сводка сильнее каталога: у неё есть словесная оценка от самого Steam', () => {
    expect(ratingOf({ reviewsPercent: 86, reviewsTotal: 2_593_099 }, SUMMARY)).toEqual({
      percent: 90,
      total: 1000,
      label: 'Very Positive',
      source: 'summary',
    })
  })

  test('без сводки берётся сигнал каталога — он есть у всех пяти тысяч', () => {
    // Это и есть суть модуля: reviews_percent и reviews_total приезжают с
    // разбором выдачи магазина и заполнены на 100 % топа карты сайта, а
    // reviews_summary_json — только у обогащённых, то есть у 14,5 %.
    expect(ratingOf({ reviewsPercent: 86, reviewsTotal: 2_593_099 }, null)).toEqual({
      percent: 86,
      total: 2_593_099,
      source: 'catalog',
    })
  })

  test('у сигнала каталога словесной оценки нет, и выдумывать её нельзя', () => {
    // Пороги Steam зависят ещё и от числа отзывов; вычислять их за него значило
    // бы показывать подпись, которой на странице игры в Steam может не быть.
    expect(ratingOf({ reviewsPercent: 70, reviewsTotal: 100 }, null)).not.toHaveProperty('label')
  })

  test('пустая сводка не заслоняет каталог', () => {
    // Обогащение доходило, но Steam отдал ноль отзывов: считать нечего, а
    // каталожный сигнал при этом на месте.
    const empty = { scoreDesc: 'Mixed', totalPositive: 0, totalNegative: 0 }
    expect(ratingOf({ reviewsPercent: 64, reviewsTotal: 5_000 }, empty)).toEqual({
      percent: 64,
      total: 5_000,
      source: 'catalog',
    })
  })

  test('ноль процентов — это оценка, а не отсутствие данных', () => {
    expect(ratingOf({ reviewsPercent: 0, reviewsTotal: 300 }, null)).toEqual({
      percent: 0,
      total: 300,
      source: 'catalog',
    })
  })

  test('нечего показать — null, а не нули', () => {
    expect(ratingOf({}, null)).toBeNull()
    expect(ratingOf({ reviewsPercent: 80 }, null)).toBeNull()
    expect(ratingOf({ reviewsTotal: 0, reviewsPercent: 80 }, null)).toBeNull()
    expect(ratingOf({ reviewsTotal: 500 }, null)).toBeNull()
  })

  test('процент сводки округляется так же, как рисует кольцо', () => {
    expect(ratingOf({}, { scoreDesc: 'Mixed', totalPositive: 2, totalNegative: 1 })?.percent).toBe(67)
  })
})
