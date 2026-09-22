import { describe, expect, test } from 'vitest'
import type { FeedbackRow } from './db'
import {
  ANCHOR_MIN_SIM,
  applyFeedbackToProfile,
  applyFocus,
  buildAnchorFinder,
  buildTagProfile,
  capSource,
  classifyLibraryGame,
  cooldownOf,
  cosine,
  dealMultiplier,
  deferredOf,
  explainMatch,
  familiarWeight,
  isReplayable,
  isUnplayed,
  isUntouched,
  libraryTileState,
  MAX_NEW_PICKS,
  mixHeroPool,
  normalizedTags,
  parseFocus,
  parseScope,
  PICK_COUNT,
  rankByTaste,
  scoreCandidates,
  scoreOfParts,
  sharedTasteTags,
  splitBySource,
  type Cooldown,
} from './recommend'
import { DEMO_METAS, demoLibrary } from './demo'
import { tagWeightFrom } from './tagweight'
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

  test('запуск усиливает слабее «зашло», но сильнее открытой карточки', () => {
    const after = (action: FeedbackRow['action']) =>
      applyFeedbackToProfile({ Roguelike: 1 }, [fb(1, action)], metaOf)['Roguelike']
    expect(after('liked')).toBeGreaterThan(after('launched'))
    expect(after('launched')).toBeGreaterThan(after('opened'))
    expect(after('opened')).toBeGreaterThan(1)
  })

  test('повторные «зашло» по одной игре — один сигнал, а не пять', () => {
    const once = applyFeedbackToProfile({ Roguelike: 1 }, [fb(1, 'liked')], metaOf)
    const repeated = applyFeedbackToProfile(
      { Roguelike: 1 },
      [
        fb(1, 'liked'),
        { ...fb(1, 'liked'), createdAt: NOW - 3 * DAY },
        { ...fb(1, 'liked'), createdAt: NOW - 10 * DAY },
      ],
      metaOf,
    )
    expect(repeated).toEqual(once)
  })

  test('разные причины одной игры — разные сигналы, они не схлопываются', () => {
    const both = applyFeedbackToProfile(
      { Roguelike: 1, Difficult: 1 },
      [fb(1, 'skipped', 'hard'), fb(1, 'skipped', 'genre')],
      metaOf,
    )
    const genreOnly = applyFeedbackToProfile(
      { Roguelike: 1, Difficult: 1 },
      [fb(1, 'skipped', 'genre')],
      metaOf,
    )
    expect(both['Difficult']).toBeLessThan(genreOnly['Difficult'])
  })

  test('шаг растёт с профилем: на тысяче часов «зашло» не тонет в шуме', () => {
    // Маленький профиль — шаг прежний, единица
    const small = applyFeedbackToProfile({ Roguelike: 1 }, [fb(1, 'liked')], metaOf)
    expect(small['Roguelike']).toBeCloseTo(2)
    // У большого шаг — десятая доля максимума профиля
    const big = applyFeedbackToProfile({ Roguelike: 100 }, [fb(1, 'liked')], metaOf)
    expect(big['Roguelike'] - 100).toBeCloseTo(10)
    // Штраф масштабируется так же
    const penalized = applyFeedbackToProfile(
      { Roguelike: 100, Farming: 50 },
      [fb(2, 'skipped', 'genre')],
      metaOf,
    )
    expect(50 - penalized['Farming']).toBeCloseTo(8)
  })

  test('«Крутить ещё» (spin) вкус не трогает — это бросок кубика, а не оценка', () => {
    const before = { Roguelike: 1, Difficult: 0.5, Farming: 0.2 }
    expect(
      applyFeedbackToProfile(before, [fb(1, 'skipped', 'spin'), fb(2, 'skipped', 'spin')], metaOf),
    ).toEqual(before)
  })

  test('«надоела» вкус не трогает: надоела игра, а не жанр — это пауза', () => {
    const before = { Roguelike: 1, Difficult: 0.5, Farming: 0.2 }
    expect(
      applyFeedbackToProfile(before, [fb(1, 'skipped', 'tired'), fb(2, 'skipped', 'tired')], metaOf),
    ).toEqual(before)
  })
})

describe('sharedTasteTags и вес редкости', () => {
  // Singleplayer у половины каталога, Automation — у сотни игр
  const stats = new Map<string, number>([
    ['Singleplayer', 3025],
    ['Indie', 2800],
    ['Action', 2335],
    ['Automation', 100],
  ])
  // Профиль как у всех: частотный костяк весит больше всего
  const profile = { Indie: 20, Action: 15, Automation: 2 }
  const factory = meta(1, { Indie: 100, Action: 90, Automation: 60 })

  test('без карты тегов порядок прежний: по сырому вкладу', () => {
    expect(sharedTasteTags(profile, factory)).toEqual(['Indie', 'Action', 'Automation'])
    expect(sharedTasteTags(profile, factory, null)).toEqual(['Indie', 'Action', 'Automation'])
  })

  test('с картой характерный тег выходит вперёд частотных', () => {
    expect(sharedTasteTags(profile, factory, tagWeightFrom(stats))[0]).toBe('Automation')
  })

  test('тег, которого нет во вкусе, не появляется и с весом', () => {
    const tags = sharedTasteTags({ Indie: 5 }, factory, tagWeightFrom(stats))
    expect(tags).toEqual(['Indie'])
  })

  test('explainMatch передаёт вес в список общих тегов', () => {
    const mood: Mood = { time: 'medium', vibe: 'chill', social: 'solo' }
    expect(explainMatch(profile, factory, mood).sharedTags[0]).toBe('Indie')
    expect(explainMatch(profile, factory, mood, tagWeightFrom(stats)).sharedTags[0]).toBe('Automation')
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

  /**
   * Ось времени. До этих тестов ответ «сколько у меня времени» не двигал
   * выдачу вообще: корзина medium была пуста, а штрафа за неподходящую длину
   * не существовало — только буст за совпадение.
   *
   * Все три проверки построены на одном приёме: две игры с одинаковым
   * профильным тегом, но разной длиной, и меняется ТОЛЬКО ответ про время.
   */
  describe('ответ про время двигает выдачу', () => {
    // Roguelike — короткая, Colony Sim — длинная. Оба тега вне вайб-корзин,
    // поэтому вайб в эксперимент не вмешивается.
    const shortGame = meta(101, { Action: 100, Roguelike: 90 })
    const longGame = meta(102, { Action: 100, 'Colony Sim': 90 })
    const metas = new Map([
      [101, shortGame],
      [102, longGame],
    ])

    const rank = (time: Mood['time']) =>
      scoreCandidates({
        profile: { Action: 1 },
        library: [game({ appid: 101, playtimeForever: 10 }), game({ appid: 102, playtimeForever: 10 })],
        metaOf: (id) => metas.get(id),
        newPool: [],
        mood: { ...baseMood, time },
        nowSec: NOW,
      }).map((c) => c.appid)

    test('«меньше часа» поднимает короткую игру', () => {
      expect(rank('short')[0]).toBe(101)
    })

    test('«весь вечер» поднимает длинную', () => {
      expect(rank('long')[0]).toBe(102)
    })

    test('«пара часов» больше не пустая корзина: ответ меняет порядок', () => {
      // главное утверждение — что три ответа дают РАЗНЫЕ выдачи, а не одну
      expect(rank('short')).not.toEqual(rank('long'))
    })

    /**
     * Бьёт именно в матрицу, а не в наполненность корзин: раньше был только
     * буст за совпадение, поэтому длинная игра при ответе «меньше часа»
     * оказывалась вровень с игрой, про длину которой ничего не известно.
     * Стосчасовую RPG за сорок минут не начать — она должна проигрывать.
     */
    test('слишком длинная игра проигрывает безымянной при ответе «меньше часа»', () => {
      // Структура тегов у обеих ОДИНАКОВА (профильный + один посторонний с тем
      // же весом), поэтому косинус у них равный и разницу может дать только
      // ось времени. Без этого тест проходил бы просто из-за лишнего тега.
      const withLong = new Map([[105, meta(105, { Action: 100, 'Colony Sim': 90 })]])
      const noLength = new Map([[105, meta(105, { Action: 100, Colorful: 90 })]])
      const scoreWith = (m: Map<number, GameMeta>) =>
        scoreCandidates({
          profile: { Action: 1 },
          library: [game({ appid: 105, playtimeForever: 10 })],
          metaOf: (id) => m.get(id),
          newPool: [],
          mood: { ...baseMood, time: 'short' },
          nowSec: NOW,
        })[0].score

      expect(scoreWith(withLong)).toBeLessThan(scoreWith(noLength))
    })

    test('игра без единого тега длины не наказывается ни при каком ответе', () => {
      const plain = new Map([[103, meta(103, { Action: 100 })]])
      const scoreAt = (time: Mood['time']) =>
        scoreCandidates({
          profile: { Action: 1 },
          library: [game({ appid: 103, playtimeForever: 10 })],
          metaOf: (id) => plain.get(id),
          newPool: [],
          mood: { ...baseMood, time },
          nowSec: NOW,
        })[0].score

      expect(scoreAt('short')).toBeCloseTo(scoreAt('long'), 10)
    })

    test('игра сразу в двух корзинах берёт лучшую для себя оценку', () => {
      // Roguelike (short) + Open World (long): при ответе «весь вечер» она
      // должна получить буст за длину, а не штраф за краткость
      const both = new Map([[104, meta(104, { Action: 100, Roguelike: 90, 'Open World': 90 })]])
      const onlyShort = new Map([[104, meta(104, { Action: 100, Roguelike: 90 })]])
      const scoreWith = (m: Map<number, GameMeta>) =>
        scoreCandidates({
          profile: { Action: 1 },
          library: [game({ appid: 104, playtimeForever: 10 })],
          metaOf: (id) => m.get(id),
          newPool: [],
          mood: { ...baseMood, time: 'long' },
          nowSec: NOW,
        })[0].score

      expect(scoreWith(both)).toBeGreaterThan(scoreWith(onlyShort))
    })
  })

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

  describe('мусор библиотеки не становится «ни разу не запускал»', () => {
    const run = (lib: LibraryGame[], metas: Map<number, GameMeta>) =>
      scoreCandidates({
        profile: { Action: 1 },
        library: lib,
        metaOf: (id) => metas.get(id),
        newPool: [],
        mood: baseMood,
        nowSec: NOW,
      })

    test('саундтрек и демо с нулём минут выпадают, обычная игра остаётся запечатанной', () => {
      const lib = [
        game({ appid: 1, name: 'Foo — Original Soundtrack' }),
        game({ appid: 2, name: 'Bar Demo' }),
        game({ appid: 3, name: 'Baz' }),
      ]
      const metas = new Map(lib.map((g) => [g.appid, { ...meta(g.appid, { Action: 100 }), name: g.name }]))
      const result = run(lib, metas)
      expect(result.map((c) => c.appid)).toEqual([3])
      expect(result[0].source).toBe('untouched')
    })

    test('прогретая запись без тегов и категорий — мусор', () => {
      const metas = new Map([[4, meta(4, {}, [])]])
      expect(run([game({ appid: 4 })], metas)).toEqual([])
    })

    test('вердикт курации сильнее имени: мёртвая выпадает, живая «Demo» остаётся', () => {
      const lib = [game({ appid: 5, name: 'Normal Game' }), game({ appid: 6, name: 'Real Game Demo' })]
      const metas = new Map<number, GameMeta>([
        [5, { ...meta(5, { Action: 100 }), signalsAt: NOW, alive: false }],
        [6, { ...meta(6, { Action: 100 }), signalsAt: NOW, alive: true }],
      ])
      expect(run(lib, metas).map((c) => c.appid)).toEqual([6])
    })
  })

  describe('exclude — баны до отсечки limit', () => {
    // Пять своих с убывающим вкусом: у 1 профильный тег чистый, дальше всё
    // больше постороннего, поэтому порядок 1 > 2 > 3 > 4 > 5 без ничьих
    const lib = [1, 2, 3, 4, 5].map((appid) => game({ appid, playtimeForever: 10 }))
    const metas = new Map(
      lib.map((g) => [g.appid, meta(g.appid, { Action: 100, Other: (g.appid - 1) * 30 })]),
    )
    const run = (exclude?: ReadonlySet<number>, newPool: GameMeta[] = []) =>
      scoreCandidates({
        profile: { Action: 1 },
        library: lib,
        metaOf: (id) => metas.get(id),
        newPool,
        mood: baseMood,
        nowSec: NOW,
        limit: 3,
        ...(exclude ? { exclude } : {}),
      })

    test('бан двух лучших не укорачивает выдачу: их места достаются следующим', () => {
      expect(run().map((c) => c.appid)).toEqual([1, 2, 3])
      expect(run(new Set([1, 2])).map((c) => c.appid)).toEqual([3, 4, 5])
    })

    test('бан убирает и игру из каталога', () => {
      const pool = [meta(100, { Action: 100 }), meta(101, { Action: 100 })]
      const ids = run(new Set([100]), pool).map((c) => c.appid)
      expect(ids).not.toContain(100)
      expect(ids).toContain(101)
    })

    test('без exclude выдача та же, что с пустым множеством', () => {
      expect(run(new Set())).toEqual(run())
    })
  })

  /**
   * Вкус с весом редкости. Профиль собран так, как выглядит настоящий: частотный
   * костяк (Singleplayer, Indie) весит больше всего просто потому, что он есть
   * в каждой второй игре. Сырой косинус поэтому отдаёт первое место игре, у
   * которой нет ничего, кроме костяка.
   */
  describe('вес редкости во вкусе', () => {
    const stats = new Map<string, number>([
      ['Indie', 4000],
      ['Singleplayer', 3025],
      ['Action', 2335],
      ['Automation', 100],
    ])
    const profile = { Singleplayer: 10, Indie: 8, Automation: 2 }
    const lib = [game({ appid: 1, playtimeForever: 10 }), game({ appid: 2, playtimeForever: 10 })]
    const metas = new Map([
      [1, meta(1, { Automation: 100 })],
      [2, meta(2, { Singleplayer: 100 })],
    ])
    const run = (tagWeight?: ReturnType<typeof tagWeightFrom>) =>
      scoreCandidates({
        profile,
        library: lib,
        metaOf: (id) => metas.get(id),
        newPool: [meta(3, { Automation: 80, Action: 40 })],
        mood: baseMood,
        nowSec: NOW,
        ...(tagWeight !== undefined ? { tagWeight } : {}),
      })

    test('совпадение по Automation обходит совпадение по Singleplayer с картой и проигрывает без неё', () => {
      const order = (list: ScoredCandidate[]) =>
        list.map((c) => c.appid).filter((id) => id === 1 || id === 2)
      expect(order(run())).toEqual([2, 1])
      expect(order(run(tagWeightFrom(stats)))).toEqual([1, 2])
    })

    test('tagWeight: null — скоры ровно прежние, до бита', () => {
      const plain = run()
      expect(run(null)).toEqual(plain)
      for (const c of plain) {
        const m = c.appid === 3 ? meta(3, { Automation: 80, Action: 40 }) : metas.get(c.appid)!
        expect(c.parts!.taste).toBe(cosine(profile, normalizedTags(m)))
      }
    })

    test('процент совпадения на карточке считается тем же весом', () => {
      const mood: Mood = { time: 'medium', vibe: 'chill', social: 'solo' }
      const common = metas.get(2)!
      const raw = explainMatch(profile, common, mood).matchPercent!
      const weighted = explainMatch(profile, common, mood, tagWeightFrom(stats)).matchPercent!
      expect(weighted).toBeLessThan(raw)
      expect(explainMatch(profile, common, mood, null).matchPercent).toBe(raw)
    })
  })

  test('score — ровно произведение частей', () => {
    const onSale: GameMeta = {
      ...meta(200, { Action: 100, Relaxing: 40, Roguelike: 30 }),
      priceFinal: 500,
      priceInitial: 1000,
      discountPercent: 50,
      priceAt: NOW,
    }
    const result = scoreCandidates({
      profile: { Action: 1, Puzzle: 0.5 },
      library: [
        game({ appid: 1, playtimeForever: 0 }),
        game({ appid: 2, playtimeForever: 900, lastPlayed: NOW - 300 * DAY }),
      ],
      metaOf: (id) => (id === 1 ? meta(1, { Action: 100, Competitive: 20 }) : meta(2, { Puzzle: 100 })),
      newPool: [onSale],
      mood: baseMood,
      nowSec: NOW,
    })
    expect(result).toHaveLength(3)
    for (const c of result) {
      const p = c.parts!
      expect(c.score).toBe(p.taste * p.mood * p.source * p.deal * p.lean * p.cooldown)
      expect(scoreOfParts(p)).toBe(c.score)
    }
    const byId = new Map(result.map((c) => [c.appid, c.parts!]))
    expect(byId.get(1)?.source).toBe(1.25)
    expect(byId.get(200)?.deal).toBeGreaterThan(1)
    expect(byId.get(2)?.deal).toBe(1)
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

describe('buildAnchorFinder', () => {
  const HOUR = 60
  // Медиана сыгранного: 90, 150, 6000, 18000 минут → (150 + 6000) / 2 = 3075
  const lib = [
    game({ appid: 1, name: 'Factorio', playtimeForever: 300 * HOUR }),
    game({ appid: 2, name: 'Stardew Valley', playtimeForever: 100 * HOUR }),
    game({ appid: 3, name: 'Short Fling', playtimeForever: 90 }),
    game({ appid: 4, name: 'Tiny Racer', playtimeForever: 150 }),
    game({ appid: 5, name: 'Sealed', playtimeForever: 0 }),
  ]
  const metas = new Map<number, GameMeta>([
    [1, meta(1, { Automation: 100, Building: 60 })],
    [2, meta(2, { 'Farming Sim': 100, Relaxing: 60 })],
    [3, meta(3, { Horror: 100 })],
    [4, meta(4, { Racing: 100 })],
    [5, meta(5, { Puzzle: 100 })],
  ])
  const metaOf = (id: number) => metas.get(id)
  const cand = (appid: number, name: string, tags: Record<string, number>): GameMeta => ({
    ...meta(appid, tags),
    name,
  })

  test('находит свою игру с часами, на которую кандидат похож сильнее всего', () => {
    const find = buildAnchorFinder(lib, metaOf, null)
    expect(find(cand(100, 'Shapez', { Automation: 100, Puzzle: 30 }))).toEqual({
      appid: 1,
      name: 'Factorio',
      hours: 300,
    })
    expect(find(cand(101, 'Farm Life', { 'Farming Sim': 100, Relaxing: 80 }))?.name).toBe(
      'Stardew Valley',
    )
  })

  test('ниже порога сходства — null, а не натяжка', () => {
    // С Factorio совпадает один тег из четырёх: косинус ≈ 0.43
    const loose = cand(102, 'Loose', { Automation: 100, Horror: 100, Puzzle: 100, Sports: 100 })
    const find = buildAnchorFinder(lib, metaOf, null)
    expect(cosine(normalizedTags(metas.get(1)!), normalizedTags(loose))).toBeLessThan(ANCHOR_MIN_SIM)
    expect(find(loose)).toBeNull()
    expect(find(cand(103, 'Nothing', { Sports: 100 }))).toBeNull()
  })

  test('игра ниже медианы библиотеки якорем не бывает, даже при полном совпадении', () => {
    // Tiny Racer — 150 минут: больше двух часов, но ниже медианы 3075
    const find = buildAnchorFinder(lib, metaOf, null)
    expect(find(cand(104, 'Kart', { Racing: 100 }))).toBeNull()
  })

  test('меньше двух часов не якорь, даже если это вся библиотека', () => {
    const small = [game({ appid: 3, playtimeForever: 90 }), game({ appid: 4, playtimeForever: 100 })]
    const find = buildAnchorFinder(small, metaOf, null)
    expect(find(cand(105, 'Scary', { Horror: 100 }))).toBeNull()
  })

  test('ни сама игра, ни её издание себе не якорь', () => {
    const find = buildAnchorFinder(lib, metaOf, null)
    // Заброшенная Factorio — кандидат «вернуться», а не «похожа на себя»
    expect(find({ ...metas.get(1)!, name: 'Factorio' })).toBeNull()
    expect(find(cand(106, 'Factorio Deluxe Edition', { Automation: 100, Building: 60 }))).toBeNull()
  })

  test('бан и мусор якорем не бывают', () => {
    const shapez = cand(107, 'Shapez', { Automation: 100 })
    expect(buildAnchorFinder(lib, metaOf, null)(shapez)?.name).toBe('Factorio')
    expect(buildAnchorFinder(lib, metaOf, null, new Set([1]))(shapez)).toBeNull()

    const withOst = [
      game({ appid: 9, name: 'Factorio — Original Soundtrack', playtimeForever: 900 * HOUR }),
      ...lib.filter((g) => g.appid !== 1),
    ]
    const ostMetas = new Map(metas)
    ostMetas.set(9, meta(9, { Automation: 100 }))
    expect(buildAnchorFinder(withOst, (id) => ostMetas.get(id), null)(shapez)).toBeNull()
  })

  test('с весом редкости якорь выбирается по характерному тегу, а не по костяку', () => {
    const stats = new Map<string, number>([
      ['Indie', 4000],
      ['Action', 2335],
      ['Farming Sim', 150],
      ['Automation', 100],
    ])
    const both = [
      // Часы равные: оба выше медианы, спорит только сходство
      game({ appid: 20, name: 'Brawler', playtimeForever: 300 * HOUR }),
      game({ appid: 21, name: 'Factorio', playtimeForever: 300 * HOUR }),
    ]
    const bothMetas = new Map([
      [20, meta(20, { Indie: 100, Action: 100 })],
      [21, meta(21, { Automation: 100, Indie: 50 })],
    ])
    const factoryish = cand(108, 'Factory Brawl', { Indie: 100, Action: 80, Automation: 60 })
    const find = (w: ReturnType<typeof tagWeightFrom>) =>
      buildAnchorFinder(both, (id) => bothMetas.get(id), w)(factoryish)?.name
    expect(find(null)).toBe('Brawler')
    expect(find(tagWeightFrom(stats))).toBe('Factorio')
  })

  test('пустая библиотека — null без падений', () => {
    expect(buildAnchorFinder([], () => undefined, null)(cand(1, 'X', { A: 1 }))).toBeNull()
  })
})

describe('cooldownOf', () => {
  const HOUR = 3600
  const skip = (appid: number, ago: number, reason?: FeedbackRow['reason']): FeedbackRow => ({
    steamid: 'u',
    appid,
    action: 'skipped',
    ...(reason ? { reason } : {}),
    createdAt: NOW - ago,
  })
  const at = (appid: number, action: FeedbackRow['action'], ago: number): FeedbackRow => ({
    steamid: 'u',
    appid,
    action,
    createdAt: NOW - ago,
  })

  test('«не сейчас»: трое суток скрыта, потом до двух недель чуть выше обычного', () => {
    expect(cooldownOf([skip(1, 71 * HOUR, 'notnow')], NOW).get(1)).toEqual({
      mult: 0,
      kind: 'notnow',
      at: NOW - 71 * HOUR,
    })
    expect(cooldownOf([skip(1, 73 * HOUR, 'notnow')], NOW).get(1)?.mult).toBe(1.1)
    expect(cooldownOf([skip(1, 13 * DAY, 'notnow')], NOW).get(1)?.mult).toBe(1.1)
    expect(cooldownOf([skip(1, 15 * DAY, 'notnow')], NOW).has(1)).toBe(false)
  })

  test('скип без причины, «не тот жанр» и «сложная» прячут на сутки', () => {
    for (const reason of [undefined, 'genre', 'hard'] as const) {
      expect(cooldownOf([skip(1, 23 * HOUR, reason)], NOW).get(1), reason).toMatchObject({
        mult: 0,
        kind: 'skip',
      })
      expect(cooldownOf([skip(1, 25 * HOUR, reason)], NOW).has(1), reason).toBe(false)
    }
  })

  test('«надоела»: месяц с линейным возвратом от нуля', () => {
    expect(cooldownOf([skip(1, 0, 'tired')], NOW).get(1)?.mult).toBe(0)
    expect(cooldownOf([skip(1, 15 * DAY, 'tired')], NOW).get(1)?.mult).toBeCloseTo(0.5)
    expect(cooldownOf([skip(1, 27 * DAY, 'tired')], NOW).get(1)?.mult).toBeCloseTo(0.9)
    expect(cooldownOf([skip(1, 31 * DAY, 'tired')], NOW).has(1)).toBe(false)
  })

  test('«Крутить ещё» паузы не даёт и не перебивает настоящий скип', () => {
    expect(cooldownOf([skip(1, 0, 'spin')], NOW).size).toBe(0)
    const out = cooldownOf([skip(1, HOUR, 'spin'), skip(1, 2 * HOUR, 'notnow')], NOW)
    expect(out.get(1)?.kind).toBe('notnow')
  })

  test('«зашло», запуск или открытие после скипа снимают паузу, до скипа — нет', () => {
    for (const action of ['liked', 'launched', 'opened'] as const) {
      const after = cooldownOf([at(1, action, HOUR), skip(1, 2 * HOUR, 'notnow')], NOW)
      expect(after.has(1), action).toBe(false)
      const before = cooldownOf([skip(1, HOUR, 'notnow'), at(1, action, 2 * HOUR)], NOW)
      expect(before.has(1), action).toBe(true)
    }
  })

  test('решает самый свежий скип: сказанное позже заменяет сказанное раньше', () => {
    // «надоела» три недели назад не держит паузу поверх сегодняшнего «не сейчас»
    const out = cooldownOf([skip(1, 20 * DAY, 'tired'), skip(1, HOUR, 'notnow')], NOW)
    expect(out.get(1)?.kind).toBe('notnow')
  })

  test('only оставляет только названные паузы — «Игре дня» нужна одна «надоела»', () => {
    const feedback = [skip(1, HOUR, 'notnow'), skip(2, HOUR), skip(3, DAY, 'tired')]
    expect([...cooldownOf(feedback, NOW).keys()].sort()).toEqual([1, 2, 3])
    expect([...cooldownOf(feedback, NOW, ['tired']).keys()]).toEqual([3])
  })

  test('бан — не пауза: его отсекает exclude, а не cooldownOf', () => {
    expect(cooldownOf([at(1, 'banned', HOUR)], NOW).size).toBe(0)
  })

  test('пометка «Откладывал» — только у «не сейчас», в целых днях', () => {
    const notnow = { mult: 1.1, kind: 'notnow' as const, at: NOW - 4 * DAY - HOUR }
    expect(deferredOf(notnow, NOW)).toEqual({ daysAgo: 4 })
    expect(deferredOf({ mult: 0, kind: 'notnow', at: NOW - HOUR }, NOW)).toEqual({ daysAgo: 0 })
    expect(deferredOf({ mult: 0.5, kind: 'tired', at: NOW - 15 * DAY }, NOW)).toBeNull()
    expect(deferredOf(undefined, NOW)).toBeNull()
  })
})

describe('scoreCandidates и паузы', () => {
  const baseMood: Mood = { time: 'medium', vibe: 'chill', social: 'solo' }
  type Pauses = Map<number, Cooldown>
  // Шесть своих с убывающим вкусом, без ничьих: 1 > 2 > … > 6
  const lib = [1, 2, 3, 4, 5, 6].map((appid) => game({ appid, playtimeForever: 10 }))
  const metas = new Map(
    lib.map((g) => [g.appid, meta(g.appid, { Action: 100, Other: (g.appid - 1) * 30 })]),
  )
  const run = (cooldown?: Pauses) =>
    scoreCandidates({
      profile: { Action: 1 },
      library: lib,
      metaOf: (id) => metas.get(id),
      newPool: [],
      mood: baseMood,
      nowSec: NOW,
      ...(cooldown ? { cooldown } : {}),
    })
  const hideAll = (ids: number[]): Pauses =>
    new Map(ids.map((id) => [id, { mult: 0, kind: 'notnow', at: NOW - 3600 }]))

  test('без карты пауз — ровно прежние скоры', () => {
    expect(run(new Map())).toEqual(run())
    expect(run().every((c) => c.parts!.cooldown === 1)).toBe(true)
  })

  test('множитель паузы входит в скор частью cooldown', () => {
    const plain = new Map(run().map((c) => [c.appid, c.score]))
    const two = run(new Map([[2, { mult: 1.1, kind: 'notnow', at: NOW - 4 * DAY }]])).find(
      (c) => c.appid === 2,
    )!
    expect(two.parts!.cooldown).toBe(1.1)
    expect(two.score).toBeCloseTo(plain.get(2)! * 1.1, 12)
    expect(scoreOfParts(two.parts!)).toBe(two.score)
  })

  test('скрытая уходит, пока своих хватает на выдачу', () => {
    // Шесть своих, одна скрыта — остаётся пять, это ровно PICK_COUNT
    const ids = run(hideAll([1])).map((c) => c.appid)
    expect(ids).not.toContain(1)
    expect(ids).toHaveLength(PICK_COUNT)
  })

  test('когда своих не хватает, лучшие скрытые возвращаются вполсилы', () => {
    const out = run(hideAll(lib.map((g) => g.appid)))
    expect(out).toHaveLength(PICK_COUNT)
    // Вернулись лучшие по вкусу, а не первые по порядку библиотеки
    expect(out.map((c) => c.appid)).toEqual([1, 2, 3, 4, 5])
    expect(out.every((c) => c.parts!.cooldown === 0.5)).toBe(true)
  })

  test('каталог из-под паузы не возвращается', () => {
    const out = scoreCandidates({
      profile: { Action: 1 },
      library: [],
      metaOf: () => undefined,
      newPool: [meta(100, { Action: 100 }), meta(101, { Action: 100 })],
      mood: baseMood,
      nowSec: NOW,
      cooldown: new Map([[100, { mult: 0, kind: 'skip', at: NOW }]]),
    })
    expect(out.map((c) => c.appid)).toEqual([101])
  })

  /**
   * Демо-библиотека на 22 игры — ровно тот размер, на котором несколько
   * «не сейчас» подряд съели бы выдачу, не будь пола.
   */
  describe('пол на демо-библиотеке', () => {
    const metasById = new Map(DEMO_METAS.map((m) => [m.appid, m]))
    const library = demoLibrary(NOW)
    const owned = new Set(library.map((g) => g.appid))
    const demoRun = (cooldown?: Pauses, exclude?: Set<number>) =>
      scoreCandidates({
        profile: buildTagProfile(library, (id) => metasById.get(id)),
        library,
        metaOf: (id) => metasById.get(id),
        newPool: DEMO_METAS.filter((m) => !owned.has(m.appid)),
        mood: baseMood,
        nowSec: NOW,
        limit: 30,
        ...(cooldown ? { cooldown } : {}),
        ...(exclude ? { exclude } : {}),
      })
    const own = (list: ScoredCandidate[]) => list.filter((c) => c.source !== 'new')
    const plainOwn = own(demoRun())
    const allOwn = plainOwn.map((c) => c.appid)

    test('«не сейчас» на всё своё не оставляет пустую выдачу', () => {
      expect(plainOwn.length).toBeGreaterThan(PICK_COUNT)
      const back = own(demoRun(hideAll(allOwn)))
      expect(back).toHaveLength(PICK_COUNT)
      expect(back.map((c) => c.appid)).toEqual(allOwn.slice(0, PICK_COUNT))
      expect(back.every((c) => c.parts!.cooldown === 0.5)).toBe(true)
    })

    test('частичная пауза добирает ровно до пяти', () => {
      // Скрыто всё, кроме двух худших: вернуться должны три лучших из скрытых
      const back = own(demoRun(hideAll(allOwn.slice(0, -2))))
      expect(back).toHaveLength(PICK_COUNT)
      expect(back.filter((c) => c.parts!.cooldown === 0.5).map((c) => c.appid)).toEqual(
        allOwn.slice(0, PICK_COUNT - 2),
      )
    })

    test('бан не возвращается никогда, даже когда своих не хватает', () => {
      const banned = new Set(allOwn.slice(0, 2))
      const back = own(demoRun(hideAll(allOwn), banned))
      expect(back).toHaveLength(PICK_COUNT)
      expect(back.some((c) => banned.has(c.appid))).toBe(false)
    })
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
    // Наклон, а не сортировка по распродаже: moodMultiplier живёт в 0.55…1.40,
    // то есть настроение решает вшестеро сильнее. Если этот тест упадёт,
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

/**
 * Знакомое любимое. Порог входа у своей игры с десятками часов нулевой — но
 * только у той, где нечего «проходить»: пройденную сюжетную игру мы от
 * брошенной не отличим, и совет вернуться в неё был бы промахом.
 */
describe('знакомое любимое (familiar)', () => {
  const baseMood: Mood = { time: 'medium', vibe: 'chill', social: 'solo' }
  const played = (appid: number, daysAgo: number, minutes = 900): LibraryGame =>
    game({ appid, playtimeForever: minutes, lastPlayed: NOW - daysAgo * DAY })
  const sandbox = (appid: number) => meta(appid, { Sandbox: 100, Crafting: 60 })
  const weightOf = (g: LibraryGame, m: GameMeta) =>
    familiarWeight(g, m, classifyLibraryGame(g, NOW), NOW)

  describe('isReplayable', () => {
    test('песочница, рогалик и MOBA — без финала, сюжетная RPG — с финалом', () => {
      expect(isReplayable(meta(1, { Sandbox: 100 }))).toBe(true)
      expect(isReplayable(meta(2, { Roguelike: 100 }))).toBe(true)
      expect(isReplayable(meta(3, { MOBA: 100 }))).toBe(true)
      expect(isReplayable(meta(4, { RPG: 100, 'Story Rich': 80 }))).toBe(false)
    })

    test('соревновательный мультиплеер — да, кооп с титрами — нет', () => {
      expect(isReplayable(meta(5, { FPS: 100 }, [1, 36, 49]))).toBe(true)
      expect(isReplayable(meta(6, { Puzzle: 100 }, [2, 1, 9, 38]))).toBe(false)
    })

    test('без categories судит по тегам PvP — как isMultiplayerMeta', () => {
      expect(isReplayable(meta(7, { Shooter: 100, PvP: 50 }, []))).toBe(true)
      expect(isReplayable(meta(8, { Shooter: 100, 'Co-op': 50 }, []))).toBe(false)
    })
  })

  describe('familiarWeight', () => {
    test('жанровый шлюз: игра с финалом знакомой не становится', () => {
      expect(weightOf(played(1, 90), meta(1, { RPG: 100, 'Story Rich': 80 }))).toBeNull()
      expect(weightOf(played(1, 90), sandbox(1))).toBe(1)
    })

    test('пауза меньше месяца — не совет: в это он играл только что', () => {
      expect(weightOf(played(1, 20), sandbox(1))).toBeNull()
      expect(weightOf(played(1, 30), sandbox(1))).toBeCloseTo(0.5)
    })

    test('насыщение: вес растёт с паузой и доходит до единицы за два месяца', () => {
      const w45 = weightOf(played(1, 45), sandbox(1))!
      const w90 = weightOf(played(1, 90), sandbox(1))!
      expect(w45).toBeCloseTo(0.75)
      expect(w45).toBeLessThan(w90)
      expect(w90).toBe(1)
    })

    test('меньше десяти часов — ещё не знакомая', () => {
      expect(weightOf(played(1, 90, 500), sandbox(1))).toBeNull()
    })

    test('active и comeback — не familiar: у них свои разговоры', () => {
      const active = game({ appid: 1, playtimeForever: 900, playtime2Weeks: 60, lastPlayed: NOW - DAY })
      expect(weightOf(active, sandbox(1))).toBeNull()
      expect(weightOf(played(1, 300), sandbox(1))).toBeNull()
    })
  })

  describe('в scoreCandidates', () => {
    const lib = [
      played(1, 90), // знакомая песочница
      game({ appid: 2, playtimeForever: 900, playtime2Weeks: 60, lastPlayed: NOW - DAY }), // active
      game({ appid: 3, playtimeForever: 10 }), // бэклог
    ]
    const metas = new Map([
      [1, sandbox(1)],
      [2, sandbox(2)],
      [3, meta(3, { Sandbox: 100 })],
    ])
    const run = (allowFamiliar?: boolean) =>
      scoreCandidates({
        profile: { Sandbox: 1 },
        library: lib,
        metaOf: (id) => metas.get(id),
        newPool: [meta(100, { Sandbox: 100 })],
        mood: baseMood,
        nowSec: NOW,
        ...(allowFamiliar !== undefined ? { allowFamiliar } : {}),
      })

    test('по умолчанию выключено: «Игра дня» и главная не меняются', () => {
      expect(run().some((c) => c.source === 'familiar')).toBe(false)
      expect(run(false)).toEqual(run())
    })

    test('включённое — источник familiar с весом 0.9 и насыщением', () => {
      const fam = run(true).find((c) => c.appid === 1)!
      expect(fam.source).toBe('familiar')
      expect(fam.parts!.source).toBeCloseTo(0.9)
      expect(scoreOfParts(fam.parts!)).toBe(fam.score)
    })

    test('active в знакомое не попадает: во что играет сейчас, он и так помнит', () => {
      expect(run(true).some((c) => c.appid === 2)).toBe(false)
    })

    test('остальным кандидатам знакомое скоров не меняет', () => {
      const without = run().map((c) => [c.appid, c.score])
      const withIt = new Map(run(true).map((c) => [c.appid, c.score]))
      for (const [appid, score] of without) expect(withIt.get(appid)).toBe(score)
    })
  })

  describe('capSource', () => {
    const list = [
      { appid: 1, source: 'familiar' as const },
      { appid: 2, source: 'backlog' as const },
      { appid: 3, source: 'familiar' as const },
      { appid: 4, source: 'new' as const },
      { appid: 5, source: 'familiar' as const },
    ]

    test('оставляет первых max одного источника, остальных не трогает', () => {
      expect(capSource(list, 'familiar', 1).map((c) => c.appid)).toEqual([1, 2, 4])
      expect(capSource(list, 'familiar', 2).map((c) => c.appid)).toEqual([1, 2, 3, 4])
    })

    test('источника нет — список тот же', () => {
      expect(capSource(list, 'comeback', 1)).toEqual(list)
    })
  })
})
