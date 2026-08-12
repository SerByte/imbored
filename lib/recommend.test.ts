import { describe, expect, test } from 'vitest'
import type { FeedbackRow } from './db'
import {
  applyFeedbackToProfile,
  buildTagProfile,
  classifyLibraryGame,
  cosine,
  explainMatch,
  scoreCandidates,
} from './recommend'
import type { GameMeta, LibraryGame, Mood } from './types'

const NOW = 1_700_000_000
const DAY = 86_400

function game(partial: Partial<LibraryGame> & { appid: number }): LibraryGame {
  return { name: `game-${partial.appid}`, playtimeForever: 0, playtime2Weeks: 0, ...partial }
}

function meta(appid: number, tags: Record<string, number>, categories: number[] = [2]): GameMeta {
  return { appid, name: `game-${appid}`, tags, genres: [], categories }
}

describe('cosine', () => {
  test('одинаковые вектора дают 1', () => {
    expect(cosine({ a: 2, b: 3 }, { a: 2, b: 3 })).toBeCloseTo(1)
  })

  test('непересекающиеся вектора дают 0', () => {
    expect(cosine({ a: 1 }, { b: 1 })).toBe(0)
  })

  test('пустой вектор даёт 0', () => {
    expect(cosine({}, { a: 1 })).toBe(0)
  })
})

describe('buildTagProfile', () => {
  test('больше часов — больший вес тега, но лог-сглаженный', () => {
    const lib = [
      game({ appid: 1, playtimeForever: 600 }), // 10 часов Roguelike
      game({ appid: 2, playtimeForever: 60 }), // 1 час Story
    ]
    const metas = new Map([
      [1, meta(1, { Roguelike: 100 })],
      [2, meta(2, { Story: 100 })],
    ])
    const profile = buildTagProfile(lib, (id) => metas.get(id))
    expect(profile['Roguelike']).toBeGreaterThan(profile['Story'])
    // 10x часов НЕ дают 10x веса — лог-сглаживание
    expect(profile['Roguelike']).toBeLessThan(profile['Story'] * 5)
  })

  test('недавняя активность (2 недели) усиливает вес', () => {
    const metas = new Map([
      [1, meta(1, { Shooter: 100 })],
      [2, meta(2, { Farming: 100 })],
    ])
    const profile = buildTagProfile(
      [
        game({ appid: 1, playtimeForever: 600, playtime2Weeks: 120 }),
        game({ appid: 2, playtimeForever: 600, playtime2Weeks: 0 }),
      ],
      (id) => metas.get(id),
    )
    expect(profile['Shooter']).toBeGreaterThan(profile['Farming'])
  })

  test('игры без метаданных просто пропускаются', () => {
    const profile = buildTagProfile([game({ appid: 1, playtimeForever: 600 })], () => undefined)
    expect(profile).toEqual({})
  })
})

describe('classifyLibraryGame', () => {
  test('меньше 2 часов — unplayed (бэклог)', () => {
    expect(classifyLibraryGame(game({ appid: 1, playtimeForever: 30 }), NOW)).toBe('unplayed')
  })

  test('играет прямо сейчас (2 недели) — active', () => {
    expect(
      classifyLibraryGame(game({ appid: 1, playtimeForever: 600, playtime2Weeks: 60 }), NOW),
    ).toBe('active')
  })

  test('наиграно много, но заброшено больше полугода — comeback', () => {
    expect(
      classifyLibraryGame(
        game({ appid: 1, playtimeForever: 1200, lastPlayed: NOW - 200 * DAY }),
        NOW,
      ),
    ).toBe('comeback')
  })

  test('без lastPlayed (Steam его не отдаёт для чужих) наигранная игра считается comeback', () => {
    expect(classifyLibraryGame(game({ appid: 1, playtimeForever: 1200 }), NOW)).toBe('comeback')
  })

  test('играл недавно (по lastPlayed), но не в последние 2 недели — played', () => {
    expect(
      classifyLibraryGame(
        game({ appid: 1, playtimeForever: 1200, lastPlayed: NOW - 30 * DAY }),
        NOW,
      ),
    ).toBe('played')
  })
})

describe('applyFeedbackToProfile', () => {
  const fb = (
    appid: number,
    action: FeedbackRow['action'],
    reason?: FeedbackRow['reason'],
  ): FeedbackRow => ({ steamid: 'u', appid, action, ...(reason ? { reason } : {}), createdAt: NOW })

  const metas = new Map([
    [1, meta(1, { Roguelike: 100, Difficult: 60 })],
    [2, meta(2, { Farming: 100 })],
  ])
  const metaOf = (id: number) => metas.get(id)

  test('«зашло» усиливает теги игры', () => {
    const out = applyFeedbackToProfile({ Roguelike: 1 }, [fb(1, 'liked')], metaOf)
    expect(out['Roguelike']).toBeGreaterThan(1)
  })

  test('скип с причиной «не тот жанр» ослабляет теги, но не уводит в минус', () => {
    const out = applyFeedbackToProfile({ Farming: 0.3 }, [fb(2, 'skipped', 'genre')], metaOf)
    expect(out['Farming']).toBeLessThan(0.3)
    expect(out['Farming']).toBeGreaterThanOrEqual(0)
  })

  test('скип без причины (не сейчас) вкус не трогает', () => {
    const before = { Roguelike: 1, Difficult: 0.5 }
    expect(applyFeedbackToProfile(before, [fb(1, 'skipped')], metaOf)).toEqual(before)
  })

  test('причина «слишком сложная» бьёт только по хардкорным тегам', () => {
    const out = applyFeedbackToProfile(
      { Roguelike: 1, Difficult: 1 },
      [fb(1, 'skipped', 'hard')],
      metaOf,
    )
    expect(out['Difficult']).toBeLessThan(1)
    expect(out['Roguelike']).toBe(1)
  })

  test('фидбек по игре без метаданных игнорируется', () => {
    const before = { Roguelike: 1 }
    expect(applyFeedbackToProfile(before, [fb(999, 'liked')], metaOf)).toEqual(before)
  })
})

describe('explainMatch', () => {
  test('полное совпадение — 100% и общий тег', () => {
    const m = meta(1, { Roguelike: 100 })
    const out = explainMatch({ Roguelike: 2 }, m, { time: 'medium', vibe: 'chill', social: 'solo' })
    expect(out.matchPercent).toBe(100)
    expect(out.sharedTags).toContain('Roguelike')
  })

  test('нет пересечения — 0% и пусто', () => {
    const m = meta(1, { Farming: 100 })
    const out = explainMatch({ Roguelike: 2 }, m, { time: 'medium', vibe: 'chill', social: 'solo' })
    expect(out.matchPercent).toBe(0)
    expect(out.sharedTags).toEqual([])
  })

  test('пустой профиль — matchPercent null', () => {
    const m = meta(1, { Farming: 100 })
    const out = explainMatch({}, m, { time: 'medium', vibe: 'chill', social: 'solo' })
    expect(out.matchPercent).toBeNull()
  })

  test('mood-теги: chill подсвечивает расслабляющие теги игры', () => {
    const m = meta(1, { Relaxing: 80, Action: 100 })
    const out = explainMatch({ Action: 1 }, m, { time: 'medium', vibe: 'chill', social: 'solo' })
    expect(out.moodTags).toContain('Relaxing')
    expect(out.moodTags).not.toContain('Action')
  })
})

describe('scoreCandidates', () => {
  const baseMood: Mood = { time: 'medium', vibe: 'chill', social: 'solo' }

  test('раскладывает источники: unplayed→backlog, comeback→comeback, каталог→new; active исключается', () => {
    const lib = [
      game({ appid: 1, playtimeForever: 10 }), // unplayed
      game({ appid: 2, playtimeForever: 900, lastPlayed: NOW - 300 * DAY }), // comeback
      game({ appid: 3, playtimeForever: 900, playtime2Weeks: 300 }), // active
    ]
    const metas = new Map([
      [1, meta(1, { Action: 100 })],
      [2, meta(2, { Action: 100 })],
      [3, meta(3, { Action: 100 })],
    ])
    const result = scoreCandidates({
      profile: { Action: 1 },
      library: lib,
      metaOf: (id) => metas.get(id),
      newPool: [meta(4, { Action: 100 })],
      mood: baseMood,
      nowSec: NOW,
    })
    const byId = new Map(result.map((c) => [c.appid, c]))
    expect(byId.get(1)?.source).toBe('backlog')
    expect(byId.get(2)?.source).toBe('comeback')
    expect(byId.get(4)?.source).toBe('new')
    expect(byId.has(3)).toBe(false)
  })

  test('«с друзьями» при пустых categories (реальный режим без appdetails) падает на теги', () => {
    const result = scoreCandidates({
      profile: { Action: 1 },
      library: [],
      metaOf: () => undefined,
      newPool: [
        meta(40, { Action: 100, 'Story Rich': 50 }, []), // одиночная, категорий нет
        meta(41, { Action: 100, 'Co-op': 50 }, []), // кооп по тегам, категорий нет
      ],
      mood: { ...baseMood, social: 'friends' },
      nowSec: NOW,
    })
    expect(result.map((c) => c.appid)).toEqual([41])
  })

  test('пустой тег-профиль ранжирует по популярности тегов, а не порядку вставки', () => {
    const result = scoreCandidates({
      profile: {},
      library: [],
      metaOf: () => undefined,
      newPool: [
        meta(50, { Indie: 10 }), // нишевая
        meta(51, { 'Open World': 6000, RPG: 5000 }), // популярная
      ],
      mood: baseMood,
      nowSec: NOW,
    })
    expect(result[0].appid).toBe(51)
    expect(result[0].score).toBeGreaterThan(result[1].score)
  })

  test('режим «с друзьями» выкидывает чисто одиночные игры', () => {
    const result = scoreCandidates({
      profile: { Action: 1 },
      library: [],
      metaOf: () => undefined,
      newPool: [
        meta(10, { Action: 100 }, [2]), // только Single-player
        meta(11, { Action: 100 }, [1, 9]), // Multi-player + Co-op
      ],
      mood: { ...baseMood, social: 'friends' },
      nowSec: NOW,
    })
    expect(result.map((c) => c.appid)).toEqual([11])
  })

  test('вайб chill поднимает расслабляющее выше соревновательного при равной базе', () => {
    const result = scoreCandidates({
      profile: { Action: 1 },
      library: [],
      metaOf: () => undefined,
      newPool: [
        meta(20, { Action: 100, Competitive: 50 }),
        meta(21, { Action: 100, Relaxing: 50 }),
      ],
      mood: { ...baseMood, vibe: 'chill' },
      nowSec: NOW,
    })
    expect(result[0].appid).toBe(21)
  })

  test('limit ограничивает выдачу, сортировка по score убыванию', () => {
    const pool = [
      meta(30, { Action: 100 }),
      meta(31, { Action: 60, Other: 100 }),
      meta(32, { Unrelated: 100 }),
    ]
    const result = scoreCandidates({
      profile: { Action: 1 },
      library: [],
      metaOf: () => undefined,
      newPool: pool,
      mood: baseMood,
      nowSec: NOW,
      limit: 2,
    })
    expect(result).toHaveLength(2)
    expect(result[0].score).toBeGreaterThanOrEqual(result[1].score)
    expect(result[0].appid).toBe(30)
  })
})
