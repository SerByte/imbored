import { describe, expect, test } from 'vitest'
import { collapseEditions, editionKey, isVariantName } from './editions'

const same = (a: string, b: string) => editionKey(a) === editionKey(b)

describe('editionKey', () => {
  test('издание и базовая игра дают один ключ — тот самый баг полки', () => {
    // 414340 и 719950 стояли рядом на полке «Ты забыл, что они у тебя есть»,
    // с одинаковой обложкой
    expect(same('Hellblade: Senua’s Sacrifice', "Hellblade: Senua's Sacrifice VR Edition")).toBe(
      true,
    )
    expect(same("Hellblade: Senua's Sacrifice", "Hellblade: Senua's Sacrifice VR Edition")).toBe(
      true,
    )
  })

  test('все три Skyrim — одна игра', () => {
    const base = 'The Elder Scrolls V: Skyrim'
    expect(editionKey(base)).toBe('the elder scrolls v: skyrim')
    expect(same(base, 'The Elder Scrolls V: Skyrim Special Edition')).toBe(true)
    expect(same(base, 'The Elder Scrolls V: Skyrim VR')).toBe(true)
    expect(same('Fallout 4', 'Fallout 4 VR')).toBe(true)
  })

  test('якорь работает и без слова Edition', () => {
    expect(same('Batman: Arkham City', 'Batman: Arkham City GOTY')).toBe(true)
    expect(same('Metro 2033', 'Metro 2033 Redux')).toBe(true)
    expect(same('BioShock', 'BioShock Remastered')).toBe(true)
    expect(same('Sniper Elite V2', 'Sniper Elite V2 Remastered')).toBe(true)
  })

  test("Director's Cut ловится до того, как апостроф станет пробелом", () => {
    expect(
      same('Deus Ex: Human Revolution', "Deus Ex: Human Revolution - Director's Cut"),
    ).toBe(true)
  })

  test('квалификатор уезжает вместе с якорем', () => {
    expect(same('Divinity: Original Sin', 'Divinity: Original Sin - Enhanced Edition')).toBe(true)
    expect(same('The Witcher 3: Wild Hunt', 'The Witcher 3: Wild Hunt - Game of the Year Edition')).toBe(
      true,
    )
    expect(same('Fallout: New Vegas', 'Fallout: New Vegas Ultimate Edition')).toBe(true)
  })

  test('точка в аббревиатуре выживает', () => {
    expect(editionKey('F.E.A.R. Gold Edition')).toBe('f.e.a.r.')
    expect(same('F.E.A.R.', 'F.E.A.R. Gold Edition')).toBe(true)
  })

  test('номер части ключ не теряет', () => {
    expect(same('Portal', 'Portal 2')).toBe(false)
    expect(same('Left 4 Dead', 'Left 4 Dead 2')).toBe(false)
    expect(same('Civilization V', 'Civilization VI')).toBe(false)
    expect(same('Age of Empires II: Definitive Edition', 'Age of Empires III: Definitive Edition')).toBe(
      false,
    )
  })

  test('год в скобках — не издание, а отдельная запись', () => {
    expect(same('Dead Space', 'Dead Space (2008)')).toBe(false)
    expect(same('FIFA 22', 'FIFA 23')).toBe(false)
  })

  test('подзаголовок сиквела не приводит к основе', () => {
    // parseSeries обеим Hellblade выдал бы основу «hellblade» — здесь так нельзя
    expect(same("Hellblade: Senua's Sacrifice", "Senua's Saga: Hellblade II")).toBe(false)
  })

  test('дополнение — не издание', () => {
    expect(same('The Witcher 3: Wild Hunt', 'The Witcher 3: Wild Hunt - Blood and Wine')).toBe(false)
  })

  test('служебное слово без якоря не срезается', () => {
    // Tomb Raider: Anniversary — самостоятельная игра 2007 года, а не издание
    expect(editionKey('Tomb Raider: Anniversary')).toBe('tomb raider: anniversary')
    expect(editionKey('Hogwarts Legacy')).toBe('hogwarts legacy')
    expect(editionKey('Halo: The Master Chief Collection')).toBe('halo: the master chief collection')
    expect(editionKey('Gold Rush! The Game')).toBe('gold rush the game')
  })

  test('разные подзаголовки одной серии не схлопываются', () => {
    // Запрет на правило «дотягивать срез до предыдущего разделителя»: оно
    // починило бы DOOM 3: BFG Edition и слило бы эту пару в общий «batman»
    expect(
      same('Batman: Arkham Asylum Game of the Year Edition', 'Batman: Arkham City GOTY'),
    ).toBe(false)
  })

  test('маркер в середине названия не трогаем', () => {
    expect(editionKey('Serious Sam VR: The Last Hope')).toBe('serious sam vr: the last hope')
    expect(editionKey('The VR Museum of Fine Art')).toBe('the vr museum of fine art')
    expect(editionKey('Ultimate Chicken Horse')).toBe('ultimate chicken horse')
  })

  test('VR-игра без пары не ломается', () => {
    expect(editionKey('Half-Life: Alyx')).toBe('half-life: alyx')
    expect(editionKey('Job Simulator')).toBe('job simulator')
    expect(editionKey('Beat Saber')).toBe('beat saber')
  })

  test('название целиком из маркеров остаётся собой', () => {
    expect(editionKey('VR')).toBe('vr')
    expect(editionKey('Edition')).toBe('edition')
  })

  test('пустое и мусорное имя не роняет', () => {
    expect(editionKey('')).toBe('')
    expect(editionKey('   ')).toBe('')
    expect(editionKey('App 414340')).toBe('app 414340')
  })
})

describe('isVariantName', () => {
  test('пометка издания видна, базовая игра — чистая', () => {
    expect(isVariantName("Hellblade: Senua's Sacrifice")).toBe(false)
    expect(isVariantName("Hellblade: Senua's Sacrifice VR Edition")).toBe(true)
    expect(isVariantName('Batman: Arkham City GOTY')).toBe(true)
    // «Anniversary» без якоря пометкой не считается
    expect(isVariantName('Tomb Raider: Anniversary')).toBe(false)
  })
})

describe('collapseEditions', () => {
  type Row = { appid: number; name: string }
  const nameOf = (r: Row) => r.name
  const firstWins = () => 1

  test('оставляет одну запись на ключ', () => {
    const rows: Row[] = [
      { appid: 414340, name: "Hellblade: Senua's Sacrifice" },
      { appid: 719950, name: "Hellblade: Senua's Sacrifice VR Edition" },
      { appid: 620, name: 'Portal 2' },
    ]
    expect(collapseEditions(rows, nameOf, firstWins).map((r) => r.appid)).toEqual([414340, 620])
  })

  test('победителя выбирает компаратор, а не порядок', () => {
    const rows: Row[] = [
      { appid: 719950, name: "Hellblade: Senua's Sacrifice VR Edition" },
      { appid: 414340, name: "Hellblade: Senua's Sacrifice" },
    ]
    const canonFirst = (a: Row, b: Row) => Number(isVariantName(a.name)) - Number(isVariantName(b.name))
    expect(collapseEditions(rows, nameOf, canonFirst).map((r) => r.appid)).toEqual([414340])
    expect(collapseEditions(rows, nameOf, firstWins).map((r) => r.appid)).toEqual([719950])
  })

  test('позиция группы — по первому вхождению ключа', () => {
    // Контракт filterActual: вход уже отранжирован, схлопывание порядок не двигает
    const rows: Row[] = [
      { appid: 620, name: 'Portal 2' },
      { appid: 719950, name: "Hellblade: Senua's Sacrifice VR Edition" },
      { appid: 730, name: 'Counter-Strike 2' },
      { appid: 414340, name: "Hellblade: Senua's Sacrifice" },
    ]
    const canonFirst = (a: Row, b: Row) => Number(isVariantName(a.name)) - Number(isVariantName(b.name))
    expect(collapseEditions(rows, nameOf, canonFirst).map((r) => r.appid)).toEqual([620, 414340, 730])
  })

  test('записи без имени не схлопываются друг с другом', () => {
    const rows: Row[] = [
      { appid: 1, name: '' },
      { appid: 2, name: '' },
    ]
    expect(collapseEditions(rows, nameOf, firstWins).map((r) => r.appid)).toEqual([1, 2])
  })

  test('пустой вход не роняет', () => {
    expect(collapseEditions([] as Row[], nameOf, firstWins)).toEqual([])
  })
})
