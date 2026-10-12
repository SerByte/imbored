import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { foldTitle, matchesTitle } from './foldtitle'

/*
 * Случаи поиска по стене /library переехали сюда вместе с функциями из
 * lib/forgotten — смысл у них прежний.
 */
describe('название и запрос в одном виде', () => {
  test('слова запроса ищутся в любом порядке', () => {
    const w3 = 'The Witcher® 3: Wild Hunt'
    expect(matchesTitle(w3, 'witcher 3')).toBe(true)
    expect(matchesTitle(w3, 'hunt witcher')).toBe(true)
    expect(matchesTitle(w3, 'witcher 2')).toBe(false)
  })

  test('регистр, ё и знаки не мешают', () => {
    expect(matchesTitle('Ёлки-палки: ИГРА™', 'елки палки игра')).toBe(true)
    expect(matchesTitle('Counter-Strike 2', 'counterstrike')).toBe(false)
    expect(matchesTitle('Counter-Strike 2', 'counter strike')).toBe(true)
    expect(matchesTitle('Pokémon Legends', 'pokemon')).toBe(true)
    expect(foldTitle('  Half‑Life: Alyx ')).toBe('half life alyx')
  })

  test('пустой запрос — это вся полка', () => {
    expect(matchesTitle('Dota 2', '')).toBe(true)
    expect(matchesTitle('Dota 2', ' : — ')).toBe(true)
  })

  /*
   * NFKD раскладывает ™ на буквы «TM». Строчные делались до разложения, и
   * «BioShock™» сворачивался в «bioshockTM» — точное совпадение с «bioshock»
   * не находилось, и поиск каталога ставил выше «BioShock Infinite».
   */
  test('™ и ℠ — разделитель, а не приклеенные к слову «TM»', () => {
    expect(foldTitle('BioShock™')).toBe('bioshock')
    expect(foldTitle('HELLDIVERS™ 2')).toBe('helldivers 2')
    expect(foldTitle('STAR WARS™ Jedi Knight - Jedi Academy™')).toBe('star wars jedi knight jedi academy')
    expect(foldTitle('Foo℠Bar')).toBe('foo bar')
  })

  test('буквы, которые NFKD достаёт из знаков, — тоже строчные', () => {
    expect(foldTitle('№1 Racing')).toBe('no1 racing')
    expect(foldTitle('Final Fantasy Ⅳ')).toBe('final fantasy iv')
    expect(foldTitle('ＦＵＬＬ ＷＩＤＴＨ')).toBe('full width')
  })

  /*
   * Апостроф стоит ВНУТРИ слова, а не между словами. Разделителем он резал
   * «Baldur's» на «baldur s»: набранное без апострофа «baldurs gate» не
   * находило ни игру в каталоге, ни игру на своей стене /library. Стёртый, он
   * сводит к одному виду все три способа набора: «baldur's», «baldur’s» и
   * «baldurs». ʼ (U+02BC) — особый случай: для \p{L} это буква, и без явного
   * стирания она прилипала к слову.
   */
  test('апостроф — любой — стирается, а не режет слово надвое', () => {
    expect(foldTitle("Baldur's Gate 3")).toBe('baldurs gate 3')
    expect(foldTitle('Sid Meier’s Civilization® VI')).toBe('sid meiers civilization vi')
    expect(foldTitle('Garryʼs Mod')).toBe('garrys mod')
    expect(foldTitle('Don‘t Starve')).toBe('dont starve')
    expect(foldTitle('Don`t Starve')).toBe('dont starve')
    expect(foldTitle('Don´t Starve')).toBe('dont starve')
    expect(matchesTitle("Garry's Mod", 'garrys mod')).toBe(true)
    expect(matchesTitle("Garry's Mod", "garry's")).toBe(true)
    expect(matchesTitle("Baldur's Gate 3", 'baldur’s gate')).toBe(true)
  })

  test('ё и й сворачиваются у запроса и названия одинаково', () => {
    expect(foldTitle('Ёжик')).toBe(foldTitle('ежик'))
    expect(matchesTitle('Йога для котов', 'йога')).toBe(true)
    expect(matchesTitle('Йога для котов', 'иога')).toBe(true)
  })
})

/*
 * Модуль едет в клиентский бандл поиска каталога (components/CatalogSearch).
 * Первый же импорт — и туда приедет всё, до чего он дотянется: так lib/forgotten
 * увёз бы с собой движок подбора.
 */
test('модуль без импортов — его берёт клиентский поиск', () => {
  const src = fs.readFileSync(path.join(__dirname, 'foldtitle.ts'), 'utf8')
  expect(src).not.toMatch(/^\s*import\s/m)
})
