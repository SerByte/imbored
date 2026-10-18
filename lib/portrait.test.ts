import { describe, expect, test } from 'vitest'
import {
  archetypeKey,
  archetypeKeyFromLabel,
  archetypeLabel,
  archetypeLabelOf,
  buildPortrait,
  isKnownArchetype,
} from './portrait'
import { buildWrapped } from './wrapped'
import { hiddenLibrary, hiddenLibraryMetas } from './testing/hiddenlibrary'
import type { GameMeta, LibraryGame } from './types'

function lib(appid: number, hours: number): LibraryGame {
  return { appid, name: `g${appid}`, playtimeForever: hours * 60, playtime2Weeks: 0 }
}

function meta(appid: number, tags: Record<string, number>): GameMeta {
  return { appid, name: `g${appid}`, tags, genres: [], categories: [2] }
}

const METAS = new Map<number, GameMeta>([
  [1, meta(1, { Automation: 100, Indie: 90 })], // Indie — стоп-тег
  [2, meta(2, { Roguelike: 100 })],
  [3, meta(3, { 'Story Rich': 100 })],
  [4, meta(4, { Zorkovka: 100 })], // неизвестный тег — фолбэк-лейбл
])
const metaOf = (id: number) => METAS.get(id)

describe('buildPortrait при скрытом времени', () => {
  const metas = new Map(hiddenLibraryMetas().map((m) => [m.appid, m]))

  test('20 игр с нулями: архетипы по всей библиотеке, «не запущено» не считается', () => {
    const p = buildPortrait(hiddenLibrary(), (id) => metas.get(id))
    expect(p.facts.playtimeHidden).toBe(true)
    expect(p.facts.unplayedCount).toBe(0)
    expect(p.facts.topGame).toBeNull()
    expect(p.archetypes.map((a) => a.label)).toEqual(
      expect.arrayContaining(['рогалик-энтузиаст', 'строитель фабрик']),
    )
  })

  test('обычная библиотека — признака нет', () => {
    expect(buildPortrait([lib(1, 300), lib(2, 0)], metaOf).facts.playtimeHidden).toBe(false)
  })
})

describe('buildPortrait', () => {
  test('архетипы: проценты в сумме ~100, известные лейблы по-русски', () => {
    const p = buildPortrait([lib(1, 300), lib(2, 100), lib(3, 50)], metaOf)
    const sum = p.archetypes.reduce((s, a) => s + a.percent, 0)
    expect(sum).toBeGreaterThanOrEqual(98)
    expect(sum).toBeLessThanOrEqual(102)
    expect(p.archetypes[0].label).toBe('строитель фабрик') // Automation доминирует
    expect(p.archetypes[0].percent).toBeGreaterThan(p.archetypes[1].percent)
  })

  test('barPercent нормирован к лидеру: у топ-1 всегда полная полоса', () => {
    const p = buildPortrait([lib(1, 300), lib(2, 100), lib(3, 50)], metaOf)
    expect(p.archetypes[0].barPercent).toBe(100)
    expect(p.archetypes.every((a) => a.barPercent > 0 && a.barPercent <= 100)).toBe(true)
    // порядок один и тот же по обеим шкалам
    expect(p.archetypes[1].barPercent).toBeGreaterThan(p.archetypes[2].barPercent)
  })

  test('теги с одинаковой подписью схлопываются в один архетип', () => {
    const metas = new Map<number, GameMeta>([
      [10, meta(10, { FPS: 100, Shooter: 90 })], // оба → «стрелок»
      [11, meta(11, { Roguelike: 50 })],
    ])
    const p = buildPortrait([lib(10, 100), lib(11, 50)], (id) => metas.get(id))
    const labels = p.archetypes.map((a) => a.label)
    expect(labels.filter((l) => l === 'стрелок')).toHaveLength(1)
    expect(new Set(labels).size).toBe(labels.length)
  })

  test('стоп-теги (Indie и т.п.) не становятся архетипами', () => {
    const p = buildPortrait([lib(1, 300)], metaOf)
    expect(p.archetypes.some((a) => a.tag === 'Indie')).toBe(false)
  })

  test('неизвестный тег получает фолбэк-лейбл и помечается как ненадёжный', () => {
    const p = buildPortrait([lib(4, 100)], metaOf)
    expect(p.archetypes[0].label).toBe('фанат Zorkovka')
    expect(p.archetypes[0].known).toBe(false)
  })

  test('известный тег помечается known — только такой можно вынести в заголовок', () => {
    const p = buildPortrait([lib(1, 300)], metaOf)
    expect(p.archetypes[0].known).toBe(true)
  })

  test('факты: игры, часы, бэклог, топ-игра с долей', () => {
    const p = buildPortrait([lib(1, 300), lib(2, 100), lib(3, 0)], metaOf)
    expect(p.facts.gamesCount).toBe(3)
    expect(p.facts.totalHours).toBe(400)
    expect(p.facts.unplayedCount).toBe(1)
    expect(p.facts.topGame).toEqual({ appid: 1, name: 'g1', hours: 300, sharePercent: 75 })
  })

  test('доля топ-игры считается от минут, а не от округлённых часов — больше 100% не бывает', () => {
    // 85 минут на всю библиотеку: totalHours округляется до 1, и деление
    // 85/60 на 1 давало «142% всего времени» на карточке, которая уходит в чаты
    const tiny: LibraryGame = { appid: 1, name: 'g1', playtimeForever: 85, playtime2Weeks: 0 }
    const p = buildPortrait([tiny, lib(2, 0)], metaOf)
    expect(p.facts.topGame?.sharePercent).toBe(100)
    expect(p.facts.topGame?.sharePercent).toBe(
      buildWrapped([tiny, lib(2, 0)], metaOf).top[0].sharePercent,
    )
    // 60 + 25 минут: честные 71%, а не 100% от «1 ч»
    const two = buildPortrait(
      [{ ...tiny, playtimeForever: 60 }, { ...tiny, appid: 2, name: 'g2', playtimeForever: 25 }],
      metaOf,
    )
    expect(two.facts.topGame?.sharePercent).toBe(71)
  })

  test('библиотека меньше получаса — топ-игры нет, как и раньше («0 ч (100%)» не пишем)', () => {
    const tiny: LibraryGame = { appid: 1, name: 'g1', playtimeForever: 20, playtime2Weeks: 0 }
    expect(buildPortrait([tiny], metaOf).facts.topGame).toBeNull()
  })

  test('саундтрек в бэклог портрета не входит — число то же, что у buildWrapped', () => {
    const ost = { ...lib(9, 0), name: 'g1 - Original Soundtrack' }
    const p = buildPortrait([lib(1, 300), lib(3, 0), ost], metaOf)
    expect(p.facts.unplayedCount).toBe(1)
    expect(p.facts.gamesCount).toBe(3)
  })

  test('пустая библиотека не роняет', () => {
    const p = buildPortrait([], metaOf)
    expect(p.archetypes).toEqual([])
    expect(p.facts.gamesCount).toBe(0)
    expect(p.facts.topGame).toBeNull()
  })
})

/**
 * Архетип определяет ключ — канонический тег, а подпись только выводится
 * (lib/archetypes). Схлопывались синонимы раньше по русской подписи; ключ
 * обязан схлопывать ровно те же теги, иначе у той же библиотеки сменились бы
 * четвёрка, проценты и заголовок.
 */
describe('архетипы: ключ и подписи на двух языках', () => {
  const CYRILLIC = /[А-Яа-яЁё]/
  /**
   * Русский словарь, каким он был до ключей, — слепок. Подпись по ключу
   * обязана совпасть с ним на каждом теге: русский портрет не меняется ни на
   * букву, а синонимы — те же, что давали одинаковую подпись.
   */
  const FROZEN_RU: Record<string, string> = {
    Automation: 'строитель фабрик',
    'Base Building': 'строитель баз',
    Roguelike: 'рогалик-энтузиаст',
    Roguelite: 'рогалик-энтузиаст',
    'Action Roguelike': 'рогалик-энтузиаст',
    'Story Rich': 'охотник за историями',
    MOBA: 'ветеран MOBA',
    FPS: 'стрелок',
    Shooter: 'стрелок',
    'Tactical FPS': 'тактический стрелок',
    Competitive: 'соревновательный зверь',
    'Open World': 'исследователь открытых миров',
    Survival: 'выживальщик',
    'Farming Sim': 'мирный фермер',
    Strategy: 'стратег',
    Tactical: 'тактик',
    RPG: 'ролевик',
    'Action RPG': 'ролевик',
    'Co-op': 'кооп-игрок',
    'Online Co-Op': 'кооп-игрок',
    Puzzle: 'головоломщик',
    Sandbox: 'архитектор песочниц',
    Metroidvania: 'картограф метроидваний',
    'Souls-like': 'терпеливый соулслайкер',
    'Card Game': 'мастер колоды',
    'Deck Building': 'мастер колоды',
    Difficult: 'любитель боли',
    Simulation: 'симуляторщик',
    'Colony Sim': 'управляющий колонией',
    Horror: 'любитель ужасов',
    Platformer: 'платформер-про',
    Crafting: 'крафтер',
    Exploration: 'исследователь',
    MMORPG: 'житель MMO',
    'Battle Royale': 'боец королевских битв',
    Mining: 'шахтёр',
    'Turn-Based': 'пошаговый мыслитель',
  }
  const TAGS = Object.keys(FROZEN_RU)

  test('русская подпись по ключу — та же, что в словаре до ключей', () => {
    for (const tag of TAGS) {
      expect(archetypeLabel(archetypeKey(tag)), tag).toBe(FROZEN_RU[tag])
      expect(archetypeLabel(tag, 'ru'), tag).toBe(FROZEN_RU[tag])
      expect(isKnownArchetype(tag), tag).toBe(true)
    }
  })

  test('один ключ — ровно у тех тегов, что делили русскую подпись', () => {
    for (const a of TAGS) {
      for (const b of TAGS) {
        expect(archetypeKey(a) === archetypeKey(b), `${a} / ${b}`).toBe(FROZEN_RU[a] === FROZEN_RU[b])
      }
    }
  })

  test('синонимы — в одном ключе: стрелки, рогалики, ролевые, кооператив, колоды', () => {
    expect(archetypeKey('Shooter')).toBe('FPS')
    expect(new Set(['Roguelike', 'Roguelite', 'Action Roguelike'].map(archetypeKey))).toEqual(new Set(['Roguelike']))
    expect(archetypeKey('Action RPG')).toBe('RPG')
    expect(archetypeKey('Online Co-Op')).toBe('Co-op')
    expect(archetypeKey('Deck Building')).toBe('Card Game')
    // неизвестный тег — сам себе ключ
    expect(archetypeKey('Zorkovka')).toBe('Zorkovka')
  })

  test('английские подписи: голое существительное из глоссария, без кириллицы', () => {
    expect(archetypeLabel('FPS', 'en')).toBe('sharpshooter')
    expect(archetypeLabel('Shooter', 'en')).toBe('sharpshooter')
    expect(archetypeLabel('Automation', 'en')).toBe('factory builder')
    expect(archetypeLabel('Strategy', 'en')).toBe('strategist')
    expect(archetypeLabel('Roguelite', 'en')).toBe('roguelike junkie')
    expect(archetypeLabel('Difficult', 'en')).toBe('pain enjoyer')
    for (const tag of TAGS) {
      const label = archetypeLabel(tag, 'en')
      expect(label, tag).not.toMatch(CYRILLIC)
      // голое существительное: «you're 37% strategist», без артикля и заглавной
      expect(label, tag).not.toMatch(/^(a|an|the) /i)
    }
  })

  test('английские подписи синонимов совпадают так же, как русские', () => {
    for (const a of TAGS) {
      for (const b of TAGS) {
        if (FROZEN_RU[a] === FROZEN_RU[b]) expect(archetypeLabel(a, 'en'), `${a} / ${b}`).toBe(archetypeLabel(b, 'en'))
      }
    }
  })

  test('неизвестный тег — «{tag} fan», и он не «известный»', () => {
    expect(archetypeLabel('Zorkovka', 'en')).toBe('Zorkovka fan')
    expect(archetypeLabel('Zorkovka', 'ru')).toBe('фанат Zorkovka')
    expect(isKnownArchetype('Zorkovka')).toBe(false)
    // наследованное от Object — не словарь
    expect(isKnownArchetype('constructor')).toBe(false)
    expect(archetypeLabel('toString', 'en')).toBe('toString fan')
  })

  test('портрет несёт ключ: по нему подпись на любом языке, проценты одни', () => {
    const metas = new Map<number, GameMeta>([
      [10, meta(10, { FPS: 100, Shooter: 90 })],
      [11, meta(11, { Roguelite: 60, 'Action Roguelike': 40 })],
      [12, meta(12, { Zorkovka: 100 })],
    ])
    const p = buildPortrait([lib(10, 100), lib(11, 50), lib(12, 20)], (id) => metas.get(id))
    expect(p.archetypes.map((a) => a.key)).toEqual(['FPS', 'Roguelike', 'Zorkovka'])
    // первый встреченный тег — для улик, ключ — канонический
    expect(p.archetypes[1]).toMatchObject({ tag: 'Roguelite', key: 'Roguelike', label: 'рогалик-энтузиаст' })
    expect(p.archetypes.map((a) => archetypeLabel(a.key, 'en'))).toEqual([
      'sharpshooter',
      'roguelike junkie',
      'Zorkovka fan',
    ])
    expect(p.archetypes.map((a) => a.known)).toEqual([true, true, false])
    // label — русская подпись того же ключа
    for (const a of p.archetypes) expect(a.label).toBe(archetypeLabel(a.key, 'ru'))
  })

  test('ключ узнаётся по подписи на обоих языках — у каждого ключа подписи свои', () => {
    for (const tag of TAGS) {
      const key = archetypeKey(tag)
      for (const locale of ['ru', 'en'] as const) {
        expect(archetypeKeyFromLabel(archetypeLabel(key, locale)), `${tag} ${locale}`).toBe(key)
      }
      // прежняя русская подпись — та, что лежит в записях кэша до ключей
      expect(archetypeKeyFromLabel(FROZEN_RU[tag]), tag).toBe(key)
    }
    expect(archetypeKeyFromLabel('фанат Zorkovka')).toBe('Zorkovka')
    expect(archetypeKeyFromLabel('Zorkovka fan')).toBe('Zorkovka')
    expect(archetypeKeyFromLabel('фанат Base Building')).toBe('Base Building')
  })

  test('подпись не из словаря и не запасная — ключа нет', () => {
    for (const label of ['', 'кто-то', 'фанат ', ' fan', 'fan', 'constructor', 'toString']) {
      expect(archetypeKeyFromLabel(label), label).toBeNull()
    }
  })

  test('ключа нет совсем — нейтральное «игрок», а не «undefined fan»', () => {
    expect(archetypeLabel(undefined, 'en')).toBe('player')
    expect(archetypeLabel(null, 'en')).toBe('player')
    expect(archetypeLabel('', 'en')).toBe('player')
    expect(archetypeLabel(undefined)).toBe('игрок')
  })

  test('archetypeLabelOf по-русски — label как есть, ни на букву иначе', () => {
    expect(archetypeLabelOf({ key: 'FPS', label: 'стрелок' })).toBe('стрелок')
    expect(archetypeLabelOf({ key: 'FPS', label: 'стрелок' }, 'ru')).toBe('стрелок')
    expect(archetypeLabelOf({ label: 'что угодно' }, 'ru')).toBe('что угодно')
    expect(archetypeLabelOf({ key: 'Zorkovka', label: 'фанат Zorkovka' }, 'ru')).toBe('фанат Zorkovka')
  })

  test('archetypeLabelOf по-английски: по ключу, без ключа — по русской подписи, кириллицы нет никогда', () => {
    expect(archetypeLabelOf({ key: 'Automation', label: 'строитель фабрик' }, 'en')).toBe('factory builder')
    // запись до ключей: только русская подпись
    expect(archetypeLabelOf({ label: 'стрелок' }, 'en')).toBe('sharpshooter')
    expect(archetypeLabelOf({ label: 'фанат Fantasy' }, 'en')).toBe('Fantasy fan')
    expect(archetypeLabelOf({ key: null, label: 'рогалик-энтузиаст' }, 'en')).toBe('roguelike junkie')
    // подпись уже английская — та же, а не «… fan»
    expect(archetypeLabelOf({ label: 'strategist' }, 'en')).toBe('strategist')
    // подпись, по которой ключ не узнать, — нейтральное слово, а не кириллица
    expect(archetypeLabelOf({ label: 'кто-то' }, 'en')).toBe('player')
    for (const tag of TAGS) {
      const fromLabel = archetypeLabelOf({ label: FROZEN_RU[tag] }, 'en')
      expect(fromLabel, tag).toBe(archetypeLabel(tag, 'en'))
      expect(fromLabel, tag).not.toMatch(CYRILLIC)
    }
  })

  test('архетипы портрета по-английски — без кириллицы и с ключом, и без', () => {
    const metas = new Map<number, GameMeta>([
      [10, meta(10, { FPS: 100, Strategy: 80 })],
      [11, meta(11, { 'Deck Building': 60, Fantasy: 40 })],
    ])
    const p = buildPortrait([lib(10, 100), lib(11, 50)], (id) => metas.get(id))
    expect(p.archetypes.length).toBeGreaterThan(2)
    for (const a of p.archetypes) {
      expect(archetypeLabelOf(a, 'en'), a.key).not.toMatch(CYRILLIC)
      // та же подпись у записи без ключа — какой была модель до ключей
      expect(archetypeLabelOf({ label: a.label }, 'en'), a.key).toBe(archetypeLabelOf(a, 'en'))
    }
  })
})
