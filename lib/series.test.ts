import { describe, expect, test } from 'vitest'
import {
  buildSeriesIndex,
  cleanTitle,
  hasOldMarker,
  normalizeTitle,
  parseSeries,
  type SeriesMember,
} from './series'

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

describe('cleanTitle', () => {
  test('режет знаки и регистр, но не издания', () => {
    // Ровно та причина, по которой editionKey не строится на normalizeTitle:
    // EDITION_RE срезает якорь и оставляет квалификатор висеть в воздухе
    expect(cleanTitle('The Elder Scrolls V: Skyrim™ Special Edition')).toBe(
      'the elder scrolls v: skyrim special edition',
    )
    expect(normalizeTitle('The Elder Scrolls V: Skyrim™ Special Edition')).toBe(
      'the elder scrolls v: skyrim special',
    )
  })
})

describe('hasOldMarker', () => {
  test('пометка версии — в конце, перед двоеточием или в скобках', () => {
    for (const name of [
      'Grand Theft Auto V Legacy',
      'theHunter Classic',
      'Pinball FX Classic',
      'Battlefleet Gothic: Armada (Classic)',
      'Blood Bowl 2: Legendary Edition (Classic)',
      'Serious Sam Classic: The Second Encounter',
    ]) {
      expect(hasOldMarker(name), name).toBe(true)
    }
  })

  test('то же слово внутри названия пометкой не считается', () => {
    // Настоящие ложные срабатывания с прогона по каталогу: поиск слова где
    // угодно уносил «Original Sin» ради постороннего однофамильца из той же
    // студии. Промах был не виден, пока проверка маркера стояла после отсечки
    // по одиночному режиму — до неё просто не доходили
    for (const name of [
      'Divinity: Original Sin 2 - Definitive Edition',
      'Divinity: Original Sin - Enhanced Edition',
      'LEGO® Indiana Jones™: The Original Adventures',
      'LEGO® Batman™: Legacy of the Dark Knight',
      'Grand Theft Auto V Enhanced',
    ]) {
      expect(hasOldMarker(name), name).toBe(false)
    }
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

  test('но одиночный режим не спасает, когда аудитория переехала целиком', () => {
    // Condition Zero: одиночный режим есть, но это матчи с ботами, а не
    // содержание. 348 человек против миллиона в CS2 — разрыв на три порядка,
    // и «самостоятельная игра» превращается в архив
    const index = buildSeriesIndex([
      member({ appid: 80, name: 'Counter-Strike: Condition Zero', soloCapable: true, audience: 348 }),
      member({ appid: 730, name: 'Counter-Strike 2', ordinalHint: 2, audience: 913_631 }),
    ])
    expect(index.get(80)).toBe(730)
  })

  test('одиночную игру с неизвестной аудиторией не вытесняем', () => {
    // Молчание — не доказательство переезда. Без этой проверки условие
    // «преемник ≥ ноль» истинно всегда, и вытеснялись бы пары, где обе части
    // одинаково безлюдны
    const index = buildSeriesIndex([
      member({ appid: 1, name: 'Beat Hazard', soloCapable: true }),
      member({ appid: 2, name: 'Beat Hazard 2', audience: 0 }),
    ])
    expect(index.size).toBe(0)
  })

  test('одиночная игра переживает сиквел, если разрыв меньше двух порядков', () => {
    // Left 4 Dead ко второй части идёт как 1:52 — у неё свои кампании и живые
    // четыре сотни игроков. Порог для одиночных именно поэтому 500, а не 10
    const index = buildSeriesIndex([
      member({ appid: 500, name: 'Left 4 Dead', soloCapable: true, audience: 406 }),
      member({ appid: 550, name: 'Left 4 Dead 2', soloCapable: true, audience: 21_033 }),
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
    // Rockstar сам переименовал GTA V в Legacy, и по онлайну Legacy ВЫШЕ —
    // метрики тут бесполезны, спасает только маркер.
    //
    // soloCapable здесь обязателен: у настоящей GTA V категория «одиночная»
    // есть, и без неё тест проверял ситуацию, которой в проде не бывает.
    // Он был зелёным всё то время, пока «Игра дня» предлагала Legacy человеку
    // с наигранным Enhanced — отсечка по одиночному режиму стояла раньше
    // проверки маркера, и до маркера дело не доходило.
    const index = buildSeriesIndex([
      member({
        appid: 271590,
        name: 'Grand Theft Auto V Legacy',
        publisher: 'Rockstar',
        isMultiplayer: true,
        soloCapable: true,
        audience: 31_753,
      }),
      member({
        appid: 3240220,
        name: 'Grand Theft Auto V Enhanced',
        publisher: 'Rockstar',
        isMultiplayer: true,
        soloCapable: true,
        audience: 37_649,
      }),
    ])
    expect(index.get(271590)).toBe(3240220)
  })

  test('маркер не отменяет защиту одиночных игр без маркера', () => {
    // Соседняя по коду ветка: без «legacy» в названии одиночная часть
    // по-прежнему живёт по порогу, а не по номеру версии
    const index = buildSeriesIndex([
      member({ appid: 1, name: 'DARK SOULS II', publisher: 'Bandai', soloCapable: true, audience: 173 }),
      member({ appid: 2, name: 'DARK SOULS III', publisher: 'Bandai', soloCapable: true, audience: 3867 }),
    ])
    expect(index.size).toBe(0)
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
