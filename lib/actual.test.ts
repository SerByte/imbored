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
})
