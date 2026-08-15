import { describe, expect, test } from 'vitest'
import { COMMON_SHOWN, compatibility, tasteCosine, verdict } from './compat'
import { buildTagProfile } from './recommend'
import type { GameMeta, LibraryGame } from './types'

function lib(appid: number, hours: number): LibraryGame {
  return { appid, name: `g${appid}`, playtimeForever: hours * 60, playtime2Weeks: 0 }
}

function meta(appid: number, tags: Record<string, number>): GameMeta {
  return { appid, name: `g${appid}`, tags, genres: [], categories: [1] }
}

const METAS = new Map<number, GameMeta>([
  [1, meta(1, { 'Co-op': 100, FPS: 80 })],
  [2, meta(2, { 'Story Rich': 100, RPG: 90 })],
  [3, meta(3, { MOBA: 100 })],
])
const metaOf = (id: number) => METAS.get(id)

/**
 * Карта тегов с реальными пропорциями каталога: Singleplayer больше чем у
 * половины игр, MOBA — у сотни. Пустая карта здесь не годится — с ней метрика
 * честно откатывается к сырому косинусу, и тесты перестают проверять то, что
 * написано в их названиях.
 */
const TAG_STATS = new Map<string, number>([
  ['Singleplayer', 3025],
  ['Action', 2335],
  ['Adventure', 2100],
  ['RPG', 1338],
  ['Story Rich', 1233],
  ['Co-op', 785],
  ['FPS', 500],
  ['MOBA', 100],
])

describe('compatibility', () => {
  test('одинаковые библиотеки — 100% и общие игры с часами обоих', () => {
    const a = [lib(1, 100), lib(2, 50)]
    const b = [lib(1, 80), lib(2, 50)]
    const out = compatibility(a, b, metaOf, TAG_STATS)
    expect(out.percent).toBe(100)
    expect(out.commonGames[0]).toEqual({ appid: 1, name: 'g1', hoursA: 100, hoursB: 80 })
    expect(out.commonGames).toHaveLength(2)
  })

  test('непересекающиеся вкусы — 0% и без общих игр', () => {
    const out = compatibility([lib(1, 100)], [lib(2, 100)], metaOf, TAG_STATS)
    expect(out.percent).toBe(0)
    expect(out.commonGames).toEqual([])
  })

  /**
   * Раньше здесь ожидался Co-op — просто потому, что в него наиграно больше.
   * Теперь общие теги взвешены редкостью, и наверх выходит FPS: он вдвое реже
   * в каталоге, то есть роднит двоих сильнее. Это и есть смысл правки —
   * «у вас общее: Singleplayer» было описанием каталога, а не наблюдением.
   */
  test('общие теги — сначала те, что реже встречаются в каталоге', () => {
    const a = [lib(1, 100), lib(2, 10)]
    const b = [lib(1, 100), lib(2, 200)]
    const out = compatibility(a, b, metaOf, TAG_STATS)
    expect(out.sharedTags[0]).toBe('FPS')
    expect(out.sharedTags).toContain('Co-op')
    expect(out.sharedTags).toContain('Story Rich')
  })

  test('общие игры сортируются по суммарным часам', () => {
    const a = [lib(1, 10), lib(3, 500)]
    const b = [lib(1, 10), lib(3, 400)]
    const out = compatibility(a, b, metaOf, TAG_STATS)
    expect(out.commonGames[0].appid).toBe(3)
  })

  test('пустые библиотеки не роняют', () => {
    const out = compatibility([], [], metaOf, TAG_STATS)
    expect(out.percent).toBe(0)
    expect(out.commonGames).toEqual([])
    expect(out.commonTotal).toBe(0)
    expect(out.commonHours).toBe(0)
    expect(out.sharedTags).toEqual([])
  })

  /**
   * Заголовок «Общие игры — N» считал длину уже обрезанного списка и у пары с
   * тремя сотнями общих игр честно писал «10». Починить это в вёрстке нельзя:
   * срез делается здесь, до неё.
   */
  test('счётчик и часы — по всему пересечению, а не по срезу', () => {
    const a = Array.from({ length: 12 }, (_, i) => lib(100 + i, (i + 1) * 10))
    const b = Array.from({ length: 12 }, (_, i) => lib(100 + i, 5))
    const out = compatibility(a, b, metaOf, TAG_STATS)

    expect(out.commonGames).toHaveLength(COMMON_SHOWN)
    expect(out.commonTotal).toBe(12)
    // 10+20+…+120 у первого, 5×12 у второго — включая две игры вне среза
    expect(out.commonHours).toBe(780 + 60)
  })
})

/** Ступени снизу вверх — порядок нужен проверке монотонности */
const STEPS = [
  'Противоположности. Притянетесь?',
  'Разные, но это даже интересно',
  'Есть о чём поиграть вместе',
  'Отличная пара для коопа',
  'Вы буквально один человек',
]

describe('verdict', () => {
  /**
   * Лестница прибита к замерам из докблока verdict(). Проверяется не
   * «правильные ли пороги» — этого без живых процентов не знает никто, — а «не
   * уехали ли они молча». То, что 22 (посторонний с большой библиотекой) и 37
   * (нижний квантиль одной ниши) попадают в одну ступень, — известный недочёт
   * нижнего порога, описанный в докблоке, а не опечатка здесь.
   */
  test('ступени стоят там, где их оставили замеры', () => {
    expect(verdict(0)).toBe(STEPS[0])
    expect(verdict(22)).toBe(STEPS[1])
    expect(verdict(37)).toBe(STEPS[1])
    expect(verdict(65)).toBe(STEPS[3])
    expect(verdict(80)).toBe(STEPS[4])
  })

  test('монотонна и достижимы все пять ступеней', () => {
    const seen = new Set<string>()
    let prev = verdict(0)
    for (let percent = 0; percent <= 100; percent++) {
      const step = verdict(percent)
      seen.add(step)
      if (step !== prev) {
        // ступень может только подниматься, и только на одну за раз
        expect(STEPS.indexOf(step)).toBe(STEPS.indexOf(prev) + 1)
        prev = step
      }
    }
    expect(seen.size).toBe(STEPS.length)
  })
})

describe('tasteCosine', () => {
  const profile = (tags: Record<string, number>) => tags

  test('без пригодной карты тегов честно откатывается к сырому косинусу', () => {
    const a = profile({ Action: 1, RPG: 1 })
    const b = profile({ Action: 1, Strategy: 1 })
    // пустая и слишком мелкая карта — обе непригодны
    for (const map of [new Map<string, number>(), new Map([['Action', 3]])]) {
      expect(tasteCosine(a, b, map)).toBeCloseTo(0.5, 5)
    }
  })

  /**
   * Главная проверка правки: два человека, у которых общее только самое
   * частотное, больше не «один человек». До правки сырой косинус давал здесь
   * заметную близость просто потому, что Singleplayer есть у всех.
   */
  test('общий частотный тег больше не делает из посторонних родственников', () => {
    const a = profile({ Singleplayer: 10, MOBA: 1 })
    const b = profile({ Singleplayer: 10, FPS: 1 })

    const raw = tasteCosine(a, b, new Map())
    const weighted = tasteCosine(a, b, TAG_STATS)

    expect(raw).toBeGreaterThan(0.9)
    expect(weighted).toBeLessThan(raw / 2)
  })

  test('общий редкий тег по-прежнему сближает', () => {
    const together = tasteCosine(
      profile({ Singleplayer: 10, MOBA: 5 }),
      profile({ Singleplayer: 10, MOBA: 5 }),
      TAG_STATS,
    )
    const apart = tasteCosine(
      profile({ Singleplayer: 10, MOBA: 5 }),
      profile({ Singleplayer: 10, FPS: 5 }),
      TAG_STATS,
    )
    expect(together).toBeGreaterThan(apart)
    expect(together).toBeGreaterThan(0.9)
  })

  /**
   * Главная регрессия, ради которой всё делалось.
   *
   * Так выглядит настоящая библиотека: у каждой игры есть частотный костяк
   * (Singleplayer, Action — они у половины каталога) плюс что-то своё. Именно
   * костяк и раздувал сырой косинус: два посторонних получали 85–95% ещё до
   * всякого сходства вкусов.
   *
   * Утверждение — отношение, а не абсолютный порог: конкретное число зависит
   * от карты тегов, а гарантировать надо, что метрика больше не выдаёт
   * посторонних за родственников.
   */
  test('общий частотный костяк больше не выдаёт посторонних за родственников', () => {
    const RARE_A = ['MOBA', 'FPS']
    const RARE_B = ['Story Rich', 'RPG']

    /** Библиотека из n игр: костяк + свой редкий тег, часы разные. */
    const shelf = (rare: string[]): Record<string, number> => {
      const metas = new Map<number, GameMeta>()
      const games: LibraryGame[] = []
      for (let i = 0; i < 20; i++) {
        const appid = 1000 + i
        metas.set(appid, meta(appid, { Singleplayer: 100, Action: 80, [rare[i % rare.length]]: 90 }))
        games.push(lib(appid, 5 + i * 3))
      }
      return buildTagProfile(games, (id) => metas.get(id))
    }

    const a = shelf(RARE_A)
    const b = shelf(RARE_B)

    const raw = tasteCosine(a, b, new Map())
    const weighted = tasteCosine(a, b, TAG_STATS)

    // до правки такие библиотеки получали верхнюю ступень вердикта
    expect(raw).toBeGreaterThan(0.8)
    expect(weighted).toBeLessThan(raw / 2)
  })

  test('одинаковые вкусы остаются одинаковыми — правка не съедает настоящий сигнал', () => {
    const same = profile({ Singleplayer: 100, Action: 90, FPS: 60, MOBA: 1 })
    expect(tasteCosine(same, same, TAG_STATS)).toBeCloseTo(1, 5)
  })

  test('ничего общего — ноль, а не отрицательное число', () => {
    const out = tasteCosine(profile({ MOBA: 5 }), profile({ FPS: 5 }), TAG_STATS)
    expect(out).toBeGreaterThanOrEqual(0)
    expect(out).toBeLessThan(0.01)
  })

  test('пустой профиль не роняет и не выдумывает близость', () => {
    expect(tasteCosine({}, profile({ MOBA: 1 }), TAG_STATS)).toBe(0)
    expect(tasteCosine({}, {}, TAG_STATS)).toBe(0)
  })

  /** Регрессия: ровно то, из-за чего всё затевалось. */
  test('две непохожие библиотеки не дают верхнюю ступень вердикта', () => {
    const shooterFan = buildTagProfile(
      [lib(1, 200)],
      (id) => (id === 1 ? meta(1, { Action: 100, FPS: 90, Singleplayer: 60 }) : undefined),
    )
    const storyFan = buildTagProfile(
      [lib(2, 200)],
      (id) => (id === 2 ? meta(2, { 'Story Rich': 100, RPG: 90, Singleplayer: 60 }) : undefined),
    )

    const percent = Math.round(tasteCosine(shooterFan, storyFan, TAG_STATS) * 100)
    // верхняя ступень вердикта — 80; до правки такие пары её и получали
    expect(percent).toBeLessThan(80)
  })
})
