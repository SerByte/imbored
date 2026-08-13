import { describe, expect, test } from 'vitest'
import { buildSeriesIndex, normalizeTitle, parseSeries, type SeriesMember } from './series'

const valve = { publisher: 'Valve', developer: 'Valve' }

function member(over: Partial<SeriesMember> & { appid: number; name: string }): SeriesMember {
  return { isMultiplayer: true, alive: true, ...valve, ...over }
}

describe('normalizeTitle', () => {
  test('срезает издания и служебные знаки', () => {
    expect(normalizeTitle('The Witcher 3: Wild Hunt - Game of the Year Edition')).toBe(
      normalizeTitle('The Witcher 3: Wild Hunt'),
    )
    expect(normalizeTitle('DOOM® Eternal: Deluxe Edition')).toBe(normalizeTitle('Doom Eternal'))
  })
})

describe('parseSeries', () => {
  test('арабские, римские, десятичные и годовые номера', () => {
    expect(parseSeries('Counter-Strike 2')).toEqual({ base: 'counter-strike', ordinal: 2 })
    expect(parseSeries('Counter-Strike 1.6')).toEqual({ base: 'counter-strike', ordinal: 1.6 })
    expect(parseSeries('Civilization VI')).toEqual({ base: 'civilization', ordinal: 6 })
    expect(parseSeries('FIFA 23')).toEqual({ base: 'fifa', ordinal: 23 })
  })

  test('подзаголовок после двоеточия — не номер версии', () => {
    expect(parseSeries('Counter-Strike: Source')).toEqual({
      base: 'counter-strike',
      ordinal: null,
    })
  })

  test('игра без номера остаётся сама собой', () => {
    expect(parseSeries('Team Fortress 2').base).toBe('team fortress')
    expect(parseSeries('Hades').ordinal).toBeNull()
  })
})

describe('buildSeriesIndex', () => {
  test('CS 1.6 и Source вытесняются CS2 — ровно тот случай, ради которого всё', () => {
    const index = buildSeriesIndex([
      member({ appid: 10, name: 'Counter-Strike', audience: 781 }),
      member({ appid: 240, name: 'Counter-Strike: Source', audience: 745 }),
      member({ appid: 730, name: 'Counter-Strike 2', ordinalHint: 2, audience: 73_725 }),
    ])
    expect(index.get(10)).toBe(730)
    expect(index.get(240)).toBe(730)
    expect(index.has(730)).toBe(false)
  })

  test('игру, в которую можно играть одному, сиквел не отменяет', () => {
    // Настоящие ложные срабатывания с прогона по каталогу: Dark Souls II,
    // GTA IV и Borderlands: The Pre-Sequel — самостоятельные игры со своим
    // сюжетом, а не старые версии. Сетевые режимы у них есть, поэтому
    // предохранителя «только мультиплеер» не хватало
    const index = buildSeriesIndex([
      member({
        appid: 1,
        name: 'DARK SOULS II',
        publisher: 'Bandai',
        soloCapable: true,
        audience: 900,
      }),
      member({
        appid: 2,
        name: 'DARK SOULS III',
        publisher: 'Bandai',
        soloCapable: true,
        audience: 20_000,
      }),
    ])
    expect(index.size).toBe(0)
  })

  test('а игру, которая жила только сообществом, — отменяет', () => {
    // CS 1.6 без одиночного режима: играть в неё можно было только на серверах,
    // и аудитория переехала в CS2 целиком
    const index = buildSeriesIndex([
      member({ appid: 10, name: 'Counter-Strike', audience: 810 }),
      member({ appid: 730, name: 'Counter-Strike 2', audience: 76_233 }),
    ])
    expect(index.get(10)).toBe(730)
  })

  test('одиночные серии не вытесняются никогда', () => {
    // «Почему мне не показывают Portal?» хуже, чем «показали CS 1.6»
    const index = buildSeriesIndex([
      member({ appid: 400, name: 'Portal', isMultiplayer: false, audience: 400 }),
      member({ appid: 620, name: 'Portal 2', isMultiplayer: false, audience: 9000 }),
    ])
    expect(index.size).toBe(0)
  })

  test('игра без преемника не трогается', () => {
    const index = buildSeriesIndex([
      member({ appid: 440, name: 'Team Fortress 2', audience: 12_000 }),
    ])
    expect(index.size).toBe(0)
  })

  test('живой предшественник переживает сиквел, если разрыв меньше порядка', () => {
    // Battlefield 4 с живыми серверами не должен исчезать из-за выхода 2042
    const index = buildSeriesIndex([
      member({ appid: 1, name: 'Battlefield 4', publisher: 'EA', audience: 4000 }),
      member({ appid: 2, name: 'Battlefield 2042', publisher: 'EA', audience: 8000 }),
    ])
    expect(index.size).toBe(0)
  })

  test('вытесняет только доказанный переезд аудитории, а не смерть старой', () => {
    // Так вытеснился The Jackbox Party Pack 4 в пользу шестого: наборы
    // мини-игр разные, аудитория никуда не переезжала (12 против 13),
    // но четвёртый был помечен мёртвым — и одного этого хватало.
    // Мёртвое и так убирает фильтр живости, дублировать его серией незачем.
    const index = buildSeriesIndex([
      member({ appid: 1, name: 'Набор 4', audience: 12, alive: false }),
      member({ appid: 2, name: 'Набор 6', audience: 13 }),
    ])
    expect(index.size).toBe(0)
  })

  test('разные издатели — не одна серия', () => {
    const index = buildSeriesIndex([
      member({ appid: 1, name: 'Sniper Elite 4', publisher: 'Rebellion', audience: 100 }),
      member({ appid: 2, name: 'Sniper Ghost Warrior 3', publisher: 'CI Games', audience: 9000 }),
    ])
    expect(index.size).toBe(0)
  })

  test('маркер в названии вытесняет даже вопреки метрикам', () => {
    // Valve сам переименовал GTA V в Legacy, и по онлайну Legacy ВЫШЕ —
    // метрики тут бесполезны, спасает только маркер
    const index = buildSeriesIndex([
      member({
        appid: 271590,
        name: 'Grand Theft Auto V Legacy',
        publisher: 'Rockstar',
        isMultiplayer: true,
        audience: 9000,
      }),
      member({
        appid: 3240220,
        name: 'Grand Theft Auto V Enhanced',
        publisher: 'Rockstar',
        isMultiplayer: true,
        audience: 5000,
      }),
    ])
    expect(index.get(271590)).toBe(3240220)
  })

  test('слишком частая основа не считается серией', () => {
    // «farm», «zombie» и подобные встречаются у десятков несвязанных игр
    const many: SeriesMember[] = Array.from({ length: 20 }, (_, i) =>
      member({ appid: i + 1, name: `Farm ${i + 1}`, publisher: 'Разные', audience: 100 }),
    )
    expect(buildSeriesIndex(many).size).toBe(0)
  })

  test('ручные исключения перекрывают алгоритм', () => {
    const index = buildSeriesIndex(
      [
        member({ appid: 1, name: 'Ребрендинг 1', audience: 10 }),
        member({ appid: 2, name: 'Ребрендинг 2', audience: 5000 }),
      ],
      { 1: null },
    )
    expect(index.has(1)).toBe(false)
  })

  test('цепочка схлопывается к самой актуальной версии', () => {
    const index = buildSeriesIndex([
      member({ appid: 1, name: 'Quake', audience: 10 }),
      member({ appid: 2, name: 'Quake 2', audience: 200 }),
      member({ appid: 3, name: 'Quake 3', audience: 9000 }),
    ])
    expect(index.get(1)).toBe(3)
    expect(index.get(2)).toBe(3)
  })
})
