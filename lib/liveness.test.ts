import { describe, expect, test } from 'vitest'
import { filterPlayable, judgeLiveness, playContextOf, playMode } from './liveness'
import type { GameMeta } from './types'

/**
 * Числа и режимы сняты с живого Steam 13.08.2026. Именно эти игры выпали
 * пользователю как «актуальные», хотя играть в них не с кем.
 */
const HL2DM = { categories: [1], ccu: 99 }
const HLDM_SOURCE = { categories: [1], ccu: 18 }
const EMPIRES = { categories: [1], ccu: 0 }
const CS_SOURCE = { categories: [1, 36, 49], ccu: 2202 }
const CS2 = { categories: [1, 27], ccu: 913_631 }
const TF2 = { categories: [1, 27], ccu: 51_894 }
const CONDITION_ZERO = { categories: [2, 1], ccu: 348 }
const DEEP_ROCK = { categories: [2, 1, 9, 38], ccu: 4625 }

describe('playMode', () => {
  test('только сетевой режим — играется на людных серверах', () => {
    expect(playMode(HL2DM.categories)).toBe('online')
    expect(playMode(TF2.categories)).toBe('online')
    expect(playMode(CS_SOURCE.categories)).toBe('online')
  })

  test('кооп — друзей приводишь своих, толпа не нужна', () => {
    expect(playMode([1, 9, 38])).toBe('coop')
  })

  test('есть одиночный режим — играть можно всегда', () => {
    expect(playMode(CONDITION_ZERO.categories)).toBe('solo-capable')
    expect(playMode(DEEP_ROCK.categories)).toBe('solo-capable')
    expect(playMode([2])).toBe('solo-capable')
    expect(playMode([])).toBe('solo-capable')
  })
})

describe('judgeLiveness: онлайн как сигнал', () => {
  test('сетевая игра с пустыми серверами отсекается', () => {
    // Ровно тот случай: «Игра дня» предложила HL2:DM со 99 игроками на весь мир
    const verdict = judgeLiveness(HL2DM)
    expect(verdict.alive).toBe(false)
    expect(verdict.reason).toBe('dead-multiplayer')
    expect(judgeLiveness(HLDM_SOURCE).alive).toBe(false)
    expect(judgeLiveness(EMPIRES).alive).toBe(false)
  })

  test('живые сетевые игры проходят', () => {
    expect(judgeLiveness(CS2).alive).toBe(true)
    expect(judgeLiveness(TF2).alive).toBe(true)
    expect(judgeLiveness(CS_SOURCE).alive).toBe(true)
  })

  test('онлайн важнее отзывов: по отзывам HL2:DM выглядит живой', () => {
    // 86 отзывов за 30 дней проходили прежний порог, хотя играть не с кем
    expect(judgeLiveness({ ...HL2DM, reviews30d: 86 }).alive).toBe(false)
  })

  test('отзывы работают запасным сигналом, когда онлайн неизвестен', () => {
    expect(judgeLiveness({ categories: [1], reviews30d: 0, reviewsTotal: 4000 }).alive).toBe(false)
    expect(judgeLiveness({ categories: [1], reviews30d: 5000 }).alive).toBe(true)
  })
})

describe('judgeLiveness: контекст соло или компания', () => {
  test('игра с одиночным режимом не гейтится, когда играешь один', () => {
    expect(judgeLiveness(CONDITION_ZERO, 'solo').alive).toBe(true)
    expect(judgeLiveness(DEEP_ROCK, 'solo').alive).toBe(true)
  })

  test('но на вечер с друзьями она уже не годится', () => {
    // 348 игроков — против ботов сойдёт, компанию собрать не выйдет
    const verdict = judgeLiveness(CONDITION_ZERO, 'party')
    expect(verdict.alive).toBe(false)
    expect(verdict.reason).toBe('dead-multiplayer')
  })

  test('живой кооп для компании проходит', () => {
    expect(judgeLiveness(DEEP_ROCK, 'party').alive).toBe(true)
  })

  test('чисто одиночная игра в компанию не годится вовсе', () => {
    const verdict = judgeLiveness({ categories: [2], ccu: 90_000 }, 'party')
    expect(verdict.alive).toBe(false)
    expect(verdict.reason).toBe('solo-only')
  })

  test('кооп не гейтится онлайном вовсе — друзей приводишь своих', () => {
    // The Jackbox Party Pack 4: режимы 1,49,37,9,39, онлайн 15 человек на
    // весь мир. Это диванная игра: садишься с друзьями в одной комнате,
    // телефоны вместо джойстиков. Мировой онлайн к ней отношения не имеет
    expect(judgeLiveness({ categories: [1, 49, 37, 9, 39], ccu: 15 }, 'party').alive).toBe(true)
    expect(judgeLiveness({ categories: [1, 9, 38], ccu: 3 }, 'solo').alive).toBe(true)
    // а публичные серверы без людей — по-прежнему приговор
    expect(judgeLiveness({ categories: [1], ccu: 200 }, 'party').alive).toBe(false)
  })

  /*
   * Тот же довод — и для коопа с одиночной кампанией. playMode ставит
   * одиночный режим первым (он нужен соло-контексту), и игра с [2, 1, 9, 38]
   * в компании падала мимо правила коопа на порог мирового онлайна: Deep Rock
   * с его тысячами проходил, а диванный кооп с сотней игроков на весь мир
   * пропадал из колоды комнаты, где он есть у всех.
   */
  test('кооп с одиночной кампанией в компании тоже не гейтится онлайном', () => {
    expect(judgeLiveness({ ...DEEP_ROCK, ccu: 50 }, 'party').alive).toBe(true)
    // только локальный кооп: Steam онлайна у таких почти не видит
    expect(judgeLiveness({ categories: [2, 24, 39], ccu: 0 }, 'party').alive).toBe(true)
    // одиночная плюс публичные серверы без коопа — порог на месте
    expect(judgeLiveness(CONDITION_ZERO, 'party').reason).toBe('dead-multiplayer')
    expect(judgeLiveness({ categories: [2, 1, 36], ccu: 120 }, 'party').alive).toBe(false)
  })
})

/*
 * «Один — только я и игра» на /play. Режимы и онлайн сняты из каталога
 * продакшна: Never Split the Party выпала гостю, ответившему «Один», героем
 * вечера — «0 играли», а это кооп и PvP на четверых без одиночного режима.
 * Правило коопа «друзей приводишь своих» к человеку, который сам сказал, что
 * друзей сегодня нет, не относится: такому коопу напарник нужен из
 * матчмейкинга, и судить его надо по толпе, как сетевую игру.
 */
const NEVER_SPLIT = { categories: [1, 49, 36, 9, 38, 27], ccu: 6 }
const DOTA2 = { categories: [1, 9], ccu: 896_573 }
const HELLDIVERS2 = { categories: [1, 9, 38], ccu: 96_996 }

describe('judgeLiveness: «один прямо сейчас» (alone)', () => {
  test('кооп без одиночного режима и без толпы — не для того, кто играет один', () => {
    const verdict = judgeLiveness(NEVER_SPLIT, 'alone')
    expect(verdict.alive).toBe(false)
    expect(verdict.reason).toBe('dead-multiplayer')
    // онлайн неизвестен — тот же запасной сигнал по отзывам, что у сетевой игры
    expect(judgeLiveness({ categories: [1, 9, 38], reviews30d: 0, reviewsTotal: 4000 }, 'alone').alive).toBe(
      false,
    )
  })

  test('живой кооп с матчмейкингом проходит: напарника найдёт толпа', () => {
    // Dota 2 у Steam — [1, 9], то есть «кооп»; выкинуть её из одиночной
    // выдачи значило бы потерять «Продолжить «Dota 2»» у того, кто в неё играет
    expect(judgeLiveness(DOTA2, 'alone').alive).toBe(true)
    expect(judgeLiveness(HELLDIVERS2, 'alone').alive).toBe(true)
    expect(judgeLiveness({ categories: [1, 9, 38], ccu: 5000 }, 'alone').alive).toBe(true)
  })

  test('игра с одиночным режимом не гейтится и здесь', () => {
    expect(judgeLiveness(DEEP_ROCK, 'alone').alive).toBe(true)
    expect(judgeLiveness({ ...DEEP_ROCK, ccu: 0 }, 'alone').alive).toBe(true)
    expect(judgeLiveness(CONDITION_ZERO, 'alone').alive).toBe(true)
  })

  test('сигнала нет — живая, как и в остальных контекстах', () => {
    // падение Steam не должно опустошать выдачу
    expect(judgeLiveness({ categories: [1, 9, 38] }, 'alone').alive).toBe(true)
  })

  test('контекст выдачи: «Один» — alone, «С друзьями» — party, колода без настроения — мягкий solo', () => {
    expect(playContextOf({ social: 'solo' })).toBe('alone')
    expect(playContextOf({ social: 'friends' })).toBe('party')
    // «Полистать» — находки на потом, а не «во что сесть сейчас»
    expect(playContextOf({ social: 'solo' }, true)).toBe('solo')
    expect(playContextOf({ social: 'friends' }, true)).toBe('party')
  })

  test('мягкий solo курации и party комнаты этим правилом не задеты', () => {
    // promote-catalog пишет games.alive вердиктом по умолчанию: строже он —
    // и Jackbox-подобный диванный кооп пропал бы из колод пати вместе с ним
    expect(judgeLiveness(NEVER_SPLIT).alive).toBe(true)
    expect(judgeLiveness(NEVER_SPLIT, 'solo').alive).toBe(true)
    expect(judgeLiveness(NEVER_SPLIT, 'party').alive).toBe(true)
    expect(judgeLiveness({ categories: [1, 49, 37, 9, 39], ccu: 15 }, 'party').alive).toBe(true)
  })
})

describe('filterPlayable', () => {
  function meta(appid: number, over: Partial<GameMeta>): GameMeta {
    return { appid, name: `Игра ${appid}`, tags: {}, genres: [], categories: [], ...over }
  }
  const metas = new Map<number, GameMeta>([
    [320, meta(320, HL2DM)],
    [730, meta(730, CS2)],
    [80, meta(80, CONDITION_ZERO)],
  ])
  const metaOf = (id: number) => metas.get(id)
  const candidates = [{ appid: 320 }, { appid: 730 }, { appid: 80 }]

  test('выкидывает мёртвый мультиплеер из своих игр', () => {
    // именно этого не хватало: «Игра дня» брала библиотеку мимо фильтров
    const kept = filterPlayable(candidates, metaOf, 'solo')
    expect(kept.map((c) => c.appid)).toEqual([730, 80])
  })

  test('в компании отсекает и то, во что вместе не сесть', () => {
    const kept = filterPlayable(candidates, metaOf, 'party')
    expect(kept.map((c) => c.appid)).toEqual([730])
  })

  test('один прямо сейчас — отсекает и кооп, где напарника не найти', () => {
    const withCoop = new Map(metas)
    withCoop.set(711810, meta(711810, NEVER_SPLIT))
    withCoop.set(570, meta(570, DOTA2))
    const coop = [{ appid: 711810 }, { appid: 570 }, { appid: 80 }]
    expect(filterPlayable(coop, (id) => withCoop.get(id), 'alone').map((c) => c.appid)).toEqual([570, 80])
    // мягкий solo — прежний: кооп не гейтится
    expect(filterPlayable(coop, (id) => withCoop.get(id), 'solo').map((c) => c.appid)).toEqual([
      711810, 570, 80,
    ])
  })

  test('если живого не осталось — возвращает всё как было', () => {
    // пустой экран хуже неудачной рекомендации
    const onlyDead = [{ appid: 320 }]
    expect(filterPlayable(onlyDead, metaOf, 'solo')).toEqual(onlyDead)
  })

  test('игра без метаданных не выбрасывается', () => {
    const unknown = [{ appid: 999 }, { appid: 730 }]
    expect(filterPlayable(unknown, metaOf, 'solo').map((c) => c.appid)).toEqual([999, 730])
  })

  test('мусорный хвост отсекается по числу отзывов и из библиотеки тоже', () => {
    // Раньше filterPlayable не передавал reviewsTotal, и проверка asset-flip
    // была недостижима из библиотеки — жила только в офлайн-курации каталога
    const withTail = new Map(metas)
    withTail.set(1, meta(1, { categories: [2], reviewsTotal: 11 }))
    const kept = filterPlayable([{ appid: 1 }, { appid: 730 }], (id) => withTail.get(id), 'solo')
    expect(kept.map((c) => c.appid)).toEqual([730])
  })

  test('разгромленная игра из библиотеки тоже отсекается', () => {
    const panned = new Map(metas)
    panned.set(2, meta(2, { categories: [2], reviewsTotal: 900, reviewsPercent: 24 }))
    const kept = filterPlayable([{ appid: 2 }, { appid: 730 }], (id) => panned.get(id), 'solo')
    expect(kept.map((c) => c.appid)).toEqual([730])
  })
})

describe('judgeLiveness: страховки', () => {
  test('нет сигнала — считаем живой', () => {
    // падение Steam не должно опустошать выдачу
    expect(judgeLiveness({ categories: [1] }).alive).toBe(true)
    expect(judgeLiveness({ categories: [1] }, 'party').alive).toBe(true)
  })

  test('мусорный хвост каталога отсекается по числу отзывов', () => {
    expect(judgeLiveness({ categories: [2], reviewsTotal: 11 }).reason).toBe('asset-flip')
  })

  test('разгромленная игра отсекается только на заметной выборке', () => {
    expect(judgeLiveness({ categories: [2], reviewsTotal: 900, reviewsPercent: 24 }).reason).toBe(
      'panned',
    )
    expect(judgeLiveness({ categories: [2], reviewsTotal: 60, reviewsPercent: 24 }).alive).toBe(true)
  })

  test('вердикт всегда объясним', () => {
    expect(judgeLiveness(HL2DM).reason).not.toBeNull()
    expect(judgeLiveness(CS2).reason).toBeNull()
  })
})
