import { describe, expect, test } from 'vitest'
import { HERO_WINDOW_SEC, splitFeed } from './newsfeed'

const NOW = 1_700_000_000
const DAY = 86_400

/** Лента приезжает отсортированной по убыванию даты — тесты держат тот же порядок */
function item(id: string, daysAgo: number, rank: number) {
  return { id, publishedAt: NOW - daysAgo * DAY, rank }
}

describe('splitFeed', () => {
  test('обложкой становится самый весомый в окне, а не самый свежий', () => {
    const items = [item('свежий', 0, 5_000), item('громкий', 3, 500_000), item('средний', 5, 50_000)]
    const { hero, rest } = splitFeed(items, NOW)
    expect(hero?.id).toBe('громкий')
    // остаток сохраняет хронологию и не содержит героя
    expect(rest.map((i) => i.id)).toEqual(['свежий', 'средний'])
  })

  test('в окне никого — берём самый свежий, каким бы мелким он ни был', () => {
    const items = [item('свежий', 9, 1_000), item('старый гигант', 40, 900_000)]
    expect(splitFeed(items, NOW).hero?.id).toBe('свежий')
  })

  test('элемент ровно на границе окна ещё участвует', () => {
    const items = [item('свежий', 0, 1_000), item('на границе', 7, 900_000)]
    expect(splitFeed(items, NOW).hero?.id).toBe('на границе')
    // а на секунду раньше — уже нет
    const past = [item('свежий', 0, 1_000), { id: 'за краем', publishedAt: NOW - HERO_WINDOW_SEC - 1, rank: 900_000 }]
    expect(splitFeed(past, NOW).hero?.id).toBe('свежий')
  })

  test('при равном весе выигрывает более свежий', () => {
    const items = [item('свежий', 1, 100_000), item('вчерашний', 4, 100_000)]
    expect(splitFeed(items, NOW).hero?.id).toBe('свежий')
  })

  test('windowSec = 0 — это личная лента: обложка всегда самая свежая', () => {
    const items = [item('свежий', 0, 5_000), item('громкий', 3, 500_000)]
    const { hero, rest } = splitFeed(items, NOW, 0)
    expect(hero?.id).toBe('свежий')
    expect(rest.map((i) => i.id)).toEqual(['громкий'])
  })

  test('пустая лента не даёт обложки', () => {
    expect(splitFeed([], NOW)).toEqual({ rest: [] })
  })

  test('единственный элемент уходит в обложку, остаток пуст', () => {
    const { hero, rest } = splitFeed([item('один', 30, 10)], NOW)
    expect(hero?.id).toBe('один')
    expect(rest).toEqual([])
  })
})
