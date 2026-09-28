import { describe, expect, test, vi } from 'vitest'
import { backlogEquivalent, backlogValue } from './stats'
import { hiddenLibrary } from './testing/hiddenlibrary'
import type { GameMeta, LibraryGame } from './types'

const NOW = 1_700_000_000

function game(appid: number, playtimeForever: number): LibraryGame {
  return { appid, name: `g${appid}`, playtimeForever, playtime2Weeks: 0 }
}

/**
 * Прогретая игра с ценой. Теги и категория обязательны: запись без обоих —
 * так выглядят саундтреки после прогрева, и в бэклог она не входит.
 */
function meta(appid: number, priceFinal?: number): GameMeta {
  return {
    appid,
    name: `g${appid}`,
    tags: { Action: 100 },
    genres: [],
    categories: [2],
    ...(priceFinal !== undefined ? { priceFinal } : {}),
  }
}

describe('backlogValue', () => {
  test('суммирует цены несыгранных игр с известной ценой', () => {
    const metas = new Map([
      [1, meta(1, 5999)], // unplayed с ценой
      [2, meta(2)], // unplayed без цены
      [3, meta(3, 1999)], // наигранная — не считается
    ])
    const out = backlogValue(
      [game(1, 10), game(2, 0), game(3, 900)],
      (id) => metas.get(id),
      NOW,
    )
    expect(out).toEqual({ cents: 5999, pricedCount: 1, unplayedCount: 2, cc: 'us' })
  })

  test('деньги считают ВЕСЬ бэклог: и ноль минут, и «открыл и закрыл»', () => {
    // Сторож на разделение полос: подписи в UI разъехались намеренно, а сумма
    // бэклога на /library («Вместе не меньше $X») обязана остаться прежней
    const metas = new Map([
      [1, meta(1, 1000)], // ноль минут
      [2, meta(2, 2000)], // 30 минут — тоже бэклог
    ])
    const out = backlogValue([game(1, 0), game(2, 30)], (id) => metas.get(id), NOW)
    expect(out).toEqual({ cents: 3000, pricedCount: 2, unplayedCount: 2, cc: 'us' })
  })

  test('саундтрек и SDK — не бэклог: ни в счётчике, ни в деньгах', () => {
    const metas = new Map([
      [1, meta(1, 1999)],
      [2, meta(2, 999)], // саундтрек по названию
      [3, { ...meta(3, 4999), tags: {}, categories: [] }], // прогретая пустая запись
    ])
    const out = backlogValue(
      [game(1, 0), { ...game(2, 0), name: 'Foo — Original Soundtrack' }, game(3, 0)],
      (id) => metas.get(id),
      NOW,
    )
    expect(out).toEqual({ cents: 1999, pricedCount: 1, unplayedCount: 1, cc: 'us' })
  })

  test('мёртвая сетевая игра — бэклог: деньги за неё правда потрачены', () => {
    const metas = new Map([[1, { ...meta(1, 1499), signalsAt: NOW, alive: false }]])
    expect(backlogValue([game(1, 0)], (id) => metas.get(id), NOW)).toEqual({
      cents: 1499,
      pricedCount: 1,
      unplayedCount: 1,
      cc: 'us',
    })
  })

  test('пустая библиотека — нули', () => {
    expect(backlogValue([], () => undefined, NOW)).toEqual({
      cents: 0,
      pricedCount: 0,
      unplayedCount: 0,
      cc: 'us',
    })
  })
})

describe('backlogValue при скрытом времени', () => {
  test('20 игр с нулями — бэклога нет: сумма за всё купленное долгом не называется', () => {
    const lib = hiddenLibrary()
    const metas = new Map(lib.map((g) => [g.appid, meta(g.appid, 1999)]))
    expect(backlogValue(lib, (id) => metas.get(id), NOW)).toEqual({
      cents: 0,
      pricedCount: 0,
      unplayedCount: 0,
      cc: 'us',
    })
  })
})

describe('backlogEquivalent', () => {
  const SEED = '76561198000000000'

  test('переводит сумму в осязаемое: число и подпись', () => {
    const out = backlogEquivalent(107_300, 'us', SEED)
    expect(out).not.toBeNull()
    expect(out!.count).toBeGreaterThan(0)
    expect(out!.text).toContain('{n}') // плейсхолдер под моноширинное число
  })

  test('выбор стабилен для одного игрока — иначе шутка скачет на каждом обновлении', () => {
    const a = backlogEquivalent(107_300, 'us', SEED)
    const b = backlogEquivalent(107_300, 'us', SEED)
    expect(a).toEqual(b)
  })

  test('разным игрокам достаются разные единицы', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => `7656119800000${1000 + i}`)
    const units = new Set(seeds.map((s) => backlogEquivalent(107_300, 'us', s)?.text))
    expect(units.size).toBeGreaterThan(1)
  })

  test('счёт всегда в читаемом диапазоне: без «0 Steam Deck» и «21460 жвачек»', () => {
    for (const dollars of [30, 80, 200, 1073, 5000, 40_000]) {
      const out = backlogEquivalent(dollars * 100, 'us', SEED)
      if (!out) continue
      expect(out.count).toBeGreaterThanOrEqual(3)
      expect(out.count).toBeLessThanOrEqual(500)
    }
  })

  test('на мелкой сумме подходящей единицы нет — строка не рендерится', () => {
    expect(backlogEquivalent(500, 'us', SEED)).toBeNull()
    expect(backlogEquivalent(0, 'us', SEED)).toBeNull()
  })

  test('склонение согласовано с числом', () => {
    // подбираем сумму так, чтобы досталась ровно одна конкретная единица
    const out = backlogEquivalent(107_300, 'us', SEED)
    expect(out!.text).not.toMatch(/\{n\}\s*$/) // после числа всегда есть слово
  })
})

describe('валюта суммы бэклога', () => {
  test('сумма помнит свой регион, а цена чужого региона в неё не входит', () => {
    // Мета не из базы может нести цену другого региона — rowToMeta такую не
    // отдал бы, но сумма не имеет права надеяться только на него
    const metas = new Map<number, GameMeta>([
      [1, { ...meta(1, 199_900), priceCc: 'ru' }],
      [2, { ...meta(2, 5999), priceCc: 'us' }],
      [3, meta(3, 1999)], // без региона — LEGACY_PRICE_CC, то есть us
    ])
    const lib = [game(1, 0), game(2, 0), game(3, 0)]
    expect(backlogValue(lib, (id) => metas.get(id), NOW, 'ru')).toEqual({
      cents: 199_900,
      pricedCount: 1,
      unplayedCount: 3,
      cc: 'ru',
    })
    expect(backlogValue(lib, (id) => metas.get(id), NOW, 'us')).toMatchObject({
      cents: 7998,
      pricedCount: 2,
      cc: 'us',
    })
  })

  test('регион по умолчанию — регион цен сервиса', () => {
    vi.stubEnv('STEAM_STORE_CC', 'ru')
    try {
      expect(backlogValue([], () => undefined, NOW).cc).toBe('ru')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  test('в рублях — своя таблица единиц: бургер за 350 ₽, а не за семь «долларов»', () => {
    // 41 500 ₽ — ровно из примера на /library; бургеров там 118, а не 5928
    const seeds = Array.from({ length: 60 }, (_, i) => `7656119800000${2000 + i}`)
    const texts = seeds.map((s) => backlogEquivalent(4_150_000, 'ru', s)).filter((x) => x !== null)
    expect(texts.length).toBe(seeds.length)
    const burger = texts.find((t) => t.text.includes('бургер'))
    expect(burger?.count).toBe(118)
    // Game Pass в рублях не продаётся — шутки про него нет
    expect(texts.some((t) => t.text.includes('Game Pass'))).toBe(false)
    for (const t of texts) {
      expect(t.count).toBeGreaterThanOrEqual(3)
      expect(t.count).toBeLessThanOrEqual(500)
    }
  })

  test('валюта без своей таблицы — без шутки, а не с долларовыми ценами', () => {
    expect(backlogEquivalent(4_150_000, 'kz', '76561198000000000')).toBeNull()
    expect(backlogEquivalent(4_150_000, 'gb', '76561198000000000')).toBeNull()
  })
})
