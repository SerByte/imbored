import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { SOURCE_BADGE, SOURCE_BADGE_SHORT, sourceBadge, sourceBadgeShort, suggestsInstall } from './sources'
import { CANDIDATE_SOURCES } from './types'

describe('SOURCE_BADGE', () => {
  // Тест, который поймает пятый источник через год: типы заставят добавить
  // ключ, но не заставят написать в него что-то осмысленное
  test('у каждого источника есть непустая подпись', () => {
    for (const source of CANDIDATE_SOURCES) {
      expect(SOURCE_BADGE[source]?.trim().length).toBeGreaterThan(0)
    }
  })

  test('подписи не повторяются: иначе источники сливаются для читателя', () => {
    const values = CANDIDATE_SOURCES.map((s) => SOURCE_BADGE[s])
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('SOURCE_BADGE_SHORT', () => {
  // Те же два правила: короткая карта живёт в плитках выдачи, и пустая или
  // повторяющаяся подпись там так же молча сливает источники.
  test('у каждого источника есть непустая короткая подпись', () => {
    for (const source of CANDIDATE_SOURCES) {
      expect(SOURCE_BADGE_SHORT[source]?.trim().length).toBeGreaterThan(0)
    }
  })

  test('короткие подписи не повторяются', () => {
    const values = CANDIDATE_SOURCES.map((s) => SOURCE_BADGE_SHORT[s])
    expect(new Set(values).size).toBe(values.length)
  })

  // Смысл карты — влезть в плитку в 134px: короткая форма длиннее полной
  // была бы уже не короткой.
  test('короткая форма не длиннее полной', () => {
    for (const source of CANDIDATE_SOURCES) {
      expect(SOURCE_BADGE_SHORT[source].length).toBeLessThanOrEqual(SOURCE_BADGE[source].length)
    }
  })
})

describe('suggestsInstall', () => {
  // Своя при скрытом в Steam времени (owned) — та же «скорее всего не
  // установлена», что нетронутая: без неё ссылку теряла вся своя выдача
  test('нетронутая, заброшенная и своя при скрытом времени — да; остальные — нет', () => {
    expect(CANDIDATE_SOURCES.filter(suggestsInstall)).toEqual(['untouched', 'comeback', 'owned'])
  })

  // Условие жило копией в двух страницах, и новый источник терял ссылку молча
  test('/play и /daily решают по нему, а не своим условием', () => {
    const root = path.join(__dirname, '..')
    for (const rel of ['app/[lang]/play/page.tsx', 'app/[lang]/daily/page.tsx']) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8')
      expect(src, rel).toMatch(/suggestsInstall\(\w+\.source\) && !\w+\.storeUrl/)
      expect(src, rel).not.toMatch(/source === 'untouched' \|\| \w+\.source === 'comeback'/)
    }
  })
})

/*
 * Английские подписи — те же правила, что у русских: у каждого источника
 * своя, без повторов, короткая не длиннее полной. Слова — из глоссария.
 */
describe('подписи источников по-английски', () => {
  const CYRILLIC = /[А-Яа-яЁё]/

  test('полные — по глоссарию', () => {
    expect(CANDIDATE_SOURCES.map((s) => [s, sourceBadge(s, 'en')])).toEqual([
      ['untouched', 'Bought, never opened'],
      ['backlog', 'Bounced off'],
      ['comeback', 'Time to go back'],
      ['familiar', 'Old favorite'],
      ['owned', 'From your library'],
      ['new', 'New to you'],
    ])
  })

  test('короткие — по глоссарию', () => {
    expect(CANDIDATE_SOURCES.map((s) => [s, sourceBadgeShort(s, 'en')])).toEqual([
      ['untouched', 'Unopened'],
      ['backlog', 'Bounced off'],
      ['comeback', 'Time to go back'],
      ['familiar', 'Favorite'],
      ['owned', 'Yours'],
      ['new', 'New'],
    ])
  })

  test('без повторов, короткая не длиннее полной, кириллицы нет', () => {
    const full = CANDIDATE_SOURCES.map((s) => sourceBadge(s, 'en'))
    const short = CANDIDATE_SOURCES.map((s) => sourceBadgeShort(s, 'en'))
    expect(new Set(full).size).toBe(full.length)
    expect(new Set(short).size).toBe(short.length)
    for (const s of CANDIDATE_SOURCES) {
      expect(sourceBadgeShort(s, 'en').length, s).toBeLessThanOrEqual(sourceBadge(s, 'en').length)
      expect(sourceBadge(s, 'en'), s).not.toMatch(CYRILLIC)
      expect(sourceBadgeShort(s, 'en'), s).not.toMatch(CYRILLIC)
    }
  })

  test('по умолчанию — русские карты, как были', () => {
    for (const s of CANDIDATE_SOURCES) {
      expect(sourceBadge(s)).toBe(SOURCE_BADGE[s])
      expect(sourceBadgeShort(s)).toBe(SOURCE_BADGE_SHORT[s])
    }
  })
})
