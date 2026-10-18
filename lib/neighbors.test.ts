import { describe, expect, test } from 'vitest'
import { CONTENT_WARNING_TAGS } from './hook'
import {
  buildNeighbors,
  CONTENT_SHARE,
  coreMultiplier,
  coreTags,
  FEEL_SPAN,
  feelMultiplier,
  MODE_MISMATCH_MULT,
  modeMultiplier,
  NEIGHBORS_K,
  NO_CORE_MULT,
  playModeOf,
  playWeight,
  QUALITY_MULT,
  qualityMultiplier,
  SAME_CORE_MULT,
  THEME_DAMP,
  THEME_TAGS,
  type NeighborGame,
} from './neighbors'
import { tagWeightFrom, weightedCosineTo } from './tagweight'

/** Пропорции настоящего каталога: Singleplayer у половины игр, Mythology — у полусотни */
const STATS = new Map<string, number>([
  ['Singleplayer', 3031],
  ['Action', 2383],
  ['Indie', 1750],
  ['Roguelite', 400],
  ['Action Roguelike', 300],
  ['Hack and Slash', 250],
  ['Mythology', 60],
  ['Farming Sim', 80],
  ['Life Sim', 120],
  ['Great Soundtrack', 900],
  ['Dwarves', 21],
  ['Co-op', 818],
  ['FPS', 587],
  ['PvE', 228],
  ['Nudity', 176],
  ['Visual Novel', 378],
  ['Open World', 981],
])
const W = tagWeightFrom(STATS)!

function game(appid: number, tags: Record<string, number>, over: Partial<NeighborGame> = {}): NeighborGame {
  return { appid, name: `Игра ${appid}`, tags, reviewsTotal: 0, ...over }
}

const HADES = game(1, { 'Action Roguelike': 1000, Mythology: 800, 'Hack and Slash': 700, Indie: 600, Action: 500 })
const HADES2 = game(2, { 'Action Roguelike': 1000, Mythology: 900, 'Hack and Slash': 600, Action: 500 })
const ROGUE = game(3, { Roguelite: 1000, 'Action Roguelike': 900, Indie: 800, Action: 700 })
const FARM = game(4, { 'Farming Sim': 1000, 'Life Sim': 900, Indie: 700 })
/** Только частотные теги: сырым косинусом она «похожа» почти на всех */
const GENERIC = game(5, { Singleplayer: 1000, Action: 900, Indie: 800 })

const ids = (list: Array<{ neighbor: number }> | undefined) => (list ?? []).map((n) => n.neighbor)

describe('coreTags — суть игры', () => {
  test('из первых пяти по голосам — самый весомый с редкостью, а не первый', () => {
    // у Action больше голосов, но он у каждой второй игры. Пример — на
    // механике: Mythology, стоявшая здесь раньше, — тема, и в суть не идёт
    expect(coreTags({ Action: 1000, 'Hack and Slash': 800 }, W)).toEqual(['Hack and Slash', 'Action'])
  })

  test('тема в суть не идёт, пока в верхушке есть механика', () => {
    // у Deep Rock Galactic Dwarves — первый по голосам и самый редкий
    expect(coreTags({ Dwarves: 1000, 'Co-op': 394, PvE: 330, FPS: 304 }, W)).toEqual(['PvE', 'Co-op'])
  })

  test('одни темы — суть из них, а не пустая', () => {
    expect(coreTags({ Dwarves: 1000, Mythology: 500 }, W)).toEqual(['Dwarves', 'Mythology'])
  })

  test('без веса — просто первые по голосам, ничьи по имени', () => {
    expect(coreTags({ Zzz: 5, Aaa: 5, Mid: 3 }, null)).toEqual(['Aaa', 'Zzz'])
  })

  test('хвост за пятым по голосам в суть не попадает, как бы редок ни был', () => {
    const tags = { Action: 1000, Indie: 900, Singleplayer: 800, Roguelite: 700, 'Hack and Slash': 600, 'Farming Sim': 10 }
    expect(coreTags(tags, W)).not.toContain('Farming Sim')
  })

  test('все пять частотные — первые по голосам', () => {
    expect(coreTags({ Singleplayer: 1000 }, W)).toEqual(['Singleplayer'])
  })
})

describe('coreMultiplier', () => {
  test('общий первый — выше, ни одного общего из двух — ниже, иначе как есть', () => {
    expect(coreMultiplier(['A', 'B'], ['A', 'C'])).toBe(SAME_CORE_MULT)
    expect(coreMultiplier(['A', 'B'], ['C', 'D'])).toBe(NO_CORE_MULT)
    expect(coreMultiplier(['A', 'B'], ['B', 'A'])).toBe(1)
    expect(coreMultiplier([], [])).toBe(NO_CORE_MULT)
  })
})

describe('тема весит меньше механики', () => {
  test('playWeight приглушает только тему', () => {
    const pw = playWeight(W)
    expect(pw('Dwarves')).toBeCloseTo(W('Dwarves') * THEME_DAMP, 12)
    expect(pw('PvE')).toBe(W('PvE'))
  })

  test('в списке тем нет механики и предупреждений', () => {
    // Zombies — орды и баррикады, то есть механика (см. докблок THEME_TAGS)
    for (const t of ['Zombies', 'Roguelike', 'Co-op', 'FPS', 'Puzzle', 'Farming Sim', 'Space Sim', 'Naval Combat']) {
      expect(THEME_TAGS.has(t), t).toBe(false)
    }
    for (const t of CONTENT_WARNING_TAGS) expect(THEME_TAGS.has(t), t).toBe(false)
  })
})

describe('режим, ощущение и отзывы', () => {
  test('режим по категориям Steam', () => {
    expect(playModeOf([2])).toBe('solo')
    expect(playModeOf([1, 9, 38])).toBe('multi')
    expect(playModeOf([2, 1, 9, 38])).toBe('both')
    expect(playModeOf([])).toBeUndefined()
    // категории без режима (достижения, карточки) — режим неизвестен, а не «один»
    expect(playModeOf([22, 29])).toBeUndefined()
  })

  test('штраф только у крайних: «только по сети» против «только одному»', () => {
    expect(modeMultiplier('multi', 'solo')).toBe(MODE_MISMATCH_MULT)
    expect(modeMultiplier('solo', 'multi')).toBe(MODE_MISMATCH_MULT)
    // у Stardew Valley кооп есть, у My Time at Portia нет — соседи как были
    expect(modeMultiplier('both', 'solo')).toBe(1)
    expect(modeMultiplier('multi', 'both')).toBe(1)
    expect(modeMultiplier(undefined, 'multi')).toBe(1)
  })

  test('ощущение: 0.85..1, без семантики у любой стороны — 1', () => {
    expect(feelMultiplier({ session: 'short', pace: 50 }, { session: 'short', pace: 50 })).toBe(1)
    expect(feelMultiplier({ session: 'short', pace: 50 }, { session: 'long', pace: 50 })).toBeCloseTo(1 - FEEL_SPAN, 12)
    expect(feelMultiplier({ session: 'medium', pace: 10 }, { session: 'medium', pace: 90 })).toBeCloseTo(
      1 - FEEL_SPAN * 0.8,
      12,
    )
    // берётся большее из двух расхождений, а не сумма: ниже 0.85 не бывает
    expect(feelMultiplier({ session: 'short', pace: 0 }, { session: 'long', pace: 100 })).toBeCloseTo(1 - FEEL_SPAN, 12)
    expect(feelMultiplier(undefined, { session: 'long', pace: 50 })).toBe(1)
  })

  test('«Смешанные» отзывы соседа — чуть ниже, неизвестные — как есть', () => {
    expect(qualityMultiplier(65)).toBe(QUALITY_MULT)
    expect(qualityMultiplier(70)).toBe(1)
    expect(qualityMultiplier(undefined)).toBe(1)
    expect(qualityMultiplier(Number.NaN)).toBe(1)
  })

  test('поправки доходят до счёта: игра без данных меряется как раньше', () => {
    const tags = { 'Action Roguelike': 1000, Roguelite: 800 }
    const a = game(50, tags, { mode: 'solo', feel: { session: 'short', pace: 80 } })
    const b = game(51, tags)
    const c = game(52, tags, { mode: 'multi', percent: 60, feel: { session: 'long', pace: 80 } })
    const out = buildNeighbors([a, b, c], W)
    const score = (i: number, j: number) => out.get(i)!.find((n) => n.neighbor === j)!.score
    expect(score(50, 52) / score(50, 51)).toBeCloseTo(MODE_MISMATCH_MULT * (1 - FEEL_SPAN) * QUALITY_MULT, 10)
    // отзывы — свойство соседа, а не пары: у c про b «Смешанных» нет
    expect(score(52, 51) / score(50, 51)).toBeCloseTo(1, 10)
  })
})

describe('общие предупреждения сближают слабее', () => {
  /** Как Cyberpunk 2077: без темы главным в векторе остаётся Nudity */
  const CP = game(60, { 'Open World': 1000, FPS: 700, Nudity: 830 })
  const NOVEL = game(61, { 'Visual Novel': 1000, Nudity: 1000 })
  const SHOOTER = game(62, { 'Open World': 900, FPS: 900 })
  const coreOf = (a: NeighborGame, b: NeighborGame) => coreMultiplier(coreTags(a.tags, W), coreTags(b.tags, W))

  test('общий Nudity весит в произведении CONTENT_SHARE, а в длине — целиком', () => {
    const out = buildNeighbors([CP, NOVEL, SHOOTER], W)
    const nb = out.get(60)!.find((n) => n.neighbor === 61)!
    // у пары общего — один Nudity: счёт ровно в CONTENT_SHARE раз от прежнего
    expect(nb.score / coreOf(CP, NOVEL)).toBeCloseTo(weightedCosineTo(CP.tags, W)(NOVEL.tags) * CONTENT_SHARE, 10)
    expect(ids(out.get(60))[0]).toBe(62)
  })

  test('чистой игре взрослая не ближе, чем была: её длина на месте', () => {
    const clean = game(63, { 'Visual Novel': 1000 })
    const [nb] = buildNeighbors([clean, NOVEL], W).get(63) ?? []
    expect(nb.score / coreOf(clean, NOVEL)).toBeCloseTo(weightedCosineTo(clean.tags, W)(NOVEL.tags), 10)
  })
})

describe('buildNeighbors', () => {
  test('счёт пары — weightedCosineTo с приглушённой темой и поправкой за суть', () => {
    // Вес — playWeight(W), а не W: у Hades тема Mythology идёт с THEME_DAMP.
    // Категорий, отзывов и семантики у этих игр нет — других поправок тоже
    const games = [HADES, HADES2, ROGUE, FARM]
    const out = buildNeighbors(games, W)
    for (const a of games) {
      const taste = weightedCosineTo(a.tags, playWeight(W))
      for (const nb of out.get(a.appid) ?? []) {
        const b = games.find((g) => g.appid === nb.neighbor)!
        const mult = coreMultiplier(coreTags(a.tags, W), coreTags(b.tags, W))
        expect(nb.score, `${a.appid} → ${b.appid}`).toBeCloseTo(taste(b.tags) * mult, 10)
      }
    }
  })

  test('игра из одних частотных тегов не становится соседом всех подряд', () => {
    // Сырым косинусом GENERIC — 0.6+ почти с любой игрой, а у Hades и рогалика
    // общего редкого — Action Roguelike. Вес редкости её отодвигает
    const out = buildNeighbors([HADES, HADES2, ROGUE, FARM, GENERIC], W)
    expect(ids(out.get(1))[0]).toBe(2)
    expect(ids(out.get(1)).indexOf(5)).toBeGreaterThan(ids(out.get(1)).indexOf(3))
    // и у рогалика первой стоит игра с общим редким, а не общий костяк
    expect(ids(out.get(3))[0]).not.toBe(5)
  })

  test('сторона, которая с весом ничего не весит, меряется сырым косинусом — как weightedCosineTo', () => {
    const lonely = game(9, { Singleplayer: 1000 })
    const other = game(10, { Singleplayer: 500, Mythology: 500 })
    const out = buildNeighbors([lonely, other], W)
    const [nb] = out.get(9) ?? []
    expect(nb?.neighbor).toBe(10)
    const mult = coreMultiplier(coreTags(lonely.tags, W), coreTags(other.tags, W))
    expect(nb.score).toBeCloseTo(weightedCosineTo(lonely.tags, playWeight(W))(other.tags) * mult, 10)
    // а наоборот — нет: со взвешенной стороны у неё ноль, и соседом она не становится
    expect(ids(out.get(10))).toEqual([])
  })

  test('без карты тегов — сырой косинус, но всё равно соседи', () => {
    const out = buildNeighbors([HADES, HADES2, FARM], null)
    expect(ids(out.get(1))).toEqual([2, 4])
  })

  test('сама игра, её издания и дубли изданий соседа — мимо', () => {
    const skyrim = game(20, { 'Open World': 1000, Dragons: 900 }, { name: 'The Elder Scrolls V: Skyrim' })
    const skyrimSe = game(21, { 'Open World': 1000, Dragons: 900 }, { name: 'The Elder Scrolls V: Skyrim Special Edition' })
    const dogma = game(22, { 'Open World': 900, Dragons: 1000 }, { name: "Dragon's Dogma", reviewsTotal: 5 })
    const dogmaGold = game(23, { 'Open World': 900, Dragons: 1000 }, { name: "Dragon's Dogma Gold Edition", reviewsTotal: 50 })
    const out = buildNeighbors([skyrim, skyrimSe, dogma, dogmaGold], null)
    // Skyrim и его издание друг другу не соседи; из двух Dogma — одна, обсуждаемее
    expect(ids(out.get(20))).toEqual([23])
    expect(ids(out.get(21))).toEqual([23])
  })

  test('записи чужих магазинов соседями не бывают, но свои соседи у них есть', () => {
    const other = game(-7, HADES.tags)
    const out = buildNeighbors([HADES, HADES2, other], W)
    expect(ids(out.get(1))).not.toContain(-7)
    expect(ids(out.get(-7))).toEqual([1, 2])
  })

  test('не больше k, ничьи — по отзывам, потом по appid', () => {
    const twins = Array.from({ length: NEIGHBORS_K + 5 }, (_, i) =>
      game(100 + i, { Roguelite: 1000 }, { reviewsTotal: i % 3 === 0 ? 10 : 1 }),
    )
    const out = buildNeighbors(twins, W)
    const list = ids(out.get(100))
    expect(list).toHaveLength(NEIGHBORS_K)
    expect(list.slice(0, 5)).toEqual([103, 106, 109, 112, 115])
    expect(list.slice(5, 8)).toEqual([101, 102, 104])
    expect(buildNeighbors(twins, W, { k: 3 }).get(100)).toHaveLength(3)
  })

  test('пересборка на том же каталоге даёт то же самое', () => {
    const games = [HADES, HADES2, ROGUE, FARM, GENERIC]
    expect(buildNeighbors([...games].reverse(), W)).toEqual(buildNeighbors(games, W))
  })

  test('общие теги — по вкладу в сходство, без общих мест', () => {
    const a = game(30, { Mythology: 1000, 'Great Soundtrack': 1000, 'Hack and Slash': 400, Action: 900 })
    const b = game(31, { Mythology: 900, 'Great Soundtrack': 900, 'Hack and Slash': 900, Action: 900 })
    const [nb] = buildNeighbors([a, b], W).get(30) ?? []
    // Great Soundtrack — похвала, а не суть; Action весит почти ноль, но и он
    // в подпись не идёт — он из общих мест. Mythology редкостью выше, но она
    // тема и приглушена (playWeight): подпись называет сначала механику
    expect(nb.shared).toEqual(['Hack and Slash', 'Mythology'])
  })

  test('игра без тегов — пустой список, а не падение', () => {
    const out = buildNeighbors([game(40, {}), HADES], W)
    expect(out.get(40)).toEqual([])
    expect(ids(out.get(1))).toEqual([])
  })
})
