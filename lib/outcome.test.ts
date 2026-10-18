import { describe, expect, test } from 'vitest'
import {
  OUTCOME_PLAYED_MIN,
  OUTCOME_WINDOW_SEC,
  askableNow,
  isOutcomeVerdict,
  outcomeQuestion,
  parseOutcomeAsk,
  playedEnough,
  playedLine,
  eveningFrom,
  eveningPlayed,
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
    // от десяти часов — только часы, с разрядами
    expect(playedLine(9 * 60 + 59)).toBe('9 ч 59 мин')
    expect(playedLine(12 * 60 + 40)).toBe('13 ч')
    expect(playedLine(2434 * 60 + 42)).toBe('2\u00a0435 ч')
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

  // Поздняя сверка (fillOutcomesFromSnapshot): минуты набежали за всю паузу,
  // и вопрос говорит, откуда они, а не делает вид, что прошла пара дней
  test('после долгой паузы — «пока тебя не было»', () => {
    expect(outcomeQuestion({ name: 'Hades', minutes: 300, bought: false, late: true })).toBe(
      'Пока тебя не было: «Hades» — 5 ч после нашего совета. Как тебе?',
    )
    expect(outcomeQuestion({ name: 'Hades', minutes: 45, bought: true, late: true })).toBe(
      'Пока тебя не было: взял «Hades» и наиграл 45 мин. Как тебе?',
    )
  })
})

describe('parseOutcomeAsk', () => {
  const ok = { appid: 1145360, name: 'Hades', shownAt: 1_700_000_000, minutes: 90, bought: false }

  test('годный ответ — как есть', () => {
    expect(parseOutcomeAsk(ok)).toEqual(ok)
    expect(parseOutcomeAsk({ ...ok, bought: 'да' })).toEqual({ ...ok, bought: false })
    // Пометка поздней сверки — только настоящим true: обычный вопрос без поля
    expect(parseOutcomeAsk({ ...ok, late: true })).toEqual({ ...ok, late: true })
    expect(parseOutcomeAsk({ ...ok, late: 'да' })).toEqual(ok)
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
    expect(eveningsSummary(list)).toEqual({ checked: 2, played: 1, minutes: 95, lateMinutes: 0 })
  })

  /*
   * Поздняя сверка — сверка после окна: человек пропал дольше двух недель, и
   * минуты набежали за всю паузу. Признак выводится из самих отметок, без
   * колонки в схеме: в окне строку сверяют только снапшоты моложе окна.
   */
  const late = (over: Partial<Parameters<typeof eveningFrom>[0]> = {}) =>
    row({ checkedAt: 1_760_000_000 + OUTCOME_WINDOW_SEC + 7 * 86_400, ...over })

  test('сверено позже окна — late; на краю окна — ещё нет', () => {
    expect(eveningFrom(late())).toMatchObject({ late: true, minutes: 90 })
    expect(eveningFrom(row({ checkedAt: 1_760_000_000 + OUTCOME_WINDOW_SEC })).late).toBe(false)
    expect(eveningFrom(row({ checkedAt: null })).late).toBe(false)
  })

  // Доля за две недели и минуты за пять — разные меры: поздние в долю не
  // идут и считаются отдельной строкой
  test('сводка: поздние — не в доле, а отдельными минутами', () => {
    const list = [
      eveningFrom(row({ minutesAfter: 130 })), // 30 в окне
      eveningFrom(late({ minutesAfter: 400 })), // 300 за паузу
      eveningFrom(late({ minutesAfter: 100 })), // ноль за паузу
    ]
    expect(eveningsSummary(list)).toEqual({ checked: 1, played: 1, minutes: 30, lateMinutes: 300 })
  })

  test('подпись на полке: сколько, а у поздней — за какой срок', () => {
    expect(eveningPlayed(eveningFrom(row()))).toBe('1 ч 30 мин')
    // три недели от совета до сверки: минуты набежали не за окно в две
    expect(eveningPlayed(eveningFrom(late()))).toBe('1 ч 30 мин за 3 нед.')
    expect(eveningPlayed(eveningFrom(late({ minutesAfter: 100 })))).toBe('открыл и закрыл')
    expect(eveningPlayed(eveningFrom(row({ minutesAfter: 100, launchedAt: null })))).toBe('не запускал')
    expect(eveningPlayed(eveningFrom(row({ checkedAt: null })))).toBe('ещё не сверяли')
  })

  // То же правило, что у pendingOutcomeAsk: на что ведёт «Как тебе X?», на то
  // на полке должны быть кнопки ответа
  test('askableNow — в окне совета или в сутки после поздней сверки', () => {
    const shown = 1_760_000_000
    const fresh = eveningFrom(row())
    expect(askableNow(fresh, shown + OUTCOME_WINDOW_SEC)).toBe(true)
    expect(askableNow(fresh, shown + OUTCOME_WINDOW_SEC + 1)).toBe(false)
    expect(askableNow({ ...fresh, verdict: 'meh' }, shown)).toBe(false)
    expect(askableNow(eveningFrom(row({ minutesAfter: 105 })), shown)).toBe(false)

    const checked = shown + OUTCOME_WINDOW_SEC + 7 * 86_400
    expect(askableNow(eveningFrom(late()), checked + 86_400)).toBe(true)
    expect(askableNow(eveningFrom(late()), checked + 86_400 + 1)).toBe(false)
  })
})

describe('по-английски', () => {
  const CYRILLIC = /[А-Яа-яЁё]/

  test('playedLine: сокращения «h» и «min», тысячи через запятую', () => {
    expect(playedLine(0, 'en')).toBe('0 min')
    expect(playedLine(40, 'en')).toBe('40 min')
    expect(playedLine(60, 'en')).toBe('1 h')
    expect(playedLine(200, 'en')).toBe('3 h 20 min')
    expect(playedLine(9 * 60 + 59, 'en')).toBe('9 h 59 min')
    expect(playedLine(12 * 60 + 40, 'en')).toBe('13 h')
    expect(playedLine(2434 * 60 + 42, 'en')).toBe('2,435 h')
  })

  test('outcomeQuestion: четыре целые фразы, название в “лапках”', () => {
    expect(outcomeQuestion({ name: 'Hades', minutes: 90, bought: false }, 'en')).toBe(
      '“Hades”: 1 h 30 min since we suggested it. How is it?',
    )
    expect(outcomeQuestion({ name: 'Hades', minutes: 45, bought: true }, 'en')).toBe(
      '“Hades”: you got it and played 45 min. How is it?',
    )
    expect(outcomeQuestion({ name: 'Hades', minutes: 300, bought: false, late: true }, 'en')).toBe(
      'While you were away: 5 h in “Hades” since we suggested it. How is it?',
    )
    expect(outcomeQuestion({ name: 'Hades', minutes: 45, bought: true, late: true }, 'en')).toBe(
      'While you were away, you got “Hades” and played 45 min. How is it?',
    )
    for (const bought of [false, true]) {
      for (const late of [undefined, true] as const) {
        const q = outcomeQuestion({ name: 'Hades', minutes: 75, bought, late }, 'en')
        expect(q).not.toMatch(CYRILLIC)
        expect(q).not.toContain('«')
      }
    }
  })

  test('eveningPlayed: срок поздней сверки — «wk»', () => {
    const base = { launched: true, late: false, shownAt: 1_760_000_000, checkedAt: 1_760_100_000 }
    expect(eveningPlayed({ ...base, minutes: 90 }, 'en')).toBe('1 h 30 min')
    expect(eveningPlayed({ ...base, minutes: null }, 'en')).toBe('not checked yet')
    expect(eveningPlayed({ ...base, minutes: 0 }, 'en')).toBe('opened and closed')
    expect(eveningPlayed({ ...base, minutes: 0, launched: false }, 'en')).toBe('never launched')
    const late = { ...base, late: true, checkedAt: base.shownAt + OUTCOME_WINDOW_SEC + 7 * 86_400 }
    expect(eveningPlayed({ ...late, minutes: 90 }, 'en')).toBe('1 h 30 min in 3 wk')
    // явный ru — та же подпись, что без языка
    expect(eveningPlayed({ ...late, minutes: 90 }, 'ru')).toBe('1 ч 30 мин за 3 нед.')
  })
})
