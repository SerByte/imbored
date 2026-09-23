import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  concentrationVerdict,
  eraLead,
  paretoLead,
  portraitFallbackText,
  socialTail,
  unplayedHeading,
  type PortraitVoice,
} from './portraitvoice'

/**
 * Портрет открывает не только владелец, но и друг по ссылке. Голос 'them'
 * обязан обходиться без обращения к читателю — иначе друг снова читает про
 * себя то, что написано про другого.
 */

/** «ты», «твой» и глаголы на «-ешь» — признаки обращения к читателю */
const ADDRESS = /(?<![а-яё])(ты|тебя|тебе|твой|твоя|твоё|твоей|твоих|твою)(?![а-яё])|ешь(?![а-яё])/i

const FACTS = {
  gamesCount: 22,
  totalHours: 4404,
  unplayedCount: 5,
  topGame: { name: 'Factorio', sharePercent: 41 },
}
const ARCH = [
  { label: 'строитель', percent: 46 },
  { label: 'стратег', percent: 30 },
]

describe('голос портрета', () => {
  test('гостю — ни одного обращения на «ты»', () => {
    const lines = [
      paretoLead('them'),
      socialTail('them'),
      eraLead('them'),
      ...[0, 10, 20, 49, 50, 100].map((c) => concentrationVerdict(c, 'them')),
      ...[1, 2, 5, 11, 21, 22, 101].map((n) => unplayedHeading(n, 'them')),
      portraitFallbackText('Аня', ARCH, FACTS, 'them'),
      portraitFallbackText('Аня', ARCH, { ...FACTS, unplayedCount: 1 }, 'them'),
    ]
    for (const line of lines) expect(line, line).not.toMatch(ADDRESS)
  })

  test('владельцу — как было, на «ты»', () => {
    expect(paretoLead('you')).toBe('80% твоей игровой жизни — это')
    expect(concentrationVerdict(60, 'you')).toBe('ты однолюб и не скрываешь этого')
    expect(socialTail('you')).toBe('часов ты провёл не один.')
    expect(portraitFallbackText('Аня', ARCH, FACTS, 'you')).toMatch(/^Аня, ты на 46% строитель/)
  })

  test('ступени концентрации одни и те же в обоих голосах', () => {
    const step = (c: number, v: PortraitVoice) => concentrationVerdict(c, v)
    for (const v of ['you', 'them'] as const) {
      expect(step(50, v)).toBe(step(100, v))
      expect(step(20, v)).toBe(step(49, v))
      expect(step(0, v)).toBe(step(19, v))
      expect(new Set([step(0, v), step(20, v), step(50, v)]).size).toBe(3)
    }
  })

  test('заголовок нераспакованного согласуется с числом', () => {
    expect(unplayedHeading(1, 'them')).toBe('игра так и не запущена')
    expect(unplayedHeading(3, 'them')).toBe('игры так и не запущены')
    expect(unplayedHeading(12, 'them')).toBe('игр так и не запущено')
    expect(unplayedHeading(21, 'you')).toBe('игра ты так и не запустил')
    expect(unplayedHeading(5, 'you')).toBe('игр ты так и не запустил')
  })

  test('запасной текст гостю — о владельце, с теми же числами', () => {
    const text = portraitFallbackText('Аня', ARCH, FACTS, 'them')
    expect(text).toBe(
      'Аня на 46% строитель и на 30% стратег. За плечами 4 404 часа в 22 играх, ' +
        'а 5 игр так и не распаковано. «Factorio» забрала 41% всей игровой жизни — и, ' +
        'кажется, не собирается отдавать.',
    )
  })

  test('без архетипов и без любимца — только факты', () => {
    const text = portraitFallbackText('Аня', [], { ...FACTS, unplayedCount: 0, topGame: null }, 'them')
    expect(text).toBe('За плечами 4 404 часа в 22 играх.')
  })
})

/**
 * Страница обязана брать фразы отсюда: голос выбирается одним признаком
 * (isMine), и строка «на ты», вписанная в разметку мимо модуля, снова
 * заговорит с гостем от лица владельца.
 */
test('страница портрета не держит фраз «на ты» мимо голоса', () => {
  const src = fs
    .readFileSync(path.join(__dirname, '..', 'app', 'portrait', '[steamid]', 'page.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
  expect(src).toContain('@/lib/portraitvoice')
  for (const frozen of [
    'твоей игровой жизни',
    'ты однолюб',
    'ты провёл не один',
    'ты так и не запустил',
    'Медиана твоей',
    'function fallbackText',
  ]) {
    expect(src, `фраза «${frozen}» вписана в страницу мимо lib/portraitvoice`).not.toContain(frozen)
  }
})
