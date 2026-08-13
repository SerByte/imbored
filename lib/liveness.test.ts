import { describe, expect, test } from 'vitest'
import { filterPlayable, judgeLiveness, playMode } from './liveness'
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

  test('коопу хватает куда меньшего онлайна, чем публичным серверам', () => {
    // друзей приводишь своих — нужен живой матчмейкинг, а не толпа
    expect(judgeLiveness({ categories: [1, 9, 38], ccu: 200 }, 'party').alive).toBe(true)
    expect(judgeLiveness({ categories: [1], ccu: 200 }, 'party').alive).toBe(false)
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

  test('если живого не осталось — возвращает всё как было', () => {
    // пустой экран хуже неудачной рекомендации
    const onlyDead = [{ appid: 320 }]
    expect(filterPlayable(onlyDead, metaOf, 'solo')).toEqual(onlyDead)
  })

  test('игра без метаданных не выбрасывается', () => {
    const unknown = [{ appid: 999 }, { appid: 730 }]
    expect(filterPlayable(unknown, metaOf, 'solo').map((c) => c.appid)).toEqual([999, 730])
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
