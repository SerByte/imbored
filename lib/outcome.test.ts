import { describe, expect, test } from 'vitest'
import {
  OUTCOME_PLAYED_MIN,
  isOutcomeVerdict,
  outcomeQuestion,
  parseOutcomeAsk,
  playedEnough,
  playedLine,
  eveningFrom,
  eveningsSummary,
} from './outcome'

describe('playedLine', () => {
  test('минуты, часы и то и другое — сокращениями, без склонений', () => {
    expect(playedLine(0)).toBe('0 мин')
    expect(playedLine(40)).toBe('40 мин')
    expect(playedLine(60)).toBe('1 ч')
    expect(playedLine(200)).toBe('3 ч 20 мин')
    expect(playedLine(89.6)).toBe('1 ч 30 мин')
    expect(playedLine(-5)).toBe('0 мин')
  })
})

describe('outcomeQuestion', () => {
  test('своя — «с тех пор», купленная — «взял и наиграл»', () => {
    expect(outcomeQuestion({ name: 'Hades', minutes: 90, bought: false })).toBe(
      '«Hades»: 1 ч 30 мин с тех пор, как мы её предложили. Как тебе?',
    )
    expect(outcomeQuestion({ name: 'Hades', minutes: 45, bought: true })).toBe(
      '«Hades»: взял и наиграл 45 мин. Как тебе?',
    )
  })
})

describe('parseOutcomeAsk', () => {
  const ok = { appid: 1145360, name: 'Hades', shownAt: 1_700_000_000, minutes: 90, bought: false }

  test('годный ответ — как есть', () => {
    expect(parseOutcomeAsk(ok)).toEqual(ok)
    expect(parseOutcomeAsk({ ...ok, bought: 'да' })).toEqual({ ...ok, bought: false })
  })

  test('мусор — не вопрос: про «игру undefined» спрашивать хуже, чем молчать', () => {
    for (const raw of [
      null,
      'Hades',
      { ...ok, appid: 0 },
      { ...ok, appid: 1.5 },
      { ...ok, name: '  ' },
      { ...ok, shownAt: 'вчера' },
      { ...ok, minutes: -1 },
      { ...ok, minutes: Number.NaN },
    ]) {
      expect(parseOutcomeAsk(raw), JSON.stringify(raw)).toBeNull()
    }
  })
})

describe('ответы и порог', () => {
  test('ответы — только из списка', () => {
    for (const v of ['hooked', 'meh', 'dismissed']) expect(isOutcomeVerdict(v)).toBe(true)
    for (const v of ['liked', '', null, 1]) expect(isOutcomeVerdict(v)).toBe(false)
  })

  test('сыграл — от четверти часа; открыл и закрыл — нет', () => {
    expect(playedEnough(null)).toBe(false)
    expect(playedEnough(OUTCOME_PLAYED_MIN - 1)).toBe(false)
    expect(playedEnough(OUTCOME_PLAYED_MIN)).toBe(true)
  })
})

describe('Твои вечера', () => {
  const row = (over: Partial<Parameters<typeof eveningFrom>[0]> = {}) => ({
    appid: 620,
    shownAt: 1_760_000_000,
    launchedAt: 1_760_000_100,
    minutesBefore: 100,
    minutesAfter: 190,
    ownedAfter: 1,
    checkedAt: 1_760_100_000,
    verdict: null,
    ...over,
  })

  test('минуты — прирост за окно совета, не меньше нуля', () => {
    expect(eveningFrom(row()).minutes).toBe(90)
    // снапшот показал меньше (сброс счётчика в Steam) — не отрицательное
    expect(eveningFrom(row({ minutesAfter: 50 })).minutes).toBe(0)
  })

  test('несверенный — неизвестно, а не ноль; заглянул и не купил — ноль', () => {
    expect(eveningFrom(row({ checkedAt: null })).minutes).toBeNull()
    expect(eveningFrom(row({ minutesBefore: null, minutesAfter: null, ownedAfter: 0 })).minutes).toBe(0)
  })

  test('купил после совета — bought; чужой вердикт — null', () => {
    expect(eveningFrom(row({ minutesBefore: null, minutesAfter: 30 })).bought).toBe(true)
    expect(eveningFrom(row({ verdict: 'meh' })).verdict).toBe('meh')
    expect(eveningFrom(row({ verdict: 'drop table' })).verdict).toBeNull()
  })

  // Честная доля: знаменатель — только сверенные
  test('сводка считает только сверенные и сыгранное от пятнадцати минут', () => {
    const list = [
      eveningFrom(row({ minutesAfter: 190 })), // 90 — сыграл
      eveningFrom(row({ minutesAfter: 105 })), // 5 — открыл и закрыл
      eveningFrom(row({ checkedAt: null })), // неизвестно
    ]
    expect(eveningsSummary(list)).toEqual({ checked: 2, played: 1, minutes: 95 })
  })
})
