import { describe, expect, test } from 'vitest'
import { heuristicPicks, trimTldr, validateDigest, validatePicks } from './llm'
import type { GameMeta, Mood, ScoredCandidate } from './types'

const MOOD: Mood = { time: 'medium', vibe: 'chill', social: 'solo' }

const CANDS: ScoredCandidate[] = [
  { appid: 1, name: 'Backlog Gem', source: 'backlog', score: 0.9 },
  { appid: 2, name: 'Old Flame', source: 'comeback', score: 0.8 },
  { appid: 3, name: 'Shiny New', source: 'new', score: 0.7 },
  { appid: 4, name: 'Backlog Two', source: 'backlog', score: 0.6 },
  { appid: 5, name: 'New Two', source: 'new', score: 0.5 },
  { appid: 6, name: 'New Three', source: 'new', score: 0.4 },
]

function metaOf(appid: number): GameMeta | undefined {
  return {
    appid,
    name: CANDS.find((c) => c.appid === appid)?.name ?? 'x',
    tags: { Puzzle: 100, Atmospheric: 60 },
    genres: [],
    categories: [2],
  }
}

describe('validatePicks', () => {
  test('пропускает только известных кандидатов, максимум 5, без дублей', () => {
    const raw = {
      picks: [
        { appid: 1, reason: 'ок' },
        { appid: 1, reason: 'дубль' },
        { appid: 999, reason: 'выдумка модели' },
        { appid: 2, reason: 'ок' },
        { appid: 3, reason: 'ок' },
        { appid: 4, reason: 'ок' },
        { appid: 5, reason: 'ок' },
        { appid: 6, reason: 'шестой лишний' },
      ],
    }
    const picks = validatePicks(raw, CANDS)
    expect(picks.map((p) => p.appid)).toEqual([1, 2, 3, 4, 5])
    expect(picks[0]).toMatchObject({ appid: 1, name: 'Backlog Gem', source: 'backlog', reason: 'ок' })
  })

  test('мусор вместо ответа модели даёт пустой список', () => {
    expect(validatePicks(null, CANDS)).toEqual([])
    expect(validatePicks({ picks: 'nope' }, CANDS)).toEqual([])
  })

  test('reason обрезается до 300 символов', () => {
    const picks = validatePicks({ picks: [{ appid: 1, reason: 'х'.repeat(1000) }] }, CANDS)
    expect(picks[0].reason).toHaveLength(300)
  })
})

describe('heuristicPicks', () => {
  test('в топ-5 попадает хотя бы по одному из каждого доступного источника', () => {
    const picks = heuristicPicks(CANDS, metaOf, MOOD, 5)
    const sources = new Set(picks.map((p) => p.source))
    expect(sources.has('backlog')).toBe(true)
    expect(sources.has('comeback')).toBe(true)
    expect(sources.has('new')).toBe(true)
    expect(picks).toHaveLength(5)
  })

  test('объяснения непустые и человеческие', () => {
    const picks = heuristicPicks(CANDS, metaOf, MOOD, 3)
    expect(picks).toHaveLength(3)
    for (const p of picks) {
      expect(p.reason.length).toBeGreaterThan(10)
    }
  })

  test('пустой список кандидатов не роняет', () => {
    expect(heuristicPicks([], metaOf, MOOD, 5)).toEqual([])
  })
})

describe('validateDigest', () => {
  test('принимает корректный ответ и обрезает длину', () => {
    expect(validateDigest({ tldr: '  Починили вылет.  ', scale: 'hotfix' })).toEqual({
      tldr: 'Починили вылет.',
      scale: 'hotfix',
    })
    // многоточие должно поместиться в лимит, а не добавиться сверх него
    const long = validateDigest({ tldr: 'я'.repeat(400), scale: 'major' })?.tldr ?? ''
    expect(long.length).toBeLessThanOrEqual(200)
    expect(long.endsWith('…')).toBe(true)
  })

  test('отвергает мусор: лента переживёт отказ модели', () => {
    expect(validateDigest(null)).toBeNull()
    expect(validateDigest({ tldr: '', scale: 'major' })).toBeNull()
    expect(validateDigest({ tldr: 'ок', scale: 'huge' })).toBeNull()
    expect(validateDigest({ tldr: 'ок' })).toBeNull()
    expect(validateDigest({ scale: 'major' })).toBeNull()
  })
})

describe('trimTldr', () => {
  test('короткий текст не трогает', () => {
    expect(trimTldr('Починили вылет.')).toBe('Починили вылет.')
  })

  test('режет по концу предложения, а не по счётчику символов', () => {
    const s = 'Добавлен новый режим на восемь игроков и переработан баланс оружия. ' +
      'Дополнительно исправлены вылеты на старте и подтянута стабильность сети в дальних регионах.'
    const got = trimTldr(s, 120)
    expect(got.endsWith('.')).toBe(true)
    expect(got.length).toBeLessThanOrEqual(120)
    expect(got).not.toContain('Дополнительно')
  })

  test('нет предложения — режет по слову и ставит многоточие', () => {
    // именно этот случай рвал текст на «…и ещё 8 право»
    const s = 'Исправлены вылеты, проблемы с кооперативом, поведением врагов и ещё восемь правок баланса'
    const got = trimTldr(s, 40)
    expect(got.endsWith('…')).toBe(true)
    expect(got.length).toBeLessThanOrEqual(41)
    // последнее слово целое
    expect(s.startsWith(got.slice(0, -1))).toBe(true)
  })

  test('висячая пунктуация перед многоточием убирается', () => {
    expect(trimTldr('Исправлены вылеты, проблемы с сетью', 20)).not.toContain(',…')
  })
})

describe('trimTldr: длина не превышается никогда', () => {
  test('на любых входных данных результат влезает в лимит', () => {
    const cases = [
      'я'.repeat(400),
      'Слово '.repeat(80),
      'Предложение одно. Предложение два. ' + 'хвост '.repeat(40),
      'а б в г д е ё ж з и к л м н о п р с т у ф х ц ч ш щ э ю я'.repeat(6),
    ]
    for (const c of cases) {
      for (const max of [20, 60, 200]) {
        expect(trimTldr(c, max).length).toBeLessThanOrEqual(max)
      }
    }
  })
})
