import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { createDb, upsertGameMeta } from './db'
import {
  buildTrivia,
  loadTriviaCatalog,
  TRIVIA_COUNT,
  type TriviaCatalogGame,
  type TriviaParty,
  type TriviaQuestion,
} from './trivia'
import { tagRu } from './tagsru'
import { hiddenLibrary } from './testing/hiddenlibrary'
import type { LibraryGame } from './types'

function game(appid: number, name: string, over: Partial<TriviaCatalogGame> = {}): TriviaCatalogGame {
  return {
    appid,
    name,
    ccu: 1000 + appid,
    art: { header: `https://cdn/${appid}.jpg` },
    headerImage: `https://cdn/${appid}.jpg`,
    tags: { Action: 100, Multiplayer: 80, Indie: 60 },
    ...over,
  }
}

const CATALOG: TriviaCatalogGame[] = Array.from({ length: 24 }, (_, i) =>
  game(100 + i, `Игра ${i}`, { ccu: (i + 1) * 5000 }),
)

function lib(...rows: Array<[number, string, number]>): LibraryGame[] {
  return rows.map(([appid, name, h]) => ({
    appid,
    name,
    playtimeForever: h * 60,
    playtime2Weeks: 0,
  }))
}

const PARTY: TriviaParty[] = [
  { steamid: 'a', name: 'Аня', library: lib([1, 'Dota 2', 300], [2, 'Portal 2', 10], [3, 'Factorio', 90]) },
  { steamid: 'b', name: 'Боря', library: lib([1, 'Dota 2', 20], [4, 'Terraria', 200], [5, 'Valheim', 50]) },
]

describe('buildTrivia', () => {
  test('пустой каталог и комната на одного — пустой список, без исключений', () => {
    // Викторина обязана уметь не показываться: локальная база и свежий каталог
    // могут не дать ни одного пригодного вопроса
    expect(buildTrivia({ seed: 'r:1:0', catalog: [], party: [] })).toEqual([])
  })

  test('в одиночку набирает вопросы из каталога', () => {
    const qs = buildTrivia({ seed: 'r:1:0', catalog: CATALOG, party: [PARTY[0]] })
    expect(qs).toHaveLength(TRIVIA_COUNT)
    // вопросы про «у кого больше часов» в одиночку невозможны
    expect(qs.every((q) => ['ccu', 'cover', 'nottag'].includes(q.kind))).toBe(true)
  })

  test('в пати появляются вопросы про своих, но не забивают весь список', () => {
    const qs = buildTrivia({ seed: 'r:1:0', catalog: CATALOG, party: PARTY })
    const partyKinds = qs.filter((q) => q.kind === 'hours' || q.kind === 'toptrio')
    expect(partyKinds.length).toBeGreaterThan(0)
    // иначе комната на двоих получила бы десять «у кого больше часов» подряд
    expect(partyKinds.length).toBeLessThanOrEqual(Math.ceil(TRIVIA_COUNT / 2))
  })

  test('один и тот же сид даёт тот же набор, другой — другой', () => {
    const a = buildTrivia({ seed: 'r:1:0', catalog: CATALOG, party: PARTY }).map((q) => q.id)
    const b = buildTrivia({ seed: 'r:1:0', catalog: CATALOG, party: PARTY }).map((q) => q.id)
    const c = buildTrivia({ seed: 'r:1:1', catalog: CATALOG, party: PARTY }).map((q) => q.id)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  test('у каждого вопроса валидный ответ и нет повторов', () => {
    const qs = buildTrivia({ seed: 'r:1:0', catalog: CATALOG, party: PARTY })
    for (const q of qs) {
      expect(q.options.length).toBeGreaterThanOrEqual(2)
      expect(q.answer).toBeGreaterThanOrEqual(0)
      expect(q.answer).toBeLessThan(q.options.length)
      // варианты не должны повторяться — иначе «правильных» ответов два
      expect(new Set(q.options.map((o) => o.label)).size).toBe(q.options.length)
    }
    expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length)
  })

  test('ccu: правильный ответ — тот, где игроков больше', () => {
    const qs = buildTrivia({ seed: 'r:1:0', catalog: CATALOG, party: [] })
    for (const q of qs.filter((x) => x.kind === 'ccu')) {
      const winner = q.options[q.answer].label
      const other = q.options.find((_, i) => i !== q.answer)!.label
      const w = CATALOG.find((g) => g.name === winner)!
      const o = CATALOG.find((g) => g.name === other)!
      expect(w.ccu!).toBeGreaterThan(o.ccu!)
    }
  })

  test('ccu не спрашивается, когда онлайн неизвестен', () => {
    const noCcu = CATALOG.map((g) => ({ ...g, ccu: null }))
    const qs = buildTrivia({ seed: 'r:1:0', catalog: noCcu, party: [] })
    expect(qs.some((q) => q.kind === 'ccu')).toBe(false)
  })

  test('nottag: верный вариант отсутствует у игры, остальные есть', () => {
    const varied: TriviaCatalogGame[] = CATALOG.map((g, i) => ({
      ...g,
      tags: (i % 2
        ? { Action: 90, Co_op: 70, RPG: 50 }
        : { Strategy: 90, Indie: 70, Puzzle: 50 }) as Record<string, number>,
    }))
    const qs = buildTrivia({ seed: 'r:9:0', catalog: varied, party: [] })
    for (const q of qs.filter((x) => x.kind === 'nottag')) {
      const target = varied.find((g) => q.prompt.includes(g.name))!
      q.options.forEach((o, i) => {
        // Варианты — подписи (tagRu), а теги игры — английские ключи:
        // сравниваем подпись с подписями, как их видит человек
        const has = Object.keys(target.tags).map(tagRu).includes(o.label)
        expect(has).toBe(i !== q.answer)
      })
    }
  })

  test('nottag: теги в вариантах — по-русски, как в колоде под викториной', () => {
    // Ключи tags_json английские (lib/tagsru), и вопрос показывал «Action»
    // и «Hack and Slash», пока карточка SwipeDeck ниже рисовала те же теги
    // по-русски
    const ru: TriviaCatalogGame[] = CATALOG.map((g) => ({
      ...g,
      tags: { Action: 90, RPG: 70, Strategy: 50, Indie: 30 },
    }))
    ru[0] = { ...ru[0], tags: { Puzzle: 90, Multiplayer: 70, 'Co-op': 50 } }
    let seen = 0
    for (let round = 0; round < 20; round++) {
      for (const q of buildTrivia({ seed: `r:ru:${round}`, catalog: ru, party: [] })) {
        if (q.kind !== 'nottag') continue
        seen++
        const labels = q.options.map((o) => o.label)
        for (const key of ['Action', 'RPG', 'Strategy', 'Indie', 'Puzzle', 'Multiplayer', 'Co-op']) {
          expect(labels, q.prompt).not.toContain(key)
        }
        expect(labels.every((l) => /[а-яё]/i.test(l)), labels.join(', ')).toBe(true)
        // id — по английскому ключу: дедуп батча не зависит от словаря
        expect(q.id).toMatch(/^nottag:\d+:[A-Za-z]/)
      }
    }
    // иначе проверка выше прошла бы вхолостую
    expect(seen).toBeGreaterThan(0)
  })

  test('nottag: два ключа с одной подписью не дают двух одинаковых вариантов', () => {
    // «Dystopian » с пробелом лежит в tags_json как есть (lib/tagsru), а
    // tagRu подписывает его так же, как «Dystopian»: такой «чужой» тег
    // выглядел бы ровно как свой — два одинаковых варианта и два
    // одинаковых key у кнопок PartyTrivia
    const twin: TriviaCatalogGame[] = CATALOG.map((g, i) => ({
      ...g,
      tags: (i % 2
        ? { 'Dystopian ': 90, Action: 70, RPG: 50 }
        : { Dystopian: 90, Strategy: 70, Indie: 50 }) as Record<string, number>,
    }))
    let seen = 0
    for (let round = 0; round < 20; round++) {
      for (const q of buildTrivia({ seed: `r:twin:${round}`, catalog: twin, party: [] })) {
        if (q.kind !== 'nottag') continue
        seen++
        // Как вариант увидит человек: подпись подписи — та же подпись, а
        // ключ, просочившийся мимо перевода, — его подпись
        const labels = q.options.map((o) => tagRu(o.label))
        expect(new Set(labels).size, labels.join(', ')).toBe(labels.length)
        const target = twin.find((g) => q.prompt.includes(`«${g.name}»`))!
        const own = new Set(Object.keys(target.tags).map(tagRu))
        expect(own.has(labels[q.answer]), `${q.prompt}: ${labels[q.answer]}`).toBe(false)
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  test('hours: побеждает тот, кто наиграл больше', () => {
    const qs = buildTrivia({ seed: 'r:1:0', catalog: CATALOG, party: PARTY })
    for (const q of qs.filter((x) => x.kind === 'hours')) {
      expect(q.options[q.answer].label).toBe('Аня') // 300ч в Dota 2 против 20ч
    }
  })

  /**
   * Пати, где у двоих одна общая игра и наиграно ровно столько минут.
   * Минутами, а не округлёнными часами (бывший hours()): ошибка жила
   * в округлении до часа.
   */
  function duo(a: number, b: number): TriviaParty[] {
    const one = (min: number): LibraryGame[] => [
      { appid: 570, name: 'Dota 2', playtimeForever: min, playtime2Weeks: 0 },
    ]
    return [
      { steamid: 'd', name: 'Дима', library: one(a) },
      { steamid: 's', name: 'Саша', library: one(b) },
    ]
  }

  /** Вопросы «у кого больше часов» за двадцать сидов */
  function hoursQs(party: TriviaParty[]) {
    return Array.from({ length: 20 }, (_, round) =>
      buildTrivia({ seed: `r:h:${round}`, catalog: CATALOG, party }).filter((q) => q.kind === 'hours'),
    ).flat()
  }

  test('hours: меньше часа у обоих — не вопрос, а монетка', () => {
    // Часы округлялись до сравнения: 25 и 10 минут — «0 ч» и «0 ч», 0 ≥ 0 × 1.3,
    // и «правильным» становился первый по порядку пати — в том числе тот, у
    // кого минут меньше; разгадка гласила «Дима — 0 ч, Саша — 0 ч»
    expect(hoursQs(duo(25, 10))).toEqual([])
    expect(hoursQs(duo(10, 25))).toEqual([])
    expect(hoursQs(duo(20, 20))).toEqual([])
    // От получаса у лидера округление давало «1 ч» против «0 ч» и порог
    // проходился: держит такую пару уже не он, а HOURS_MIN
    expect(hoursQs(duo(45, 20))).toEqual([])
    expect(hoursQs(duo(20, 59))).toEqual([])
  })

  test('hours: разрыв в 30% меряется минутами, а не округлёнными часами', () => {
    // 150 и 135 минут округлялись в 3 и 2 часа и проходили порог, хотя на
    // деле разница — 11%
    expect(hoursQs(duo(150, 135))).toEqual([])
  })

  test('hours: разгадка — минутами там, где часов меньше десяти', () => {
    const qs = hoursQs(duo(60, 89))
    expect(qs.length).toBeGreaterThan(0)
    for (const q of qs) {
      expect(q.options[q.answer].label).toBe('Саша')
      // «1 ч, 1 ч» после округления — снова ничья на экране
      expect(q.reveal).toBe('Саша — 1 ч 29 мин, Дима — 1 ч')
    }
  })

  test('hours: от десяти часов разгадка — целыми часами, ниже — с минутами', () => {
    // 10 ч 15 мин у лидера — «10 ч»: на таком разрыве минуты лишние, а
    // полтора часа у второго — «1 ч 30 мин», не округлённые «2 ч»
    const qs = hoursQs(duo(90, 615))
    expect(qs.length).toBeGreaterThan(0)
    for (const q of qs) {
      expect(q.options[q.answer].label).toBe('Саша')
      expect(q.reveal).toBe('Саша — 10 ч, Дима — 1 ч 30 мин')
    }
  })

  // Время скрыто в Steam (lib/playtime.ts): нули у всех игр — не топ и не
  // «меньше часов», а галочка. Про такого участника спрашивать не о чем
  test('участник со скрытым временем не загадывается ни топом, ни часами', () => {
    const hidden: TriviaParty = { steamid: 'c', name: 'Вика', library: hiddenLibrary() }
    for (let round = 0; round < 20; round++) {
      const qs = buildTrivia({ seed: `r:2:${round}`, catalog: CATALOG, party: [PARTY[0], hidden] })
      for (const q of qs.filter((x) => x.kind === 'toptrio' || x.kind === 'hours')) {
        expect(q.options[q.answer].label, q.prompt).not.toBe('Вика')
      }
      // у второго — ни одной наигранной игры: «у кого больше часов» не с кем сравнить
      expect(qs.some((q) => q.kind === 'hours')).toBe(false)
    }
  })

  test('SteamID64 участников в ответ не попадает ни в одном поле', () => {
    // /api/room/[id]/trivia отдаёт вопросы как есть каждому в комнате, а в
    // открытую комнату подсаживаются незнакомые с доски «Пати». id вопроса
    // «чей это топ-3» был `toptrio:<steamid>` — рядом с ником в вариантах
    const real: TriviaParty[] = [
      { ...PARTY[0], steamid: '76561198000000001' },
      { ...PARTY[1], steamid: '76561198000000002' },
    ]
    let toptrio = 0
    for (let round = 0; round < 10; round++) {
      const qs = buildTrivia({ seed: `ABC123:${real[0].steamid}:${round}`, catalog: CATALOG, party: real })
      toptrio += qs.filter((q) => q.kind === 'toptrio').length
      const json = JSON.stringify(qs)
      expect(json).not.toMatch(/\d{17}/)
      for (const p of real) expect(json).not.toContain(p.steamid)
    }
    // иначе проверка выше прошла бы вхолостую
    expect(toptrio).toBeGreaterThan(0)
  })

  test('выборка идёт по предикату частичного индекса и без RANDOM()', () => {
    // Без ALIVE_POOL SQLite не возьмёт idx_games_ccu, и выборка для викторины
    // превратится в полный скан каталога. Сам план сторожит
    // lib/queryplan.test.ts, здесь — что строка не выписана заново
    const src = readFileSync('lib/trivia.ts', 'utf8')
    // Комментарии выкидываем: в них про запрет RANDOM() как раз и написано
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).toContain('WHERE ${ALIVE_POOL} AND ccu > ?')
    expect(code).not.toMatch(/ORDER BY\s+RANDOM\(\)/i)
  })
})

describe('loadTriviaCatalog', () => {
  test('дважды закодированные теги приезжают объектом, а не строкой', async () => {
    // «Какого тега нет у игры» берёт варианты из Object.keys(tags) — у строки
    // это номера символов, — а проверка `t in target.tags` по строке бросает
    // TypeError, и викторина всей комнаты отвечала 500
    const db = await createDb(':memory:')
    const tags = { MOBA: 1019, Strategy: 723 }
    await upsertGameMeta(
      db,
      { appid: 570, name: 'Dota 2', tags, genres: [], categories: [1], ccu: 600_000 },
      1_700_000_000,
    )
    await db.execute({
      sql: 'UPDATE games SET tags_json = ? WHERE appid = 570',
      args: [JSON.stringify(JSON.stringify(tags))],
    })
    const [dota] = await loadTriviaCatalog(db, 'seed')
    expect(dota.tags).toEqual(tags)
  })
})

/** Кириллица в строке — на английской странице это непереведённый кусок */
const CYRILLIC = /[А-Яа-яЁё]/

/**
 * Викторина по-английски. Каталог и пати — латиницей, как придут на /en
 * (имена — метки ростера, их переводит memberLabel у вызывающего): тогда во
 * всём, что увидит человек, не должно остаться ни одной русской буквы.
 */
describe('buildTrivia по-английски', () => {
  // Два набора тегов через одну игру: иначе «какого тега нет» не из чего собрать
  const CATALOG_EN: TriviaCatalogGame[] = Array.from({ length: 24 }, (_, i) =>
    game(100 + i, `Game ${i}`, {
      ccu: (i + 1) * 5000,
      tags: i % 2 ? { Action: 90, 'Co-op': 70, RPG: 50 } : { Strategy: 90, Indie: 70, Puzzle: 50 },
    }),
  )
  const PARTY_EN: TriviaParty[] = [
    { steamid: 'a', name: 'Anna', library: lib([1, 'Dota 2', 300], [2, 'Portal 2', 10], [3, 'Factorio', 90]) },
    { steamid: 'b', name: 'Boris', library: lib([1, 'Dota 2', 20], [4, 'Terraria', 200], [5, 'Valheim', 50]) },
  ]
  const shown = (q: TriviaQuestion) => [q.prompt, q.reveal ?? '', ...q.options.map((o) => o.label)]

  test('без языка — русский до буквы', () => {
    const args = { seed: 'r:1:0', catalog: CATALOG, party: PARTY }
    expect(buildTrivia(args)).toEqual(buildTrivia({ ...args, locale: 'ru' }))
  })

  test('сид от языка не зависит: те же вопросы, другие слова', () => {
    const ru = buildTrivia({ seed: 'r:1:0', catalog: CATALOG_EN, party: PARTY_EN })
    const en = buildTrivia({ seed: 'r:1:0', catalog: CATALOG_EN, party: PARTY_EN, locale: 'en' })
    expect(en.map((q) => q.id)).toEqual(ru.map((q) => q.id))
    expect(en.map((q) => q.answer)).toEqual(ru.map((q) => q.answer))
  })

  test('вопросы каждого вида — английскими фразами', () => {
    const kinds = new Set<string>()
    for (let round = 0; round < 10; round++) {
      for (const q of buildTrivia({ seed: `r:en:${round}`, catalog: CATALOG_EN, party: PARTY_EN, locale: 'en' })) {
        kinds.add(q.kind)
        for (const s of shown(q)) expect(s, `${q.kind}: ${s}`).not.toMatch(CYRILLIC)
        if (q.kind === 'cover') expect(q.prompt).toBe('Which game is this?')
        if (q.kind === 'ccu') {
          expect(q.prompt).toBe("Where's the bigger crowd right now?")
          // онлайн — с английскими разрядами: «Game 3 — 20,000»
          expect(q.reveal).toMatch(/^Game \d+ — \d{1,3}(,\d{3})*, Game \d+ — \d{1,3}(,\d{3})*$/)
        }
        if (q.kind === 'nottag') expect(q.prompt).toMatch(/^Which tag doesn't “Game \d+” have\?$/)
        if (q.kind === 'hours') expect(q.prompt).toBe('Who has more hours in “Dota 2”?')
        if (q.kind === 'toptrio') expect(q.prompt).toMatch(/^Whose top 3 is this: [^,]+, [^,]+, [^,]+\?$/)
      }
    }
    expect([...kinds].sort()).toEqual(['ccu', 'cover', 'hours', 'nottag', 'toptrio'])
  })

  /** Пати на двоих с одной общей игрой — латиницей */
  function duoEn(a: number, b: number): TriviaParty[] {
    const one = (min: number): LibraryGame[] => [{ appid: 570, name: 'Dota 2', playtimeForever: min, playtime2Weeks: 0 }]
    return [
      { steamid: 'd', name: 'Dima', library: one(a) },
      { steamid: 's', name: 'Sasha', library: one(b) },
    ]
  }
  const hoursEn = (party: TriviaParty[]) =>
    Array.from({ length: 20 }, (_, round) =>
      buildTrivia({ seed: `r:h:${round}`, catalog: CATALOG_EN, party, locale: 'en' }).filter((q) => q.kind === 'hours'),
    ).flat()

  test('hours: разгадка — минутами до десяти часов, дальше — целыми часами с разрядами', () => {
    const minutes = hoursEn(duoEn(60, 89))
    expect(minutes.length).toBeGreaterThan(0)
    for (const q of minutes) expect(q.reveal).toBe('Sasha — 1 h 29 min, Dima — 1 h')

    const ten = hoursEn(duoEn(90, 615))
    expect(ten.length).toBeGreaterThan(0)
    for (const q of ten) expect(q.reveal).toBe('Sasha — 10 h, Dima — 1 h 30 min')

    const many = hoursEn(duoEn(40, 2434 * 60))
    expect(many.length).toBeGreaterThan(0)
    for (const q of many) expect(q.reveal).toBe('Sasha — 2,434 h, Dima — 40 min')
  })

  test('nottag: варианты — сами теги Steam, и два ключа с одной подписью — один вариант', () => {
    const twin: TriviaCatalogGame[] = CATALOG_EN.map((g, i) => ({
      ...g,
      tags: (i % 2
        ? { 'Dystopian ': 90, Action: 70, RPG: 50 }
        : { Dystopian: 90, Strategy: 70, Indie: 50 }) as Record<string, number>,
    }))
    let seen = 0
    for (let round = 0; round < 20; round++) {
      for (const q of buildTrivia({ seed: `r:twin:${round}`, catalog: twin, party: [], locale: 'en' })) {
        if (q.kind !== 'nottag') continue
        seen++
        const labels = q.options.map((o) => o.label)
        expect(new Set(labels).size, labels.join(', ')).toBe(labels.length)
        // подпись без пробела по краям, как её покажет человек
        expect(labels.every((l) => l === l.trim()), labels.join('|')).toBe(true)
        const target = twin.find((g) => q.prompt.includes(`“${g.name}”`))!
        const own = new Set(Object.keys(target.tags).map((t) => t.trim()))
        q.options.forEach((o, i) => expect(own.has(o.label), `${q.prompt}: ${o.label}`).toBe(i !== q.answer))
      }
    }
    expect(seen).toBeGreaterThan(0)
  })
})
