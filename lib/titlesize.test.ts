import { describe, expect, test } from 'vitest'
import { heroTitleClass, LONG_TITLE_CHARS, LONG_WORD_EM, longestWordEm } from './titlesize'

/**
 * Кегль h1 героя по длине названия (lib/titlesize). Порог выведен из замера
 * строк настоящего h1 на всех именах каталога — см. докблок там же; здесь его
 * граница и то, что обе ветки остаются ступенями шкалы, а не своими кеглями.
 * Подключение к страницам проверяют их собственные тесты:
 * app/game/[appid]/page.test.ts и app/pick/[id]/page.test.ts.
 */

const size = (name: string) => heroTitleClass(name).match(/\btext-display-(\w+)\b/)?.[1]

/** Имя из коротких слов ровно в n знаков — чтобы мерить порог длины, а не слова */
const shortWords = (n: number) => 'Hades '.repeat(Math.ceil(n / 6)).slice(0, n)

describe('кегль героя по длине названия', () => {
  test('обычное имя — кегль героя display-lg', () => {
    expect(size('Counter-Strike 2')).toBe('lg')
    // 47 знаков: при 1440 четыре строки display-lg — кнопки ещё на первом экране
    expect(size(shortWords(LONG_TITLE_CHARS - 1))).toBe('lg')
  })

  test('с порога — титул экрана display-md: пятая строка увела бы кнопки за край', () => {
    expect(size(shortWords(LONG_TITLE_CHARS))).toBe('md')
    // Имена с прода, ради которых правка: 8 и 6 строк при 1440×900
    expect(
      size(
        'BRAZILIAN DRUG DEALER 3: I OPENED A PORTAL TO HELL IN THE FAVELA TRYING TO REVIVE MIT AIA I NEED TO CLOSE IT',
      ),
    ).toBe('md')
    expect(size('YEAH! YOU WANT "THOSE GAMES," RIGHT? SO HERE YOU GO! NOW, LET\'S SEE YOU CLEAR THEM!')).toBe('md')
  })

  test('порог — там, где замер нашёл первую пятую строку (49 знаков), с запасом', () => {
    expect(LONG_TITLE_CHARS).toBeLessThanOrEqual(49)
    // и не настолько ниже, чтобы мельчить имена, которым хватает трёх-четырёх строк
    expect(LONG_TITLE_CHARS).toBeGreaterThanOrEqual(45)
  })

  test('гарнитура заголовка на месте в обеих ветках', () => {
    expect(heroTitleClass('Hades')).toMatch(/^font-display /)
    expect(heroTitleClass('a'.repeat(100))).toMatch(/^font-display /)
  })
})

/**
 * Замер h1 в Chromium тем же шрифтом (assets/manrope-800.woff — тот же
 * Manrope 800), кеглем и трекингом display-lg на 360: 40 px, колонка 320.
 * Ширина самого длинного неразрывного куска, px. «TROUBLESHOOTER:» при 1440
 * в том же прогоне — 611, ровно колонка героя на проде.
 */
const MEASURED_360: Array<[string, number]> = [
  ['Hades', 115],
  ['Counter-Strike 2', 166],
  ["Sid Meier's Civilization®: Beyond Earth™", 239],
  ['9-nine-:Episode 1', 251],
  ['Thronebreaker: The Witcher Tales', 280],
  ['Microcivilization', 297],
  ['NieR:Automata™', 307],
  ['Nebuchadnezzar', 307],
  ['FreestyleFootball R', 314],
  ['PUBG: BATTLEGROUNDS', 322],
  ['Run!ZombieFood!', 327],
  ['cyberpunkdreams', 328],
  ['UBERMOSH:BLACK', 345],
  ['SurroundedByBoys', 349],
  ['PARANORMASIGHT: The Seven Mysteries of Honjo', 358],
  ['TROUBLESHOOTER: Abandoned Children', 359],
  ['UBERMOSH:WRAITH', 372],
]
const COLUMN_360_EM = 320 / 40

describe('одно длинное слово — ступень ниже при любой длине имени', () => {
  test('каждое имя каталога, чьё слово в display-lg шире колонки, — display-md', () => {
    // Все 11 таких имён короче 48 знаков из прогона 6011: на 1440 рвались
    // посреди слова («TROUBLESHOOTE / R»), на 360 — или рвались, или за край
    for (const name of [
      'TROUBLESHOOTER: Abandoned Children',
      'Gaokao.Love.100Days',
      'SurroundedByBoys',
      'PARANORMASIGHT: The Seven Mysteries of Honjo',
      'UBERMOSH:WRAITH',
      'UBERMOSH:BLACK',
      'cyberpunkdreams',
      'NieR Replicant™ ver.1.22474487139...',
      'Run!ZombieFood!',
      'PUBG: BATTLEGROUNDS',
      ['Touhou', 'Hero', 'of', 'Ice', 'Fairy'].join(String.fromCharCode(0xa0)),
    ]) {
      expect(size(name), name).toBe('md')
    }
  })

  test('«BATTLEGROUNDS» — 13 знаков, а за колонку: считается ширина, не знаки', () => {
    // 322 px из 320 на 360: правило «слово от 14 знаков» его пропускало
    expect('BATTLEGROUNDS'.length).toBeLessThan(14)
    expect(size('PUBG: BATTLEGROUNDS')).toBe('md')
  })

  test('длинные по знакам, но узкие слова остаются в кегле героя', () => {
    // «S.T.A.L.K.E.R.» и «Civilization®:» — 14 знаков, 237 и 239 px из 320
    for (const name of [
      'Counter-Strike 2',
      'S.T.A.L.K.E.R. 2: Heart of Chornobyl',
      "Sid Meier's Civilization®: Beyond Earth™",
      'Thronebreaker: The Witcher Tales',
      'NieR:Automata™',
      'Nebuchadnezzar',
    ]) {
      expect(size(name), name).toBe('lg')
    }
  })

  test('переносы — там, где их делает браузер', () => {
    // дефис перед буквой — перенос, и дефис остаётся с левым куском
    expect(longestWordEm('Counter-Strike')).toBeCloseTo(longestWordEm('Counter-'))
    // неразрывный пробел — не перенос: «Touhou Hero of Ice Fairy» одним куском
    const nbsp = ['Touhou', 'Hero', 'of', 'Ice', 'Fairy'].join(String.fromCharCode(0xa0))
    expect(longestWordEm(nbsp)).toBeGreaterThan(longestWordEm('Touhou Hero of Ice Fairy') * 2)
    // дефис перед двоеточием — не перенос: браузер рвёт только после «9-»
    expect(longestWordEm('9-nine-:Episode')).toBeCloseTo(longestWordEm('nine-:Episode'))
    // иероглифы и хангыль переносятся у каждого знака — длинным словом не бывают
    expect(size('失业了，我获得了亿万游戏财产！')).toBe('lg')
    expect(longestWordEm('노베나 디아볼로스')).toBe(0)
  })

  test('оценка держится замера и почти не занижает', () => {
    // Занижение опасно — слово уедет за колонку; завышение лишь мельчит
    for (const [name, px] of MEASURED_360) {
      const err = px / 40 - longestWordEm(name)
      expect(err, `${name}: занижено на ${err.toFixed(2)} em`).toBeLessThanOrEqual(0.42)
      expect(-err, `${name}: завышено на ${(-err).toFixed(2)} em`).toBeLessThanOrEqual(0.7)
    }
  })

  test('порог ниже запаса колонки на 360 хотя бы на самое большое занижение', () => {
    const worst = Math.max(...MEASURED_360.map(([name, px]) => px / 40 - longestWordEm(name)))
    expect(LONG_WORD_EM).toBeLessThanOrEqual(COLUMN_360_EM - worst)
    // Всё, что шире колонки, — ступенью ниже, и с запасом в 40 px — в кегле
    // героя. Впритык (297–314) оценка может отдать и туда, и туда:
    // Microcivilization уходит в md, NieR:Automata™ остаётся в lg
    for (const [name, px] of MEASURED_360) {
      if (px > 320) expect(size(name), name).toBe('md')
      if (px <= 280) expect(size(name), name).toBe('lg')
    }
  })

  test('разрыв внутри слова — последний рубеж в обеих ветках', () => {
    // до него доходит только то, что не влезло и ступенью ниже
    expect(heroTitleClass('Hades')).toContain('[overflow-wrap:anywhere]')
    expect(heroTitleClass('TROUBLESHOOTER: Abandoned Children')).toContain('[overflow-wrap:anywhere]')
    expect(heroTitleClass('a'.repeat(100))).toContain('[overflow-wrap:anywhere]')
  })
})
