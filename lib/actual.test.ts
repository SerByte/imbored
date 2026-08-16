import { describe, expect, test } from 'vitest'
import { filterActual } from './actual'
import type { GameMeta } from './types'

function meta(appid: number, name: string, over: Partial<GameMeta> = {}): GameMeta {
  return {
    appid,
    name,
    tags: {},
    genres: [],
    categories: [1],
    developer: 'Valve',
    publisher: 'Valve',
    ...over,
  }
}

/** Настоящий срез библиотеки пользователя, из-за которого всё и началось */
const LIBRARY = new Map<number, GameMeta>([
  [320, meta(320, 'Half-Life 2: Deathmatch', { ccu: 99 })],
  [80, meta(80, 'Counter-Strike: Condition Zero', { categories: [2, 1], ccu: 348 })],
  [10, meta(10, 'Counter-Strike', { ccu: 7739 })],
  [730, meta(730, 'Counter-Strike 2', { categories: [1, 27], ccu: 913_631 })],
  [548430, meta(548430, 'Deep Rock Galactic', { categories: [2, 1, 9, 38], ccu: 4625 })],
])

const ids = (list: Array<{ appid: number }>) => list.map((c) => c.appid)
const all = [...LIBRARY.keys()].map((appid) => ({ appid }))

describe('filterActual', () => {
  test('выкидывает мёртвый мультиплеер из библиотеки', () => {
    // «Игра дня» предлагала HL2:DM с 99 игроками — фильтр к своим играм
    // не применялся вообще
    expect(ids(filterActual(all, LIBRARY, 'solo'))).not.toContain(320)
  })

  test('вытесняет устаревшие версии внутри серии', () => {
    // Condition Zero и CS 1.6 живут в библиотеке рядом с CS2
    const kept = ids(filterActual(all, LIBRARY, 'party'))
    expect(kept).toContain(730)
    expect(kept).not.toContain(80)
    expect(kept).not.toContain(10)
  })

  test('одиночная игра переживает и фильтр, и серии', () => {
    expect(ids(filterActual(all, LIBRARY, 'solo'))).toContain(548430)
  })

  test('в одиночном контексте игра с одиночным режимом остаётся', () => {
    // против ботов в Condition Zero сыграть можно — вытесняет её только серия,
    // поэтому проверяем на библиотеке без CS2
    const noCs2 = new Map(LIBRARY)
    noCs2.delete(730)
    noCs2.delete(10)
    expect(ids(filterActual([{ appid: 80 }], noCs2, 'solo'))).toEqual([80])
  })

  test('устаревшая версия не выпадает игрой дня и в одиночном контексте', () => {
    // Condition Zero выпала в «Игру дня» при живой CS2 в той же библиотеке:
    // одиночный режим уводил её мимо обеих проверок актуальности
    expect(ids(filterActual(all, LIBRARY, 'solo'))).not.toContain(80)
  })

  test('офлайн-вердикт работает и без преемника в библиотеке', () => {
    // CS2 бесплатна, но «бесплатная» не значит «есть в аккаунте». Индекс серий
    // строится по тому, что лежит в библиотеке, поэтому без каталожного
    // вердикта Condition Zero возвращалась тем, кто CS2 не ставил
    const noCs2 = new Map(LIBRARY)
    noCs2.delete(730)
    noCs2.delete(10)
    noCs2.set(80, meta(80, 'Counter-Strike: Condition Zero', {
      categories: [2, 1],
      ccu: 348,
      supersededBy: 730,
      signalsAt: 1_700_000_000,
    }))
    const kept = ids(filterActual([{ appid: 80 }, { appid: 548430 }], noCs2, 'solo'))
    expect(kept).toEqual([548430])
  })

  test('если ничего не осталось — возвращает исходный список', () => {
    // пустой экран хуже неудачной рекомендации
    const onlyDead = [{ appid: 320 }]
    expect(filterActual(onlyDead, LIBRARY, 'solo')).toEqual(onlyDead)
  })

  test('игры без метаданных не выбрасываются', () => {
    expect(ids(filterActual([{ appid: 999_999 }], LIBRARY, 'solo'))).toEqual([999_999])
  })

  test('порядок сохраняется — ранжирование уже сделано', () => {
    const kept = ids(filterActual([{ appid: 548430 }, { appid: 730 }], LIBRARY, 'solo'))
    expect(kept).toEqual([548430, 730])
  })

  test('два издания одной игры — одна карточка', () => {
    // Вытеснение серий сюда не дотягивается: обе Hellblade одиночные, а
    // buildSeriesIndex пропускает всё немультиплеерное
    const withEditions = new Map(LIBRARY)
    withEditions.set(414340, meta(414340, "Hellblade: Senua's Sacrifice", { categories: [2] }))
    withEditions.set(
      719950,
      meta(719950, "Hellblade: Senua's Sacrifice VR Edition", { categories: [2] }),
    )
    const kept = ids(
      filterActual([{ appid: 414340 }, { appid: 719950 }, { appid: 548430 }], withEditions, 'solo'),
    )
    expect(kept).toEqual([414340, 548430])
  })

  test('внутри группы побеждает первый: порядок и есть ранжирование', () => {
    const withEditions = new Map(LIBRARY)
    withEditions.set(414340, meta(414340, "Hellblade: Senua's Sacrifice", { categories: [2] }))
    withEditions.set(
      719950,
      meta(719950, "Hellblade: Senua's Sacrifice VR Edition", { categories: [2] }),
    )
    expect(ids(filterActual([{ appid: 719950 }, { appid: 414340 }], withEditions, 'solo'))).toEqual([
      719950,
    ])
  })

  /*
   * Ловушка порядка: почему полку нельзя фильтровать после обрезки.
   *
   * Колода приходит в порядке buildGroupDeck — сначала всё, что есть у обоих, и
   * только потом каталог. У пары с валвовским бандлом голова колоды мертва
   * целиком, поэтому на трёх картах фильтру нечего оставить: сработает
   * страховка «фильтр, выкинувший всё, — не фильтр», и на полку уедет мёртвое.
   * Собирать надо с запасом и резать ПОСЛЕ.
   */
  test('обрезанная колода не оставляет фильтру выбора', () => {
    const deck = [{ appid: 80 }, { appid: 10 }, { appid: 320 }]
    // 80 и 10 вытеснены CS2, 320 мёртв по онлайну — и по страховке
    // возвращается ровно он, вместо трёх живых карточек
    expect(ids(filterActual(deck, LIBRARY, 'party'))).toEqual([320])
  })

  test('колода с запасом даёт живую полку', () => {
    const deck = [{ appid: 80 }, { appid: 10 }, { appid: 320 }, { appid: 548430 }, { appid: 730 }]
    expect(ids(filterActual(deck, LIBRARY, 'party'))).toEqual([548430, 730])
  })

  test('кандидат из каталога без издателя не отменяет вытеснение в библиотеке', () => {
    // Регрессия: с выходом каталога в общую выдачу его метаданные попали в тот
    // же расчёт серий. Проекция пула не отдавала издателя — и «третья часть»
    // из каталога забирала роль победителя группы, после чего не проходила
    // sameMaker и НЕ вытесняла старую версию, которую до неё вытесняла CS2.
    // Мёртвый мультиплеер тихо возвращался в выдачу.
    const withCatalog = new Map(LIBRARY)
    withCatalog.set(
      99_999,
      meta(99_999, 'Counter-Strike 3', { ccu: 5, developer: undefined, publisher: undefined }),
    )
    const kept = ids(filterActual([...all, { appid: 99_999 }], withCatalog, 'party'))
    expect(kept).not.toContain(10)
  })

  /*
   * А вот однофамилец С издателем вытеснение отменяет — и это ровно та причина,
   * по которой в filterActual нельзя отдавать весь пул каталога.
   *
   * buildSeriesIndex выбирает победителя группы по номеру версии: «Counter-Strike 3»
   * возглавляет группу, проходит sameMaker (Valve), но её пять человек онлайна
   * не дотягивают до SUPERSEDE_RATIO против 7739 у CS 1.6 — и старая версия
   * остаётся жить. До неё её вытесняла CS2.
   *
   * Предыдущий тест этот случай не ловит: там у однофамильца нет издателя, он
   * не проходит sameMaker, и победителем остаётся CS2. Поэтому вызывающий
   * обязан сузить каталожную половину карты до кандидатов, которые реально
   * попали в колоду.
   */
  test('однофамилец из каталога с тем же издателем отменяет вытеснение', () => {
    const poisoned = new Map(LIBRARY)
    poisoned.set(99_999, meta(99_999, 'Counter-Strike 3', { ccu: 5 }))

    expect(ids(filterActual(all, poisoned, 'party'))).toContain(10)
    expect(ids(filterActual(all, LIBRARY, 'party'))).not.toContain(10)
  })
})
