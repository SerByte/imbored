import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { dayKey } from './daily'
import { createDb, upsertUser, type Db } from './db'
import { cohortHour, daysBetween, isoWeek, markReturn, returnKey } from './retention'
import { bumpTelemetry, pruneTelemetry, TELEMETRY_TTL_SEC, telemetryKey } from './telemetry'

const DAY = 86_400

/** Момент по московским часам: '2026-09-21T12:00' */
const msk = (local: string) => Date.parse(`${local}:00+03:00`) / 1000

/** Понедельник недели 2026-W39, полдень по Москве */
const BORN = msk('2026-09-21T12:00')

describe('сутки и недели', () => {
  test('ISO-неделя: номер по четвергу, год — ISO-шный', () => {
    expect(isoWeek('2026-09-21')).toBe('2026-W39')
    expect(isoWeek('2026-09-27')).toBe('2026-W39')
    expect(isoWeek('2026-09-28')).toBe('2026-W40')
    expect(isoWeek('2025-10-09')).toBe('2025-W41')
    // Стыки годов: хвост декабря бывает первой неделей следующего года,
    // начало января — последней неделей прошлого
    expect(isoWeek('2024-12-30')).toBe('2025-W01')
    expect(isoWeek('2020-12-31')).toBe('2020-W53')
    expect(isoWeek('2021-01-03')).toBe('2020-W53')
    expect(isoWeek('2021-01-04')).toBe('2021-W01')
  })

  test('час когорты — полночь UTC московского понедельника её недели', () => {
    const monday = Date.UTC(2026, 8, 21) / 1000
    expect(cohortHour(msk('2026-09-21T00:30'))).toBe(monday)
    expect(cohortHour(msk('2026-09-27T23:59'))).toBe(monday)
    // Понедельник 01:00 по Москве — ещё воскресенье по UTC, но когорта уже новая
    expect(cohortHour(msk('2026-09-28T01:00'))).toBe(monday + 7 * DAY)
    // ISO-неделя через Новый год: понедельник 2024-12-30 — первая неделя 2025
    expect(cohortHour(msk('2025-01-02T12:00'))).toBe(Date.UTC(2024, 11, 30) / 1000)
  })

  test('дни между датами — календарные, через месяц и год', () => {
    expect(daysBetween('2026-09-27', '2026-09-27')).toBe(0)
    expect(daysBetween('2026-02-27', '2026-03-01')).toBe(2)
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1)
    expect(daysBetween('2026-09-28', '2026-09-21')).toBe(-7)
  })
})

describe('окна возврата', () => {
  const born = dayKey(BORN)
  const day = (n: number) => dayKey(BORN + n * DAY)
  /** Ключ для захода на день n, если прошлый заход был на день prev */
  const key = (n: number, prev: number | null, demo = false) =>
    returnKey({ createdAt: BORN, prevDay: prev === null ? null : day(prev), today: day(n), demo })

  test('d0 — приход, d1 — назавтра, d7 — 7…13-й день, d30 — 30…36-й', () => {
    expect(born).toBe('2026-09-21')
    expect(key(0, null)).toBe('return:2026-W39:d0:steam')
    expect(key(1, 0)).toBe('return:2026-W39:d1:steam')
    expect(key(7, 1)).toBe('return:2026-W39:d7:steam')
    expect(key(13, 3)).toBe('return:2026-W39:d7:steam')
    expect(key(30, 13)).toBe('return:2026-W39:d30:steam')
    expect(key(36, 20)).toBe('return:2026-W39:d30:steam')
    expect(key(0, null, true)).toBe('return:2026-W39:d0:demo')
  })

  test('между окнами и после них не считается ничего', () => {
    for (const n of [2, 3, 6, 14, 20, 29, 37, 60]) expect(key(n, n - 1), `день ${n}`).toBeNull()
    // Часы, ушедшие назад, не делают из захода приход
    expect(key(-1, null)).toBeNull()
  })

  test('в окне человек считается один раз: второй заход внутри окна — null', () => {
    expect(key(10, 7)).toBeNull()
    expect(key(13, 12)).toBeNull()
    expect(key(36, 30)).toBeNull()
    // Первый заход в окне засчитывается, в какой бы день окна он ни пришёлся
    expect(key(10, 6)).toBe('return:2026-W39:d7:steam')
  })

  test('каждое окно — не больше единицы на человека, как бы часто он ни заходил', () => {
    // Прогон по одной дате, как её видит сервер: ни истории, ни второй колонки
    const walk = (every: number) => {
      const keys: string[] = []
      let prev: number | null = null
      for (let n = 0; n <= 45; n += every) {
        const k = key(n, prev)
        if (k) keys.push(k.split(':')[2])
        prev = n
      }
      return keys
    }
    expect(walk(1)).toEqual(['d0', 'd1', 'd7', 'd30'])
    // Раз в три дня: назавтра не пришёл, на второй неделе (9-й) и через месяц (30-й) — да
    expect(walk(3)).toEqual(['d0', 'd7', 'd30'])
    expect(walk(5)).toEqual(['d0', 'd7', 'd30'])
  })

  test('сутки московские и календарные: 23:30 и 00:30 — уже d1', () => {
    const late = msk('2026-09-21T23:30')
    expect(
      returnKey({ createdAt: late, prevDay: dayKey(late), today: dayKey(late + 3600), demo: false }),
    ).toBe('return:2026-W39:d1:steam')
  })

  test('неделя — по дню прихода в Москве, а не по UTC и не по дню возврата', () => {
    // Понедельник 01:00 по Москве — ещё воскресенье по UTC, прошлая неделя
    const monday = msk('2026-09-28T01:00')
    expect(returnKey({ createdAt: monday, prevDay: null, today: dayKey(monday), demo: false })).toBe(
      'return:2026-W40:d0:steam',
    )
    // Пришёл в воскресенье, вернулся в понедельник — это когорта воскресенья
    const sunday = msk('2026-09-27T20:00')
    expect(
      returnKey({ createdAt: sunday, prevDay: '2026-09-27', today: '2026-09-28', demo: false }),
    ).toBe('return:2026-W39:d1:steam')
  })
})

const ME = '76561198000000001'
const FRIEND = '76561198000000002'
const GUEST = '00012345678901231'

async function counters(db: Db): Promise<Record<string, number>> {
  const res = await db.execute(
    "SELECT key, SUM(count) AS n FROM telemetry_hourly WHERE key GLOB 'return:*' GROUP BY key ORDER BY key",
  )
  return Object.fromEntries(res.rows.map((r) => [String(r.key), Number(r.n)]))
}

describe('markReturn', () => {
  test('первый заход за сутки — плюс один, повтор в те же сутки — ничего', async () => {
    const db = await createDb(':memory:')
    await upsertUser(db, { steamid: ME }, BORN)
    expect(await markReturn(db, ME, false, BORN + 60)).toBe('return:2026-W39:d0:steam')
    expect(await markReturn(db, ME, false, BORN + 3600)).toBeNull()
    expect(await markReturn(db, ME, false, BORN + DAY)).toBe('return:2026-W39:d1:steam')
    // Заход между окнами дату переставляет, но не считается
    expect(await markReturn(db, ME, false, BORN + 3 * DAY)).toBeNull()
    expect(await counters(db)).toEqual({
      'return:2026-W39:d0:steam': 1,
      'return:2026-W39:d1:steam': 1,
    })
    const row = await db.execute({ sql: 'SELECT last_active_day FROM users WHERE steamid = ?', args: [ME] })
    expect(row.rows[0]?.last_active_day).toBe(dayKey(BORN + 3 * DAY))
  })

  test('в счётчиках ни SteamID, ни дня захода: вся когорта — в часе своего понедельника', async () => {
    const db = await createDb(':memory:')
    // Пришёл в среду вечером; возвращается в разные дни и часы
    const wed = msk('2026-09-23T19:07')
    await upsertUser(db, { steamid: ME }, wed)
    for (const at of [wed, wed + DAY + 3 * 3600, wed + 8 * DAY - 7000, wed + 31 * DAY + 123]) {
      await markReturn(db, ME, false, at)
    }
    const all = await db.execute('SELECT hour, kind, key FROM telemetry_hourly ORDER BY key')
    expect(JSON.stringify(all.rows)).not.toContain(ME)
    expect(all.rows.map((r) => String(r.key).split(':')[2])).toEqual(['d0', 'd1', 'd30', 'd7'])
    expect(new Set(all.rows.map((r) => Number(r.hour)))).toEqual(new Set([Date.UTC(2026, 8, 21) / 1000]))
    expect(all.rows.map((r) => r.kind)).toEqual(['event', 'event', 'event', 'event'])
    // markActiveDay пишет ключ мимо telemetryKey — он обязан и так проходить его алфавит
    for (const r of all.rows) expect(telemetryKey(String(r.key))).toBe(r.key)
  })

  test('уборка счётчиков стирает когорту разом, а не d0 раньше d30', async () => {
    const db = await createDb(':memory:')
    const sun = msk('2026-09-27T21:00')
    await upsertUser(db, { steamid: ME }, sun)
    for (const n of [0, 1, 7, 30]) await markReturn(db, ME, false, sun + n * DAY)
    const monday = Date.UTC(2026, 8, 21) / 1000
    // Девяностый день от понедельника — когорта ещё вся на месте
    expect(await pruneTelemetry(db, monday + TELEMETRY_TTL_SEC)).toBe(0)
    expect(Object.keys(await counters(db))).toHaveLength(4)
    // Час спустя уходит вся, и отчёт не покажет у неё больше 100%
    expect(await pruneTelemetry(db, monday + TELEMETRY_TTL_SEC + 3600)).toBe(4)
    expect(await counters(db)).toEqual({})
  })

  test('без строки users — ни отметки, ни счётчика', async () => {
    const db = await createDb(':memory:')
    expect(await markReturn(db, ME, false, BORN)).toBeNull()
    expect(await counters(db)).toEqual({})
  })
})

/**
 * Готовый запрос из DEPLOY.md, раздел 6.10, — ровно тот текст, что владелец
 * скопирует в консоль Turso. Разъедись он с форматом ключа, отчёт молча
 * показывал бы пустоту или чужие числа.
 */
describe('отчёт по когортам в DEPLOY.md', () => {
  function reportSql(): string {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'DEPLOY.md'), 'utf8')
    const blocks = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1])
    const found = blocks.filter((b) => b.includes('возвраты по когортам'))
    expect(found, 'в DEPLOY.md нет блока «возвраты по когортам»').toHaveLength(1)
    return found[0]
  }

  test('считает приход и долю вернувшихся по неделе и виду входа', async () => {
    const db = await createDb(':memory:')
    for (const id of [ME, FRIEND, GUEST]) await upsertUser(db, { steamid: id }, BORN)
    // Я: назавтра, на второй неделе и через месяц. Друг: только приход и
    // заход на второй день, который ни в одно окно не попадает
    for (const n of [0, 1, 8, 31]) await markReturn(db, ME, false, BORN + n * DAY)
    for (const n of [0, 2]) await markReturn(db, FRIEND, false, BORN + n * DAY)
    // Демо дожило до месяца (здесь уборки нет), но его d30 — нижняя граница:
    // пропавших на две недели уборка сносит раньше окна. Отчёт его не показывает
    for (const n of [0, 1, 31]) await markReturn(db, GUEST, true, BORN + n * DAY)
    // Шаги воронки лежат в той же таблице и в отчёт попадать не должны
    await bumpTelemetry(db, 'event', 'quiz_done:direct', BORN)

    const res = await db.execute(reportSql())
    expect(res.rows.map((r) => ({ ...r }))).toEqual([
      { week: '2026-W39', who: 'demo', came: 1, d1: 100, d7: 0, d30: null },
      { week: '2026-W39', who: 'steam', came: 2, d1: 50, d7: 50, d30: 50 },
    ])
  })
})
