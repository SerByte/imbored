import { describe, expect, test } from 'vitest'
import { heuristicProsCons, parseReviews } from './reviews'

const RESPONSE = {
  success: 1,
  query_summary: {
    num_reviews: 3,
    review_score: 8,
    review_score_desc: 'Very Positive',
    total_positive: 1000,
    total_negative: 100,
    total_reviews: 1100,
  },
  reviews: [
    {
      recommendationid: 'r1',
      review: 'Отличная игра',
      voted_up: true,
      votes_up: 50,
      author: { playtime_at_review: 600, playtime_forever: 900 },
    },
    {
      recommendationid: 'r1',
      review: 'дубль',
      voted_up: true,
      votes_up: 1,
      author: { playtime_at_review: 600 },
    },
    {
      recommendationid: 'r2',
      review: 'наиграл 10 минут, зря',
      voted_up: false,
      votes_up: 3,
      author: { playtime_at_review: 10 },
    },
    {
      recommendationid: 'r3',
      review: 'Норм',
      voted_up: false,
      votes_up: 7,
      author: { playtime_at_review: 300 },
    },
  ],
}

describe('parseReviews', () => {
  test('маппит summary и отзывы, отсекая <2ч и дубли', () => {
    const parsed = parseReviews(RESPONSE)
    expect(parsed).not.toBeNull()
    expect(parsed!.scoreDesc).toBe('Very Positive')
    expect(parsed!.totalPositive).toBe(1000)
    expect(parsed!.totalNegative).toBe(100)
    expect(parsed!.reviews.map((r) => r.id)).toEqual(['r1', 'r3'])
    expect(parsed!.reviews[0]).toMatchObject({ votedUp: true, playtimeAtReview: 600 })
  })

  test('success!=1 даёт null', () => {
    expect(parseReviews({ success: 2 })).toBeNull()
  })
})

describe('heuristicProsCons', () => {
  const reviews = [
    { id: 'a', text: 'Лучший кооп в моей жизни. Дальше много текста который не должен попасть.', votedUp: true, votesUp: 90, playtimeAtReview: 600 },
    { id: 'b', text: 'Затягивает на сотни часов!', votedUp: true, votesUp: 50, playtimeAtReview: 900 },
    { id: 'c', text: 'Оптимизация хромает, на моей карте лагает.', votedUp: false, votesUp: 40, playtimeAtReview: 300 },
    { id: 'd', text: 'Сервера падают по вечерам', votedUp: false, votesUp: 20, playtimeAtReview: 240 },
    { id: 'e', text: 'Мало голосов', votedUp: true, votesUp: 1, playtimeAtReview: 300 },
  ]

  test('плюсы из позитивных по голосам, минусы из негативных, первое предложение', () => {
    const { pros, cons } = heuristicProsCons(reviews, 2)
    expect(pros).toEqual(['Лучший кооп в моей жизни', 'Затягивает на сотни часов!'])
    expect(cons).toEqual(['Оптимизация хромает, на моей карте лагает', 'Сервера падают по вечерам'])
  })

  test('пустой вход не роняет', () => {
    expect(heuristicProsCons([], 3)).toEqual({ pros: [], cons: [] })
  })
})
