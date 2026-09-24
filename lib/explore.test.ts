import { describe, expect, test } from 'vitest'
import { EXPLORE_DECK, EXPLORE_PASS_SEC, exploreDeck, exploredAppids } from './explore'
import type { CandidateSource } from './types'

const c = (appid: number, source: CandidateSource, score: number) => ({ appid, source, score })

describe('exploreDeck', () => {
  test('своё и каталог по очереди, начиная с сильной головы', () => {
    const own = [c(1, 'untouched', 0.9), c(2, 'backlog', 0.5), c(3, 'comeback', 0.4)]
    const discovery = [c(10, 'new', 0.7), c(11, 'new', 0.6)]
    expect(exploreDeck(own, discovery).map((x) => x.appid)).toEqual([1, 10, 2, 11, 3])
    // Голова каталога сильнее — он первым
    const strong = [c(10, 'new', 0.95), ...discovery.slice(1)]
    expect(exploreDeck(own, strong).map((x) => x.appid)).toEqual([10, 1, 11, 2, 3])
  })

  test('кончилась одна сторона — добирает другая; длина не больше колоды', () => {
    const own = Array.from({ length: 30 }, (_, i) => c(i + 1, 'untouched', 1 - i / 100))
    expect(exploreDeck(own, []).map((x) => x.appid)).toEqual(own.slice(0, EXPLORE_DECK).map((x) => x.appid))
    expect(exploreDeck([], [c(10, 'new', 0.5)])).toHaveLength(1)
    expect(exploreDeck([], [])).toEqual([])
  })
})

describe('exploredAppids', () => {
  const NOW = 1_780_000_000

  test('приглянувшееся не возвращается никогда, «Мимо» — неделю', () => {
    const rows = [
      { appid: 1, at: NOW - 30 * 86_400, liked: true },
      { appid: 2, at: NOW - 86_400, liked: false },
      { appid: 3, at: NOW - EXPLORE_PASS_SEC - 1, liked: false },
    ]
    expect(exploredAppids(rows, NOW)).toEqual([1, 2])
  })
})
