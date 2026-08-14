import { describe, expect, test } from 'vitest'
import type { FeedbackRow } from './db'
import {
  applyFeedbackToProfile,
  applyFocus,
  buildTagProfile,
  classifyLibraryGame,
  cosine,
  dealMultiplier,
  explainMatch,
  isUnplayed,
  isUntouched,
  libraryTileState,
  MAX_NEW_PICKS,
  mixHeroPool,
  parseFocus,
  parseScope,
  rankByTaste,
  scoreCandidates,
  splitBySource,
} from './recommend'
import type { GameMeta, LibraryGame, Mood, ScoredCandidate } from './types'

const NOW = 1_700_000_000
const DAY = 86_400

function game(partial: Partial<LibraryGame> & { appid: number }): LibraryGame {
  return { name: `game-${partial.appid}`, playtimeForever: 0, playtime2Weeks: 0, ...partial }
}

function meta(appid: number, tags: Record<string, number>, categories: number[] = [2]): GameMeta {
  return { appid, name: `game-${appid}`, tags, genres: [], categories }
}

describe('splitBySource', () => {
  test('своё и «нет в библиотеке» не смешиваются', () => {
    const { own, discovery } = splitBySource([
      { appid: 1, source: 'backlog' as const },
      { appid: 2, source: 'new' as const },
      { appid: 3, source: 'comeback' as const },
      { appid: 4, source: 'new' as const },
    ])
    expect(own.map((c) => c.appid)).toEqual([1, 3])
    expect(discovery.map((c) => c.appid)).toEqual([2, 4])
  })

  test('пустой вход не роняет', () => {
    expect(splitBySource([])).toEqual({ own: [], discovery: [] })
  })

  test('порядок внутри блоков сохраняется — ранжирование уже сделано', () => {
    const { own } = splitBySource([
      { appid: 9, source: 'comeback' as const },
      { appid: 1, source: 'backlog' as const },
    ])
    expect(own.map((c) => c.appid)).toEqual([9, 1])
  })
})

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

  test('ни разу не запущенная обходит равную по вкусу заброшенную', () => {
    const lib = [
      game({ appid: 1, playtimeForever: 0 }),
      game({ appid: 2, playtimeForever: 900, lastPlayed: NOW - 300 * DAY }),
    ]
    const metas = new Map([
      [1, meta(1, { Action: 100 })],
      [2, meta(2, { Action: 100 })],
    ])
    const result = scoreCandidates({
      profile: { Action: 1 },
      library: lib,
      metaOf: (id) => metas.get(id),
      newPool: [],
      mood: baseMood,
      nowSec: NOW,
    })
    expect(result[0].appid).toBe(1)
    expect(result[0].source).toBe('untouched')
  })

  test('внутри бэклога нетронутая выше открытой и закрытой', () => {
    const lib = [
      game({ appid: 2, playtimeForever: 40 }),
      game({ appid: 1, playtimeForever: 0 }),
    ]
    const metas = new Map([
      [1, meta(1, { Action: 100 })],
      [2, meta(2, { Action: 100 })],
    ])
    const result = scoreCandidates({
      profile: { Action: 1 },
      library: lib,
      metaOf: (id) => metas.get(id),
      newPool: [],
      mood: baseMood,
      nowSec: NOW,
    })
    expect(result.map((c) => c.appid)).toEqual([1, 2])
    expect(result.map((c) => c.source)).toEqual(['untouched', 'backlog'])
  })

  test('это наклон, а не диктат: настроение перебивает приоритет незапущенной', () => {
    // Профиль у обеих совпадает одинаково, спорит только настроение: у
    // нетронутой противоположный вайб (множитель 0.75), у заброшенной —
    // совпадающий (1.25). 1.25 против 0.75 × 1.25 — выигрывает заброшенная.
    // Если этот тест упадёт, значит наклон вырос до фильтра.
    const lib = [
      game({ appid: 1, playtimeForever: 0 }),
      game({ appid: 2, playtimeForever: 900, lastPlayed: NOW - 300 * DAY }),
    ]
    const metas = new Map([
      [1, meta(1, { Action: 100, Competitive: 50 })],
      [2, meta(2, { Action: 100, Relaxing: 50 })],
    ])
    const result = scoreCandidates({
      profile: { Action: 1 },
      library: lib,
      metaOf: (id) => metas.get(id),
      newPool: [],
      mood: baseMood,
      nowSec: NOW,
    })
    expect(result[0].appid).toBe(2)
  })

  test('при равном настроении и равном вкусе решает наклон', () => {
    // Те же теги настроения у обеих — множители сокращаются, остаётся только
    // источник. Это и есть «в первую очередь советовать то, во что не играли».
    const lib = [
      game({ appid: 1, playtimeForever: 0 }),
      game({ appid: 2, playtimeForever: 900, lastPlayed: NOW - 300 * DAY }),
    ]
    const metas = new Map([
      [1, meta(1, { Action: 100, Relaxing: 50 })],
      [2, meta(2, { Action: 100, Relaxing: 50 })],
    ])
    const result = scoreCandidates({
      profile: { Action: 1 },
      library: lib,
      metaOf: (id) => metas.get(id),
      newPool: [],
      mood: baseMood,
      nowSec: NOW,
    })
    expect(result[0].appid).toBe(1)
    expect(result[0].score).toBeGreaterThan(result[1].score)
  })

  test('вкус всё ещё решает: нетронутая мимо вкуса не выносит точное попадание', () => {
    const lib = [
      game({ appid: 1, playtimeForever: 0 }),
      game({ appid: 2, playtimeForever: 900, lastPlayed: NOW - 300 * DAY }),
    ]
    const metas = new Map([
      [1, meta(1, { Farming: 100 })], // ничего общего с профилем
      [2, meta(2, { Action: 100 })],
    ])
    const result = scoreCandidates({
      profile: { Action: 1 },
      library: lib,
      metaOf: (id) => metas.get(id),
      newPool: [],
      mood: baseMood,
      nowSec: NOW,
    })
    expect(result[0].appid).toBe(2)
  })

  test('приоритет не ломает фильтр «с друзьями»', () => {
    const lib = [game({ appid: 1, playtimeForever: 0 })]
    const metas = new Map([[1, meta(1, { Action: 100 }, [2])]]) // только одиночная
    const result = scoreCandidates({
      profile: { Action: 1 },
      library: lib,
      metaOf: (id) => metas.get(id),
      newPool: [],
      mood: { ...baseMood, social: 'friends' },
      nowSec: NOW,
    })
    expect(result).toHaveLength(0)
  })

  test('бюджет: усиленный бэклог не съедает блок каталога', () => {
    const lib = Array.from({ length: 30 }, (_, i) => game({ appid: i + 1, playtimeForever: 0 }))
    const metas = new Map(lib.map((g) => [g.appid, meta(g.appid, { Action: 100 })]))
    const result = scoreCandidates({
      profile: { Action: 1 },
      library: lib,
      metaOf: (id) => metas.get(id),
      newPool: Array.from({ length: 10 }, (_, i) => meta(100 + i, { Action: 100 })),
      mood: baseMood,
      nowSec: NOW,
      limit: 25,
    })
    expect(result).toHaveLength(25)
    // heuristicPicks просит у каталога шесть — меньше означает пустой блок
    expect(result.filter((c) => c.source === 'new').length).toBeGreaterThanOrEqual(6)
  })

  test('бюджет не режет выдачу: длина = min(limit, всего кандидатов)', () => {
    const cases: Array<{ own: number; discovery: number; expected: number }> = [
      { own: 30, discovery: 10, expected: 25 },
      { own: 2, discovery: 100, expected: 25 },
      { own: 30, discovery: 0, expected: 25 },
      { own: 0, discovery: 5, expected: 5 },
      { own: 2, discovery: 3, expected: 5 },
    ]
    for (const c of cases) {
      const lib = Array.from({ length: c.own }, (_, i) => game({ appid: i + 1, playtimeForever: 0 }))
      const metas = new Map(lib.map((g) => [g.appid, meta(g.appid, { Action: 100 })]))
      const result = scoreCandidates({
        profile: { Action: 1 },
        library: lib,
        metaOf: (id) => metas.get(id),
        newPool: Array.from({ length: c.discovery }, (_, i) => meta(1000 + i, { Action: 100 })),
        mood: baseMood,
        nowSec: NOW,
        limit: 25,
      })
      expect(result).toHaveLength(c.expected)
    }
  })

  test('пустой каталог — весь лимит своим: нарезка «Игры дня» не изменилась', () => {
    const lib = Array.from({ length: 30 }, (_, i) => game({ appid: i + 1, playtimeForever: 0 }))
    const metas = new Map(lib.map((g) => [g.appid, meta(g.appid, { Action: 100 })]))
    const result = scoreCandidates({
      profile: { Action: 1 },
      library: lib,
      metaOf: (id) => metas.get(id),
      newPool: [],
      mood: baseMood,
      nowSec: NOW,
      limit: 25,
    })
    expect(result).toHaveLength(25)
    expect(result.every((c) => c.source === 'untouched')).toBe(true)
  })
})

describe('parseScope', () => {
  test('по умолчанию каталог участвует — это и есть ответ на «во что поиграть»', () => {
    expect(parseScope(undefined)).toBe('all')
    expect(parseScope('all')).toBe('all')
    expect(parseScope('мусор')).toBe('all')
  })

  test('«только моё» включается явным словом', () => {
    expect(parseScope('library')).toBe('library')
  })
})

describe('mixHeroPool', () => {
  const own = (n: number): ScoredCandidate[] =>
    Array.from({ length: n }, (_, i) => ({
      appid: i + 1,
      name: `свой-${i}`,
      source: 'backlog' as const,
      score: 1 - i * 0.01,
    }))
  const discovery = (n: number): ScoredCandidate[] =>
    Array.from({ length: n }, (_, i) => ({
      appid: 100 + i,
      name: `каталог-${i}`,
      source: 'new' as const,
      score: 0.9 - i * 0.01,
    }))

  test('покупок в пуле не больше потолка — ответ не превращается в витрину', () => {
    const mixed = mixHeroPool(own(20), discovery(10))
    expect(mixed.filter((c) => c.source === 'new')).toHaveLength(MAX_NEW_PICKS)
    expect(mixed).toHaveLength(20 + MAX_NEW_PICKS)
  })

  test('потолок поднимается, когда играть просто не во что', () => {
    // У человека с тремя играми пять карточек иначе не набрать, и «нечего
    // показать» — худший ответ, чем «вот что стоит взять»
    expect(mixHeroPool(own(1), discovery(10)).filter((c) => c.source === 'new')).toHaveLength(4)
    expect(mixHeroPool([], discovery(10)).filter((c) => c.source === 'new')).toHaveLength(5)
  })

  test('порядок общий по скору: каталог не приклеен в конец', () => {
    const mixed = mixHeroPool(
      [{ appid: 1, name: 'своя', source: 'backlog', score: 0.5 }] as ScoredCandidate[],
      [{ appid: 100, name: 'из каталога', source: 'new', score: 0.9 }] as ScoredCandidate[],
    )
    expect(mixed.map((c) => c.appid)).toEqual([100, 1])
  })

  test('пустой каталог ничего не меняет', () => {
    expect(mixHeroPool(own(3), [])).toHaveLength(3)
  })
})

describe('dealMultiplier', () => {
  const onSale = (percent: number) =>
    ({
      ...meta(1, { Action: 100 }),
      priceFinal: 500,
      priceInitial: 1000,
      discountPercent: percent,
      priceAt: NOW,
    }) as GameMeta

  test('скидка поднимает каталог, но слабее, чем настроение', () => {
    // Наклон, а не сортировка по распродаже: moodMultiplier живёт в 0.75…1.40,
    // то есть настроение решает вчетверо сильнее. Если этот тест упадёт,
    // значит скидка стала фильтром.
    expect(dealMultiplier(onSale(90), 'new', NOW)).toBeCloseTo(1.15)
    expect(dealMultiplier(onSale(45), 'new', NOW)).toBeCloseTo(1.075)
  })

  test('купленного не касается: за него уже заплачено', () => {
    expect(dealMultiplier(onSale(90), 'backlog', NOW)).toBe(1)
    expect(dealMultiplier(onSale(90), 'untouched', NOW)).toBe(1)
  })

  test('протухшая скидка не поднимает ничего', () => {
    const stale = { ...onSale(90), priceAt: NOW - 30 * DAY }
    expect(dealMultiplier(stale, 'new', NOW)).toBe(1)
  })

  test('без скидки множитель ровно единица', () => {
    expect(dealMultiplier(meta(1, { Action: 100 }), 'new', NOW)).toBe(1)
  })
})

describe('isUntouched', () => {
  test('ноль минут — ни разу не запускал', () => {
    expect(isUntouched(game({ appid: 1, playtimeForever: 0 }))).toBe(true)
  })

  test('одна минута — уже запускал, но это всё ещё бэклог', () => {
    const g = game({ appid: 1, playtimeForever: 1 })
    expect(isUntouched(g)).toBe(false)
    expect(isUnplayed(g)).toBe(true)
  })

  test('119 минут — не распакованной уже не назовёшь', () => {
    expect(isUntouched(game({ appid: 1, playtimeForever: 119 }))).toBe(false)
  })

  test('строгое подмножество isUnplayed — определение бэклога не расходится', () => {
    const cases = [
      game({ appid: 1, playtimeForever: 0 }),
      game({ appid: 2, playtimeForever: 0, playtime2Weeks: 40 }),
      game({ appid: 3, playtimeForever: 119 }),
      game({ appid: 4, playtimeForever: 5000 }),
    ]
    for (const g of cases) {
      if (isUntouched(g)) expect(isUnplayed(g)).toBe(true)
    }
  })

  test('аномалия Steam (ноль всего, но минуты за две недели) — не «незапущенная»', () => {
    const g = game({ appid: 1, playtimeForever: 0, playtime2Weeks: 40 })
    expect(isUntouched(g)).toBe(false)
    expect(libraryTileState(g, NOW)).toBe('active')
  })
})

describe('libraryTileState', () => {
  test('ноль минут отделяется от «открыл и закрыл»', () => {
    expect(libraryTileState(game({ appid: 1, playtimeForever: 0 }), NOW)).toBe('untouched')
    expect(libraryTileState(game({ appid: 2, playtimeForever: 30 }), NOW)).toBe('unplayed')
  })

  test('остальные состояния не трогаются', () => {
    const abandoned = game({ appid: 3, playtimeForever: 900, lastPlayed: NOW - 300 * DAY })
    expect(libraryTileState(abandoned, NOW)).toBe('comeback')
    const recent = game({ appid: 4, playtimeForever: 900, lastPlayed: NOW - 10 * DAY })
    expect(libraryTileState(recent, NOW)).toBe('played')
  })

  test('lastPlayed = 0 классифицируется так же, как отсутствие даты', () => {
    const withZero = game({ appid: 5, playtimeForever: 900, lastPlayed: 0 })
    const without = game({ appid: 6, playtimeForever: 900 })
    expect(libraryTileState(withZero, NOW)).toBe(libraryTileState(without, NOW))
  })
})

describe('rankByTaste', () => {
  const metas = new Map([
    [1, meta(1, { Action: 100 })],
    [2, meta(2, { Farming: 100 })],
  ])
  const metaOf = (id: number) => metas.get(id)

  test('ближе по вкусу — выше', () => {
    const out = rankByTaste(
      [game({ appid: 2 }), game({ appid: 1 })],
      metaOf,
      { Action: 1 },
    )
    expect(out.map((g) => g.appid)).toEqual([1, 2])
  })

  test('игры без метаданных уезжают в конец, а не исчезают', () => {
    const out = rankByTaste(
      [game({ appid: 99 }), game({ appid: 1 })],
      metaOf,
      { Action: 1 },
    )
    expect(out.map((g) => g.appid)).toEqual([1, 99])
  })

  test('равный вкус — исходный порядок: сортировка стабильна', () => {
    const same = new Map([
      [7, meta(7, { Action: 100 })],
      [8, meta(8, { Action: 100 })],
    ])
    const out = rankByTaste(
      [game({ appid: 8 }), game({ appid: 7 })],
      (id) => same.get(id),
      { Action: 1 },
    )
    expect(out.map((g) => g.appid)).toEqual([8, 7])
  })
})

describe('applyFocus', () => {
  const c = (appid: number, source: 'untouched' | 'backlog' | 'comeback' | 'new') => ({
    appid,
    source,
  })

  test('null — сквозной проход', () => {
    const list = [c(1, 'untouched'), c(2, 'comeback')]
    expect(applyFocus(list, null)).toEqual(list)
  })

  test('при достатке запечатанных оставляет только их, сохраняя порядок', () => {
    const list = [c(1, 'untouched'), c(2, 'comeback'), c(3, 'untouched'), c(4, 'untouched')]
    expect(applyFocus(list, 'untouched').map((x) => x.appid)).toEqual([1, 3, 4])
  })

  test('ниже порога добирает бэклогом, а не отдаёт пустой экран', () => {
    const list = [c(1, 'untouched'), c(2, 'comeback'), c(3, 'backlog')]
    expect(applyFocus(list, 'untouched').map((x) => x.appid)).toEqual([1, 3])
  })

  test('никогда не возвращает пусто на непустом входе', () => {
    const list = [c(1, 'comeback'), c(2, 'new')]
    expect(applyFocus(list, 'untouched')).toHaveLength(2)
  })

  test('пустой вход остаётся пустым', () => {
    expect(applyFocus([], 'untouched')).toEqual([])
  })
})

describe('parseFocus', () => {
  test('только known-значение проходит', () => {
    expect(parseFocus('untouched')).toBe('untouched')
  })

  test('мусор, массив и пустота дают null', () => {
    expect(parseFocus('lol')).toBeNull()
    expect(parseFocus(undefined)).toBeNull()
    expect(parseFocus(['untouched'])).toBeNull()
    expect(parseFocus(1)).toBeNull()
  })
})
