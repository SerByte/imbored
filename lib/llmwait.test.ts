import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { claudePicks, claudePortraitText, claudeProsCons, LlmUnavailableError } from './llm'
import type { GameMeta, Mood, ScoredCandidate } from './types'

/**
 * Сколько человек ждёт модель, если Anthropic просит подождать.
 *
 * Здесь SDK настоящий, а подменён только fetch — в отличие от lib/llm.test.ts,
 * где клиент заменён целиком. Иначе проверять нечего: ожидание живёт внутри
 * SDK. В @anthropic-ai/sdk 0.116 повтор при 429 спит ровно столько, сколько
 * сказал заголовок retry-after, без потолка, и повторяет запрос. С прежними
 * настройками (30 с × 2 попытки) экран «Подбираю…» стоял бы минуту и больше,
 * а через восемь секунд могла приехать бесплатная эвристика.
 *
 * Сеть не трогается: каждый запрос SDK упирается в подменённый fetch.
 */

const MOOD: Mood = { time: 'medium', vibe: 'chill', social: 'solo' }
const CANDS: ScoredCandidate[] = [
  { appid: 1, name: 'Backlog Gem', source: 'backlog', score: 0.9 },
  { appid: 2, name: 'Old Flame', source: 'comeback', score: 0.8 },
]
const metaOf = (appid: number): GameMeta => ({
  appid,
  name: `Игра ${appid}`,
  tags: { Puzzle: 100 },
  genres: [],
  categories: [2],
})

/** Ответ квоты: ждите минуту. Именно такой SDK послушно проспал бы. */
function rateLimited(): Response {
  return new Response(
    JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }),
    { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } },
  )
}

describe('модель просит подождать минуту', () => {
  let key: string | undefined
  const fetchMock = vi.fn(async () => rateLimited())

  beforeEach(() => {
    key = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'test-key'
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = key
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('подборка не ждёт: сразу null, и /api/recommend отдаёт эвристику', async () => {
    const t0 = Date.now()
    await expect(
      claudePicks({ candidates: CANDS, metaOf, library: [], mood: MOOD }),
    ).resolves.toBeNull()
    expect(Date.now() - t0).toBeLessThan(2_000)
    // одна попытка, без повтора: повтор и есть та минута сна
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('портрет не ждёт: сразу null, и страница рисует шаблон', async () => {
    const t0 = Date.now()
    await expect(
      claudePortraitText({
        name: 'Игрок',
        archetypes: [{ label: 'исследователь', percent: 60 }],
        facts: { gamesCount: 10, totalHours: 50, unplayedCount: 3, topGame: null },
      }),
    ).resolves.toBeNull()
    expect(Date.now() - t0).toBeLessThan(2_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('крон на коротком остатке тоже не спит: квота — авария сервиса, сразу наверх', async () => {
    const t0 = Date.now()
    await expect(
      claudeProsCons('Игра', [{ text: 'хорошая', votedUp: true, playtimeAtReview: 600 }], 10_000),
    ).rejects.toBeInstanceOf(LlmUnavailableError)
    expect(Date.now() - t0).toBeLessThan(2_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
