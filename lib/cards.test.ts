import { describe, expect, test } from 'vitest'
import type { CandidateSet } from './candidates'
import {
  aboutLine,
  cardView,
  comebackPatches,
  dailyCardView,
  exploreCardView,
  heroMediaView,
  pickContext,
  shelfCardView,
  storeCardView,
} from './cards'
import { createDb, setNewsDigest, upsertNewsItems } from './db'
import { NEUTRAL_MOOD } from './mood'
import { topTags } from './recommend'
import { HERO_SLIDES } from './shots'
import type { GameMeta, GameSemantics, LibraryGame } from './types'

/**
 * Карточка выдачи — один контракт на /play, «Игру дня» и колоду
 * исследователя. Здесь закреплено то, что раньше жило в двух копиях и
 * расходилось: покупочное (скидка, возврат) только у не купленного, теги —
 * одной мерой, часы — только у своего.
 */

const NOW = 1_780_000_000

function meta(appid: number, over: Partial<GameMeta> = {}): GameMeta {
  return {
    appid,
    name: `Игра ${appid}`,
    tags: { Roguelike: 900, Indie: 700, Strategy: 500, Puzzle: 300, Cozy: 100 },
    genres: [],
    categories: [2],
    priceFinal: 1999,
    priceInitial: 3999,
    discountPercent: 50,
    priceAt: NOW - 60,
    headerImage: `https://cdn.example/${appid}.jpg`,
    ...over,
  }
}

function set(metas: GameMeta[], games: LibraryGame[]): CandidateSet {
  const byId = new Map(metas.map((m) => [m.appid, m]))
  return {
    now: NOW,
    mood: NEUTRAL_MOOD,
    games,
    libMetas: byId,
    metaOf: (id) => byId.get(id),
    feedback: [],
    banned: new Set(),
    cooldown: new Map(),
    profile: {},
    tagWeight: null,
    playtimeHidden: false,
    seed: null,
    genre: null,
    candidates: [],
    actual: [],
    own: [],
    discovery: [],
    heroPool: [],
  }
}

describe('topTags', () => {
  test('по голосам, четыре по умолчанию; без меты — пусто', () => {
    expect(topTags(meta(1))).toEqual(['Roguelike', 'Indie', 'Strategy', 'Puzzle'])
    expect(topTags(meta(1), 2)).toEqual(['Roguelike', 'Indie'])
    expect(topTags(undefined)).toEqual([])
  })
})

describe('cardView', () => {
  const ctx = pickContext(
    set([meta(10), meta(20)], [{ appid: 10, name: 'Игра 10', playtimeForever: 150, playtime2Weeks: 0 }]),
  )

  test('своя — часы есть, скидки и возврата нет: цена у неё в прошлом', () => {
    const card = cardView({ appid: 10, name: 'Игра 10', source: 'backlog', reason: 'потому что' }, ctx)
    expect(card).toMatchObject({ appid: 10, reason: 'потому что', hoursPlayed: 3, discount: null, refund: false })
    expect(card.tags).toEqual(topTags(meta(10)))
    expect(card.edge).toBeNull()
  })

  test('покупка — скидка посчитана, часов нет', () => {
    const card = cardView({ appid: 20, name: 'Игра 20', source: 'new', reason: '' }, ctx)
    expect(card.hoursPlayed).toBeNull()
    expect(card.discount?.percent).toBe(50)
    expect(card.priceFinal).toBe(1999)
  })

  test('без меты — пустые поля, а не падение', () => {
    const card = cardView({ appid: 30, name: 'Игра 30', source: 'new', reason: '' }, ctx)
    expect(card).toMatchObject({ headerImage: null, tags: [], signals: null, discount: null, refund: false })
    expect(card.russian).toBeNull()
  })

  test('русский — готовой фразой с сервера, у своей и у покупки; не знаем — null', () => {
    const c = pickContext(
      set(
        [meta(10, { ruLang: 3 }), meta(20, { ruLang: 0 }), meta(30)],
        [{ appid: 10, name: 'Игра 10', playtimeForever: 150, playtime2Weeks: 0 }],
      ),
    )
    // Своя тоже: «хватит ли сил на вечер» у сюжетной игры без русского — другой ответ
    expect(cardView({ appid: 10, name: 'Игра 10', source: 'backlog', reason: '' }, c).russian).toBe('русская озвучка')
    // На полке покупок «без русского» — довод против покупки, и он честный
    expect(cardView({ appid: 20, name: 'Игра 20', source: 'new', reason: '' }, c).russian).toBe('без русского')
    // До прохода крона или доливки медиа поля нет — и строки нет
    expect(cardView({ appid: 30, name: 'Игра 30', source: 'new', reason: '' }, c).russian).toBeNull()
  })
})

describe('storeCardView и dailyCardView', () => {
  test('плитка полки — всегда покупка: скидка есть', () => {
    const tile = storeCardView({ appid: 20, name: 'Игра 20' }, meta(20), NOW, false)
    expect(tile.discount?.percent).toBe(50)
    expect(Object.keys(tile)).not.toContain('refund')
  })

  test('плитка полки «Игры дня» говорит о русском, как полка покупок /play', () => {
    const c = { appid: 20, name: 'Игра 20' }
    expect(storeCardView(c, meta(20, { ruLang: 0 }), NOW, false).russian).toBe('без русского')
    expect(storeCardView(c, meta(20, { ruLang: 2 }), NOW, false).russian).toBe('русские субтитры')
    // До прохода крона или доливки медиа поля нет — и строки нет, а не «без русского»
    expect(storeCardView(c, meta(20), NOW, false).russian).toBeNull()
    expect(storeCardView(c, undefined, NOW, false).russian).toBeNull()
  })

  test('герой дня из своего — без скидки; из каталога — со скидкой и теми же тегами', () => {
    const day = { reason: 'r', sharedTags: ['Puzzle'], hoursPlayed: null, hideUrgency: false }
    const own = dailyCardView({ appid: 10, name: 'Игра 10', source: 'untouched' }, meta(10), NOW, day)
    const bought = dailyCardView({ appid: 20, name: 'Игра 20', source: 'new' }, meta(20), NOW, day)
    expect(own.discount).toBeNull()
    expect(bought.discount?.percent).toBe(50)
    expect(bought.tags).toEqual(topTags(meta(20)))
    expect(bought.sharedTags).toEqual(['Puzzle'])
  })

  test('трейлер героя дня — из записи игры, без него явный null', () => {
    const day = { reason: 'r', sharedTags: [], hoursPlayed: null, hideUrgency: false }
    const trailer = { mp4: 'https://video.akamai.steamstatic.com/store_trailers/10/m.mp4' }
    const withClip = dailyCardView({ appid: 10, name: 'Игра 10', source: 'untouched' }, { ...meta(10), trailer }, NOW, day)
    const without = dailyCardView({ appid: 10, name: 'Игра 10', source: 'untouched' }, meta(10), NOW, day)
    expect(withClip.trailer).toEqual(trailer)
    expect(without.trailer).toBeNull()
  })

  test('русский у героя дня — та же фраза, что у героя /play', () => {
    const day = { reason: 'r', sharedTags: [], hoursPlayed: null, hideUrgency: false }
    const pick = { appid: 20, name: 'Игра 20', source: 'new' as const }
    expect(dailyCardView(pick, meta(20, { ruLang: 2 }), NOW, day).russian).toBe('русские субтитры')
    expect(dailyCardView(pick, meta(20), NOW, day).russian).toBeNull()
    expect(dailyCardView(pick, undefined, NOW, day).russian).toBeNull()
  })

  test('ориентир героя дня — из записи, у старой записи явный null', () => {
    const day = { reason: 'r', sharedTags: [], hoursPlayed: null, hideUrgency: false }
    const via = { appid: 570, name: 'Dota 2', hours: 2400 }
    const lol = { appid: -106, name: 'League of Legends', source: 'new' as const }
    expect(dailyCardView(lol, undefined, NOW, { ...day, via }).via).toEqual(via)
    expect(dailyCardView(lol, undefined, NOW, day).via).toBeNull()
  })
})

describe('heroMediaView', () => {
  test('кадры обрезаны до HERO_SLIDES, без трейлера — явный null', () => {
    const shots = Array.from({ length: HERO_SLIDES + 3 }, (_, i) => `s${i}.jpg`)
    expect(heroMediaView({ screenshots: shots })).toEqual({
      screenshots: shots.slice(0, HERO_SLIDES),
      trailer: null,
    })
    expect(heroMediaView(undefined)).toEqual({ screenshots: [], trailer: null })
  })
})

describe('aboutLine', () => {
  const ru = 'Взберись на гору с друзьями и не сорвись.'
  const en = 'Climb a mountain with your friends.'
  test('только у игры из каталога и только по-русски', () => {
    expect(aboutLine('new', { ...meta(20), shortDescription: ru })).toBe(ru)
    expect(aboutLine('new', { ...meta(20), shortDescription: en })).toBeNull()
    expect(aboutLine('untouched', { ...meta(20), shortDescription: ru })).toBeNull()
    expect(aboutLine('new', undefined)).toBeNull()
    expect(aboutLine('new', { ...meta(20), shortDescription: '   ' })).toBeNull()
  })
})

/**
 * Регион цены едет к клиенту рядом с ней: ценник в браузере валюту знает
 * только отсюда (STEAM_STORE_CC в бандле нет, см. lib/steamregion).
 */
describe('регион цены в карточках', () => {
  test('у каждой карточки с ценой — её регион; «не продаётся» — отдельным признаком', () => {
    const rub = meta(20, { priceCc: 'ru' })
    const hidden = meta(30, { priceCc: 'ru', storeHidden: true, priceFinal: undefined, discountPercent: undefined })
    const ctx = pickContext(set([rub, hidden], []))
    expect(cardView({ appid: 20, name: 'Игра 20', source: 'new', reason: 'x' }, ctx)).toMatchObject({
      priceFinal: 1999,
      priceCc: 'ru',
      unsold: false,
    })
    expect(storeCardView({ appid: 30, name: 'Игра 30' }, hidden, NOW, false)).toMatchObject({
      priceFinal: null,
      priceCc: 'ru',
      unsold: true,
    })
    const plate = exploreCardView({ appid: 20, name: 'Игра 20', source: 'new', reason: 'x' }, ctx)
    expect(plate).toMatchObject({ priceFinal: 1999, priceCc: 'ru', unsold: false })
  })

  test('без меты — регион null: ценник промолчит, а не нарисует чужую валюту', () => {
    const ctx = pickContext(set([], []))
    expect(cardView({ appid: 99, name: 'Игра 99', source: 'new', reason: 'x' }, ctx)).toMatchObject({
      priceFinal: null,
      priceCc: null,
      unsold: false,
    })
  })

  test('полка «Приглянулось»: у своей игры ни цены, ни региона', () => {
    const own = shelfCardView(meta(20, { priceCc: 'ru' }), { now: NOW, owned: true, hideUrgency: false })
    expect(own).toMatchObject({ priceFinal: null, priceCc: null, unsold: false })
    const buy = shelfCardView(meta(20, { priceCc: 'ru' }), { now: NOW, owned: false, hideUrgency: false })
    expect(buy).toMatchObject({ priceFinal: 1999, priceCc: 'ru' })
  })
})

/**
 * Карточки на /en: «О чём игра» по-английски или никак, строки о русском нет,
 * магазин у игр не из Steam — английская страница. Русская ветка — прежняя:
 * её держат тесты выше, без locale.
 */
describe('карточки по-английски', () => {
  const CYRILLIC = /[А-Яа-яЁё]/
  const RU = 'Головоломка с порталами и лучший кооператив на свете.'
  const EN = 'The highly anticipated sequel to the puzzle game of the year.'
  const latin = (appid: number, over: Partial<GameMeta> = {}) =>
    meta(appid, { name: `Game ${appid}`, shortDescription: RU, shortDescriptionEn: EN, ruLang: 2, ...over })

  test('aboutLine на en — английское описание, русского нет никогда', () => {
    expect(aboutLine('new', latin(20), 'en')).toBe(EN)
    expect(aboutLine('new', meta(20, { shortDescription: RU }), 'en')).toBeNull()
    // своё английское описание без слота — тоже английское
    expect(aboutLine('new', meta(20, { shortDescription: EN }), 'en')).toBe(EN)
    expect(aboutLine('untouched', latin(20), 'en')).toBeNull()
    // русская ветка — как была: английский текст ей не годится
    expect(aboutLine('new', meta(20, { shortDescription: EN }))).toBeNull()
  })

  test('cardView на en: описание английское, строки о русском нет, Cyrillic нет', () => {
    const metas = [latin(20)]
    const ctx = pickContext(set(metas, []), undefined, undefined, 'en')
    expect(ctx.locale).toBe('en')
    const card = cardView({ appid: 20, name: 'Game 20', source: 'new', reason: 'Because you like puzzles.' }, ctx)
    expect(card).toMatchObject({ about: EN, russian: null })
    expect(CYRILLIC.test(JSON.stringify({ about: card.about, russian: card.russian, tags: card.tags }))).toBe(false)
  })

  test('без locale контекст русский — прежние вызывающие получают прежнее', () => {
    const ctx = pickContext(set([latin(20)], []))
    expect(ctx.locale).toBe('ru')
    const card = cardView({ appid: 20, name: 'Game 20', source: 'new', reason: '' }, ctx)
    expect(card).toMatchObject({ about: RU, russian: 'русские субтитры' })
  })

  test('игра не из Steam на en — английская страница магазина и описание из наложения', () => {
    const lol = meta(-106, {
      name: 'League of Legends',
      store: 'riot',
      storeUrl: 'https://www.leagueoflegends.com/ru-ru/',
      shortDescription: 'Та самая MOBA. Бесплатно.',
    })
    const ctx = pickContext(set([lol], []), undefined, undefined, 'en')
    const card = cardView({ appid: -106, name: 'League of Legends', source: 'new', reason: '' }, ctx)
    expect(card).toMatchObject({
      storeUrl: 'https://www.leagueoflegends.com/en-us/',
      about: 'The MOBA everyone knows. Free to play.',
    })
    const plate = exploreCardView({ appid: -106, name: 'League of Legends', source: 'new', reason: '' }, ctx)
    expect(plate.storeUrl).toBe('https://www.leagueoflegends.com/en-us/')
    // русская ветка — та же ссылка, что в записи пула
    const ru = pickContext(set([lol], []))
    expect(cardView({ appid: -106, name: 'League of Legends', source: 'new', reason: '' }, ru).storeUrl).toBe(
      'https://www.leagueoflegends.com/ru-ru/',
    )
  })

  test('плитка магазина и герой дня на en', () => {
    const tile = storeCardView({ appid: 20, name: 'Game 20' }, latin(20), NOW, false, 'en')
    expect(tile.russian).toBeNull()
    const day = { reason: 'Because you like puzzles.', sharedTags: [], hoursPlayed: null, hideUrgency: false }
    const hero = dailyCardView({ appid: 20, name: 'Game 20', source: 'new' }, latin(20), NOW, day, 'en')
    expect(hero).toMatchObject({ about: EN, russian: null, reason: 'Because you like puzzles.' })
    expect(CYRILLIC.test(String(hero.about))).toBe(false)
    // без locale — прежний русский герой
    expect(dailyCardView({ appid: 20, name: 'Game 20', source: 'new' }, latin(20), NOW, day)).toMatchObject({
      about: RU,
      russian: 'русские субтитры',
    })
  })

  /*
   * Поля, которые строят чужие модули: длина сессии (sessionTrait),
   * настроение словами (explainMatch → moodWordsOf) и срок распродажи
   * (discountView → endsLabel). Язык карточки обязан доехать до каждого.
   */
  test('сессия, настроение словами и срок скидки — на языке карточки у всех пяти', () => {
    const semantics: GameSemantics = {
      v: 1,
      axes: { challenge: 20, complexity: 50, pace: 20 },
      session: { bucket: 'medium', minutes: 40, canStopAnytime: false },
      timeToFun: { bucket: null, hours: null },
      confidence: 0.8,
      n: 80,
      basis: 'tags+reviews',
    }
    const g = latin(20, { semantics, discountEndsAt: NOW + 2 * 86_400 })
    const pick = { appid: 20, name: 'Game 20', source: 'new' as const, reason: 'Because you like puzzles.' }
    const day = { reason: pick.reason, sharedTags: [], hoursPlayed: null, hideUrgency: false }
    const shelf = { now: NOW, owned: false, hideUrgency: false }

    const en = pickContext(set([g], []), undefined, undefined, 'en')
    const card = cardView(pick, en)
    expect(card.session).toEqual({ label: 'Session', value: '~40 min' })
    expect(card.signals?.moodWords).toEqual(['calm', 'unhurried', 'an hour at a time'])
    expect(card.discount?.endsLabel).toBe('2 days left')
    const plate = exploreCardView(pick, en)
    expect(plate.session).toEqual({ label: 'Session', value: '~40 min' })
    expect(plate.discount?.endsLabel).toBe('2 days left')
    expect(storeCardView(pick, g, NOW, false, 'en').discount?.endsLabel).toBe('2 days left')
    expect(dailyCardView(pick, g, NOW, day, 'en').discount?.endsLabel).toBe('2 days left')
    expect(shelfCardView(g, { ...shelf, locale: 'en' }).discount?.endsLabel).toBe('2 days left')
    expect(
      CYRILLIC.test(JSON.stringify([card.session, card.signals, card.discount, plate.session, plate.discount])),
    ).toBe(false)

    // Без языка — прежние русские строки
    const ru = pickContext(set([g], []))
    const ruCard = cardView(pick, ru)
    expect(ruCard.session).toEqual({ label: 'Сессия', value: '~40 мин' })
    expect(ruCard.signals?.moodWords).toEqual(['спокойная', 'неторопливая', 'заход на час'])
    expect(ruCard.discount?.endsLabel).toBe('осталось 2 дня')
    expect(exploreCardView(pick, ru).session).toEqual({ label: 'Сессия', value: '~40 мин' })
    expect(storeCardView(pick, g, NOW, false).discount?.endsLabel).toBe('осталось 2 дня')
    expect(dailyCardView(pick, g, NOW, day).discount?.endsLabel).toBe('осталось 2 дня')
    expect(shelfCardView(g, shelf).discount?.endsLabel).toBe('осталось 2 дня')
  })

  test('плитка полки принимает язык и прежнюю форму без него', () => {
    const opts = { now: NOW, owned: false, hideUrgency: false }
    expect(shelfCardView(latin(20), { ...opts, locale: 'en' })).toMatchObject({ appid: 20, owned: false, priceFinal: 1999 })
    expect(shelfCardView(latin(20), opts)).toMatchObject({ appid: 20, owned: false, priceFinal: 1999 })
  })

  test('факт о патче у заброшенной на en — английский пересказ, без него факта нет', async () => {
    const db = await createDb(':memory:')
    const lib: LibraryGame[] = [
      { appid: 730, name: 'Game 730', playtimeForever: 6000, playtime2Weeks: 0, lastPlayed: NOW - 90 * 86_400 },
      { appid: 570, name: 'Game 570', playtimeForever: 6000, playtime2Weeks: 0, lastPlayed: NOW - 90 * 86_400 },
    ]
    const post = (appid: number) => ({
      appid,
      gid: '1',
      title: 'Update',
      url: '',
      publishedAt: NOW - 86_400,
      kind: 'patch' as const,
      scale: 'major' as const,
      blocks: [],
      bodyHash: 'h',
      rank: 1,
    })
    await upsertNewsItems(db, [post(730), post(570)], NOW)
    await setNewsDigest(db, 730, '1', { tldr: 'Новый биом.', scale: 'major', tldrEn: 'A new biome.' }, NOW)
    await setNewsDigest(db, 570, '1', { tldr: 'Новый герой.', scale: 'major' }, NOW)
    const s = set([], lib)
    const cands = [
      { appid: 730, source: 'comeback' as const },
      { appid: 570, source: 'comeback' as const },
    ]
    expect(await comebackPatches(db, s, cands, 'en')).toEqual(new Map([[730, 'A new biome.']]))
    expect(await comebackPatches(db, s, cands)).toEqual(
      new Map([
        [730, 'Новый биом.'],
        [570, 'Новый герой.'],
      ]),
    )
  })
})
