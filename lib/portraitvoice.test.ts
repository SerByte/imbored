import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  concentrationVerdict,
  eraLead,
  freshPortraitText,
  paretoLead,
  portraitFallbackText,
  portraitTextFresh,
  PORTRAIT_TEXT_V,
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

describe('запасной текст при скрытом времени', () => {
  const hidden = { gamesCount: 20, totalHours: 0, unplayedCount: 0, topGame: null, playtimeHidden: true }

  test('ни «0 часов», ни нераспакованного — только сколько игр и почему про время молчим', () => {
    for (const voice of ['you', 'them'] as const) {
      const text = portraitFallbackText('Аня', ARCH, hidden, voice)
      expect(text).toContain('В библиотеке 20 игр, а время в них, похоже, скрыто настройками Steam.')
      expect(text).not.toMatch(/0 часов|распаков/)
    }
    expect(portraitFallbackText('Аня', ARCH, hidden, 'them')).not.toMatch(ADDRESS)
  })
})

/**
 * Текст модели записан по снапшоту и живёт, пока тот не сменится. Написанный
 * до того, как промпт узнал о скрытом времени, говорил «0 часов» — и висел бы
 * на расшаренной ссылке у того, кто больше не заходит.
 */
describe('записанный текст портрета', () => {
  const AT = 1_780_000_000

  test('при скрытом времени старый текст не годится, новый — годится', () => {
    expect(portraitTextFresh({ takenAt: AT }, AT, true)).toBe(false)
    expect(portraitTextFresh({ takenAt: AT, v: 1 }, AT, true)).toBe(false)
    expect(portraitTextFresh({ takenAt: AT, v: PORTRAIT_TEXT_V }, AT, true)).toBe(true)
  })

  test('при открытом времени старый текст годится: промпт для него не менялся', () => {
    expect(portraitTextFresh({ takenAt: AT }, AT, false)).toBe(true)
  })

  test('другой снапшот — не годится никакой', () => {
    expect(portraitTextFresh({ takenAt: AT, v: PORTRAIT_TEXT_V }, AT + 60, false)).toBe(false)
    expect(portraitTextFresh({ takenAt: AT, v: PORTRAIT_TEXT_V }, AT + 60, true)).toBe(false)
  })
})

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
    expect(unplayedHeading(1, 'them')).toBe('игра почти не тронута')
    expect(unplayedHeading(3, 'them')).toBe('игры почти не тронуты')
    expect(unplayedHeading(12, 'them')).toBe('игр почти не тронуто')
    // винительный: «21 игру ты почти не трогал», а не «21 игра ты…»
    expect(unplayedHeading(21, 'you')).toBe('игру ты почти не трогал')
    expect(unplayedHeading(3, 'you')).toBe('игры ты почти не трогал')
    expect(unplayedHeading(5, 'you')).toBe('игр ты почти не трогал')
  })

  test('запасной текст гостю — о владельце, с теми же числами', () => {
    const text = portraitFallbackText('Аня', ARCH, FACTS, 'them')
    expect(text).toBe(
      'Аня на 46% строитель и на 30% стратег. За плечами 4 404 часа в 22 играх, ' +
        'а 5 игр почти не тронуто. «Factorio» забрала 41% всей игровой жизни — и, ' +
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
    .readFileSync(path.join(__dirname, '..', 'app', '[lang]', 'portrait', '[steamid]', 'page.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
  expect(src).toContain('@/lib/portraitvoice')
  for (const frozen of [
    'твоей игровой жизни',
    'ты однолюб',
    'ты провёл не один',
    'ты почти не трогал',
    'Медиана твоей',
    'function fallbackText',
  ]) {
    expect(src, `фраза «${frozen}» вписана в страницу мимо lib/portraitvoice`).not.toContain(frozen)
  }
})

/**
 * Английский портрет — те же голоса: 'you' владельцу, 'them' гостю в третьем
 * лице (singular they). Фрагменты встают в разметку страницы в русском
 * порядке, поэтому их начало и конец сверяются дословно.
 */
describe('голос портрета по-английски', () => {
  const CYRILLIC = /[А-Яа-яЁё]/
  /** Обращение к читателю по-английски */
  const ADDRESS_EN = /\b(you|your|yours|you're|you've)\b/i
  const ARCH_EN = [
    { key: 'Automation', label: 'строитель фабрик', percent: 46 },
    { key: 'Strategy', label: 'стратег', percent: 30 },
  ]

  test('фрагменты владельцу — дословно', () => {
    expect(paretoLead('you', 'en')).toBe('80% of your gaming life is')
    expect(concentrationVerdict(60, 'you', 'en')).toBe("you're a one-game loyalist and you don't hide it")
    expect(concentrationVerdict(30, 'you', 'en')).toBe("you have favorites, but you're not locked into one game")
    expect(concentrationVerdict(5, 'you', 'en')).toBe("you're spread evenly across your whole library")
    expect(socialTail('you', 'en')).toBe('of your playtime was with other people.')
    expect(eraLead('you', 'en')).toBe("Your library's median year is")
    expect(unplayedHeading(1, 'you', 'en')).toBe("game you've barely touched")
    expect(unplayedHeading(12, 'you', 'en')).toBe("games you've barely touched")
    expect(unplayedHeading(21, 'you', 'en')).toBe("games you've barely touched")
  })

  test('фрагменты гостю — дословно и без обращения к читателю', () => {
    expect(paretoLead('them', 'en')).toBe('80% of their gaming life is')
    expect(concentrationVerdict(60, 'them', 'en')).toBe("they're a one-game loyalist and don't hide it")
    expect(concentrationVerdict(30, 'them', 'en')).toBe("they have favorites, but aren't locked into one game")
    expect(concentrationVerdict(5, 'them', 'en')).toBe('their time is spread evenly across the whole library')
    expect(socialTail('them', 'en')).toBe('of their playtime was with other people.')
    expect(eraLead('them', 'en')).toBe("The library's median year is")
    expect(unplayedHeading(1, 'them', 'en')).toBe('game barely touched')
    expect(unplayedHeading(0, 'them', 'en')).toBe('games barely touched')
    expect(unplayedHeading(12, 'them', 'en')).toBe('games barely touched')
    const lines = [
      paretoLead('them', 'en'),
      socialTail('them', 'en'),
      eraLead('them', 'en'),
      ...[0, 10, 20, 49, 50, 100].map((c) => concentrationVerdict(c, 'them', 'en')),
      ...[1, 2, 5, 11, 21, 22, 101].map((n) => unplayedHeading(n, 'them', 'en')),
      portraitFallbackText('Anya', ARCH_EN, FACTS, 'them', 'en'),
      portraitFallbackText('Anya', ARCH_EN, { ...FACTS, playtimeHidden: true }, 'them', 'en'),
    ]
    for (const line of lines) expect(line, line).not.toMatch(ADDRESS_EN)
  })

  test('ступени концентрации те же, что по-русски', () => {
    for (const v of ['you', 'them'] as const) {
      const step = (c: number) => concentrationVerdict(c, v, 'en')
      expect(step(50)).toBe(step(100))
      expect(step(20)).toBe(step(49))
      expect(step(0)).toBe(step(19))
      expect(new Set([step(0), step(20), step(50)]).size).toBe(3)
    }
  })

  test('запасной текст владельцу: подписи по ключу, числа с разрядами', () => {
    expect(portraitFallbackText('Anya', ARCH_EN, FACTS, 'you', 'en')).toBe(
      "Anya, you're 46% factory builder and 30% strategist. You've logged 4,404 hours across 22 games " +
        "and barely touched 5 of them. “Factorio” has claimed 41% of your gaming life, and it doesn't " +
        'seem to be giving it back.',
    )
  })

  test('запасной текст гостю — о владельце, с теми же числами', () => {
    expect(portraitFallbackText('Anya', ARCH_EN, FACTS, 'them', 'en')).toBe(
      "Anya is 46% factory builder and 30% strategist. They've logged 4,404 hours across 22 games " +
        "and barely touched 5 of them. “Factorio” has claimed 41% of their gaming life, and it doesn't " +
        'seem to be giving it back.',
    )
  })

  test('без архетипов, без любимца, без нераспакованного — только факты; одна игра и час — в единственном', () => {
    expect(portraitFallbackText('Anya', [], { ...FACTS, unplayedCount: 0, topGame: null }, 'you', 'en')).toBe(
      "You've logged 4,404 hours across 22 games.",
    )
    expect(
      portraitFallbackText('Anya', [], { gamesCount: 1, totalHours: 1, unplayedCount: 0, topGame: null }, 'them', 'en'),
    ).toBe("They've logged 1 hour across 1 game.")
  })

  test('при скрытом времени — только сколько игр и почему про время молчим', () => {
    const hidden = { gamesCount: 1240, totalHours: 0, unplayedCount: 0, topGame: null, playtimeHidden: true }
    expect(portraitFallbackText('Anya', ARCH_EN, hidden, 'you', 'en')).toBe(
      "Anya, you're 46% factory builder and 30% strategist. Your library has 1,240 games, but your " +
        'playtime seems to be hidden in Steam settings.',
    )
    expect(portraitFallbackText('Anya', [], { ...hidden, gamesCount: 1 }, 'them', 'en')).toBe(
      'The library has 1 game, but the playtime seems to be hidden in Steam settings.',
    )
  })

  test('по-английски — ни буквы кириллицы при латинском нике и играх', () => {
    for (const voice of ['you', 'them'] as const) {
      for (const facts of [FACTS, { ...FACTS, unplayedCount: 1 }, { ...FACTS, playtimeHidden: true }]) {
        const text = portraitFallbackText('Anya', ARCH_EN, facts, voice, 'en')
        expect(text, text).not.toMatch(CYRILLIC)
      }
      for (const c of [0, 20, 50]) expect(concentrationVerdict(c, voice, 'en')).not.toMatch(CYRILLIC)
      for (const n of [1, 2, 5, 21]) expect(unplayedHeading(n, voice, 'en')).not.toMatch(CYRILLIC)
      for (const line of [paretoLead(voice, 'en'), socialTail(voice, 'en'), eraLead(voice, 'en')]) {
        expect(line).not.toMatch(CYRILLIC)
      }
    }
  })

  test('неизвестный архетип — «{tag} fan» и в тексте', () => {
    const text = portraitFallbackText(
      'Anya',
      [
        { key: 'Fantasy', label: 'фанат Fantasy', percent: 60 },
        { key: 'Shooter', label: 'стрелок', percent: 40 },
      ],
      FACTS,
      'them',
      'en',
    )
    expect(text).toMatch(/^Anya is 60% Fantasy fan and 40% sharpshooter\./)
  })

  test('архетип без ключа — ключ по русской подписи, русская подпись в английский текст не попадает', () => {
    const keyless = [
      { label: 'стрелок', percent: 60 },
      { label: 'стратег', percent: 40 },
    ]
    expect(portraitFallbackText('Anya', keyless, FACTS, 'you', 'en')).toMatch(
      /^Anya, you're 60% sharpshooter and 40% strategist\. You've logged /,
    )
    expect(
      portraitFallbackText('Anya', [{ label: 'фанат Fantasy', percent: 55 }, keyless[1]], FACTS, 'them', 'en'),
    ).toMatch(/^Anya is 55% Fantasy fan and 40% strategist\. They've logged /)
    // подпись, по которой ключ не узнать, — нейтральное слово, а не кириллица
    const odd = portraitFallbackText('Anya', [{ label: 'кто-то', percent: 70 }, keyless[1]], FACTS, 'you', 'en')
    expect(odd).toMatch(/^Anya, you're 70% player and 40% strategist\./)
    for (const voice of ['you', 'them'] as const) {
      for (const facts of [FACTS, { ...FACTS, playtimeHidden: true }]) {
        const text = portraitFallbackText('Anya', keyless, facts, voice, 'en')
        expect(text, text).not.toMatch(CYRILLIC)
        expect(text).not.toContain('undefined')
      }
    }
    // по-русски без ключа — как было
    expect(portraitFallbackText('Аня', keyless, FACTS, 'you')).toMatch(/^Аня, ты на 60% стрелок и на 40% стратег\./)
  })

  test('по-русски с ключами — как было: русская подпись из label', () => {
    expect(portraitFallbackText('Аня', ARCH_EN, FACTS, 'you')).toMatch(/^Аня, ты на 46% строитель фабрик и на 30% стратег\./)
    expect(portraitFallbackText('Аня', ARCH_EN, FACTS, 'them', 'ru')).toBe(portraitFallbackText('Аня', ARCH_EN, FACTS, 'them'))
  })
})

/**
 * Английский текст модели лежит в слоте en записи портрета, со своим
 * снапшотом: русский и английский пишутся на заходы разных людей.
 */
describe('записанный текст портрета по-английски', () => {
  const AT = 1_780_000_000
  const RU_ONLY = { takenAt: AT, text: 'Русский текст.', v: PORTRAIT_TEXT_V }

  test('без английского слота английского текста нет, а русский годится', () => {
    expect(portraitTextFresh(RU_ONLY, AT, false, 'en')).toBe(false)
    expect(portraitTextFresh({ ...RU_ONLY, en: null }, AT, false, 'en')).toBe(false)
    expect(portraitTextFresh(RU_ONLY, AT, false, 'ru')).toBe(true)
    expect(freshPortraitText(RU_ONLY, AT, false, 'en')).toBeNull()
    expect(freshPortraitText(RU_ONLY, AT, false)).toBe('Русский текст.')
  })

  test('английский слот судится своим снапшотом и своей версией', () => {
    const both = { ...RU_ONLY, en: { takenAt: AT, text: 'English text.', v: PORTRAIT_TEXT_V } }
    expect(freshPortraitText(both, AT, true, 'en')).toBe('English text.')
    expect(freshPortraitText(both, AT, true, 'ru')).toBe('Русский текст.')
    // русский переписан по новому снапшоту, английский остался от прошлого
    const stale = { ...RU_ONLY, takenAt: AT + 60, en: { takenAt: AT, text: 'English text.', v: PORTRAIT_TEXT_V } }
    expect(freshPortraitText(stale, AT + 60, false, 'en')).toBeNull()
    expect(freshPortraitText(stale, AT + 60, false, 'ru')).toBe('Русский текст.')
    // английский без версии при скрытом времени — тот же отказ, что у русского
    const old = { ...RU_ONLY, en: { takenAt: AT, text: 'English text.' } }
    expect(portraitTextFresh(old, AT, true, 'en')).toBe(false)
    expect(portraitTextFresh(old, AT, false, 'en')).toBe(true)
  })

  test('записи нет — текста нет', () => {
    expect(freshPortraitText(null, AT, false, 'en')).toBeNull()
    expect(freshPortraitText(null, AT, false)).toBeNull()
  })
})
