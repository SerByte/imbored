import { describe, expect, test } from 'vitest'
import {
  comebackPatchPairs,
  comebackSince,
  PATCH_SINCE_LEAD,
  PATCH_SINCE_LEADS,
  patchHasDeadline,
  patchSinceLead,
  wallPatchPairs,
} from './comeback'
import { wallState } from './forgotten'
import { playtimeHidden } from './playtime'
import { hiddenLibrary } from './testing/hiddenlibrary'
import type { LibraryGame } from './types'

const NOW = 1_700_000_000
const DAY = 86_400

/** Заброшенная: много часов, последний запуск давно */
function game(appid: number, lastPlayed: number | undefined, over: Partial<LibraryGame> = {}): LibraryGame {
  return {
    appid,
    name: `Игра ${appid}`,
    playtimeForever: 3000,
    playtime2Weeks: 0,
    ...(lastPlayed !== undefined ? { lastPlayed } : {}),
    ...over,
  }
}

const stateOf = (g: LibraryGame) => wallState(g, undefined, NOW, false)

/*
 * Факт «с тех пор вышло обновление» сравнивает патч с датой последнего
 * запуска. Даты нет — сравнивать не с чем; время скрыто — нули не факт;
 * сессия по ссылке — дата запуска не её дело. Во всех трёх случаях пар нет,
 * а значит, нет ни запроса, ни метки, ни фразы.
 */
describe('comebackSince', () => {
  test('только настоящий момент последнего запуска', () => {
    expect(comebackSince(game(1, NOW - 400 * DAY), false)).toBe(NOW - 400 * DAY)
    expect(comebackSince(game(1, 0), false)).toBeNull()
    expect(comebackSince(game(1, undefined), false)).toBeNull()
    expect(comebackSince(undefined, false)).toBeNull()
    expect(comebackSince(game(1, NOW - 400 * DAY), true)).toBeNull()
  })
})

describe('метка «обновлялась» на стене /library', () => {
  const tiles = [
    game(1, NOW - 400 * DAY),
    // заброшена без даты: classifyLibraryGame зовёт её comeback, но факта нет
    game(2, 0),
    game(3, undefined),
    // играет сейчас — не заброшена
    game(4, NOW - DAY, { playtime2Weeks: 60 }),
  ]

  test('writer, время открыто: только заброшенные с датой запуска', () => {
    expect(stateOf(tiles[1]!)).toBe('comeback')
    expect(stateOf(tiles[2]!)).toBe('comeback')
    expect(wallPatchPairs(tiles, stateOf, { hidden: false, writer: true })).toEqual([[1, NOW - 400 * DAY]])
  })

  test('не writer — пар нет: дата запуска личная', () => {
    expect(wallPatchPairs(tiles, stateOf, { hidden: false, writer: false })).toEqual([])
  })

  test('время скрыто — пар нет, даже если Steam отдал даты', () => {
    const lib = hiddenLibrary().map((g, i) => ({ ...g, lastPlayed: NOW - (400 + i) * DAY }))
    expect(playtimeHidden(lib)).toBe(true)
    const hiddenState = (g: LibraryGame) => wallState(g, undefined, NOW, true)
    expect(wallPatchPairs(lib, hiddenState, { hidden: true, writer: true })).toEqual([])
    // и даже при ошибочном состоянии плитки правило держит сам флаг
    expect(wallPatchPairs(lib, () => 'comeback', { hidden: true, writer: true })).toEqual([])
  })
})

describe('причина выдачи: пары только у заброшенных кандидатов', () => {
  const games = [game(1, NOW - 400 * DAY), game(2, 0), game(3, NOW - 300 * DAY), game(5, NOW - 200 * DAY)]

  test('источник comeback, дата есть, без повторов, в порядке кандидатов', () => {
    const cands = [
      { appid: 3, source: 'comeback' as const },
      { appid: 1, source: 'comeback' as const },
      { appid: 1, source: 'comeback' as const },
      { appid: 2, source: 'comeback' as const },
      { appid: 5, source: 'backlog' as const },
      // каталожная: своей даты нет вовсе
      { appid: 9, source: 'comeback' as const },
    ]
    expect(comebackPatchPairs(cands, games, false)).toEqual([
      [3, NOW - 300 * DAY],
      [1, NOW - 400 * DAY],
    ])
  })

  test('время скрыто — пар нет', () => {
    expect(comebackPatchPairs([{ appid: 1, source: 'comeback' }], games, true)).toEqual([])
  })
})

/*
 * Пересказ со сроком — не повод вернуться, а «успей»: причина его не
 * называет. Узнаём с запасом, но версия и обычные слова сроком не считаются.
 */
describe('patchHasDeadline', () => {
  test('дата, «до …», «успей», «осталось» — срок', () => {
    for (const t of [
      'Сезон идёт до 5 ноября',
      'Ивент до конца октября',
      'Только до 05.11',
      'Режим доступен до 12 числа',
      'Успей пройти событие',
      'Осталось две недели',
      'Ограниченное событие с наградами',
      'Временный режим «Хэллоуин»',
    ]) {
      expect(patchHasDeadline(t), t).toBe(true)
    }
  })

  test('версии, маяки и обычный пересказ — не срок', () => {
    for (const t of [
      'Обновление 1.5 добавило биом',
      'Версия 1.10.2: новый режим',
      'Добавили маяк и новую карту',
      'Переделали бои, появился кооператив',
      'Space Age вышел',
    ]) {
      expect(patchHasDeadline(t), t).toBe(false)
    }
  })
})

/*
 * Английский пересказ (tldr_en) уходит в причину на /en тем же patchSentence,
 * и срок в нём давит так же. Правила обоих языков работают разом.
 */
describe('patchHasDeadline: английский пересказ', () => {
  test('месяц, «until», «ends», «last chance», «hurry», «days left» — срок', () => {
    for (const t of [
      'The Halloween season with a new map runs until November 5',
      'Event ends Nov 5',
      'Available through May 3',
      'Rewards until the 3rd of May',
      'New mode available only until 11/05',
      'Limited-time event with rewards',
      'A time-limited mode is back',
      'Last chance to earn the skin',
      'Hurry: the event is almost over',
      'Two weeks left in the season',
      'A temporary Halloween mode',
    ]) {
      expect(patchHasDeadline(t), t).toBe(true)
    }
  })

  test('версии, «may», «ending», «endless» и обычный пересказ — не срок', () => {
    for (const t of [
      'Update 1.5 adds a new biome',
      'Version 1.10.2: new mode',
      'You may now trade items with friends',
      'Added a new ending and two bosses',
      'Endless mode is here',
      'Reworked combat, co-op is in',
      'Space Age is out',
      'Balance is now 50/50 between factions',
    ]) {
      expect(patchHasDeadline(t), t).toBe(false)
    }
  })
})

/*
 * Вводная факта — и текст, и метка: shareText вырезает предложение, которое
 * ей начинается. Английская — неизменный префикс глоссария.
 */
describe('patchSinceLead', () => {
  test('русская по умолчанию — та же строка, что PATCH_SINCE_LEAD', () => {
    expect(patchSinceLead()).toBe(PATCH_SINCE_LEAD)
    expect(patchSinceLead('ru')).toBe(PATCH_SINCE_LEAD)
  })

  test('английская — по глоссарию, без кириллицы', () => {
    expect(patchSinceLead('en')).toBe('Since you last played, a major update came out')
    expect(patchSinceLead('en')).not.toMatch(/[А-Яа-яЁё]/)
    expect(Object.values(PATCH_SINCE_LEADS).sort()).toEqual([PATCH_SINCE_LEAD, patchSinceLead('en')].sort())
  })
})
