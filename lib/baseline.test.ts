import { describe, expect, test } from 'vitest'
import {
  createDb,
  getLibraryBaseline,
  getLatestSnapshot,
  saveLibrarySnapshot,
  snapshotYear,
} from './db'
import type { LibraryGame } from './types'

/**
 * Отметка года — единственные данные проекта, которые нельзя восстановить
 * задним числом: Steam отдаёт только пожизненные часы. Ошибка здесь обнаружится
 * в декабре и чинить её будет нечем, поэтому проверок больше обычного.
 */

/** 2026-03-01 и 2026-11-01 — один год; 2027-01-05 — уже следующий. */
const MARCH_2026 = Math.floor(Date.UTC(2026, 2, 1) / 1000)
const NOV_2026 = Math.floor(Date.UTC(2026, 10, 1) / 1000)
const JAN_2027 = Math.floor(Date.UTC(2027, 0, 5) / 1000)

const ME = '76561198000000001'

function lib(hours: number): LibraryGame[] {
  return [{ appid: 570, name: 'Dota 2', playtimeForever: hours * 60, playtime2Weeks: 0 }]
}

function freshDb() {
  return createDb(':memory:')
}

describe('snapshotYear', () => {
  test('считает по UTC, а не по местному времени', () => {
    expect(snapshotYear(MARCH_2026)).toBe(2026)
    expect(snapshotYear(NOV_2026)).toBe(2026)
    expect(snapshotYear(JAN_2027)).toBe(2027)
    // последняя секунда года и первая следующего
    expect(snapshotYear(Math.floor(Date.UTC(2026, 11, 31, 23, 59, 59) / 1000))).toBe(2026)
    expect(snapshotYear(Math.floor(Date.UTC(2027, 0, 1, 0, 0, 0) / 1000))).toBe(2027)
  })
})

describe('отметка библиотеки на начало года', () => {
  test('первый в жизни заход становится отметкой текущего года', async () => {
    const db = await freshDb()
    await saveLibrarySnapshot(db, ME, lib(100), MARCH_2026)

    const base = await getLibraryBaseline(db, ME, 2026)
    expect(base?.takenAt).toBe(MARCH_2026)
    expect(base?.games[0].playtimeForever).toBe(6000)
  })

  test('повторные заходы в том же году отметку НЕ перезаписывают', async () => {
    const db = await freshDb()
    await saveLibrarySnapshot(db, ME, lib(100), MARCH_2026)
    await saveLibrarySnapshot(db, ME, lib(300), NOV_2026)

    const base = await getLibraryBaseline(db, ME, 2026)
    expect(base?.takenAt).toBe(MARCH_2026)
    expect(base?.games[0].playtimeForever).toBe(6000)

    // а текущий снапшот при этом свежий — считать разницу есть из чего
    const now = await getLatestSnapshot(db, ME)
    expect(now?.games[0].playtimeForever).toBe(18_000)
  })

  test('вернувшийся в новом году получает отметкой ПРОШЛОГОДНЕЕ состояние', async () => {
    const db = await freshDb()
    await saveLibrarySnapshot(db, ME, lib(100), MARCH_2026)
    await saveLibrarySnapshot(db, ME, lib(300), NOV_2026)

    // первый заход 2027-го: за январь он мог уже наиграть, и текущие часы
    // отметкой брать нельзя — иначе наигранное между ноябрём и январём
    // потерялось бы из итогов обоих лет
    await saveLibrarySnapshot(db, ME, lib(340), JAN_2027)

    const base2027 = await getLibraryBaseline(db, ME, 2027)
    expect(base2027?.takenAt).toBe(NOV_2026)
    expect(base2027?.games[0].playtimeForever).toBe(18_000)

    // отметка 2026-го на месте и не тронута
    expect((await getLibraryBaseline(db, ME, 2026))?.takenAt).toBe(MARCH_2026)
  })

  test('отметка переживает подрезку обычных снапшотов', async () => {
    const db = await freshDb()
    await saveLibrarySnapshot(db, ME, lib(100), MARCH_2026)
    // SNAPSHOTS_KEPT = 3, поэтому мартовский снапшот вытеснится
    for (let i = 1; i <= 4; i++) {
      await saveLibrarySnapshot(db, ME, lib(100 + i * 10), NOV_2026 + i)
    }

    const rows = await db.execute({
      sql: 'SELECT COUNT(*) AS n FROM library_snapshots WHERE steamid = ?',
      args: [ME],
    })
    expect(Number((rows.rows[0] as unknown as { n: number }).n)).toBe(3)

    // а отметка — на месте, с мартовскими часами
    const base = await getLibraryBaseline(db, ME, 2026)
    expect(base?.takenAt).toBe(MARCH_2026)
    expect(base?.games[0].playtimeForever).toBe(6000)
  })

  test('отметки разных игроков не смешиваются', async () => {
    const db = await freshDb()
    const other = '76561198000000002'
    await saveLibrarySnapshot(db, ME, lib(100), MARCH_2026)
    await saveLibrarySnapshot(db, other, lib(700), NOV_2026)

    expect((await getLibraryBaseline(db, ME, 2026))?.games[0].playtimeForever).toBe(6000)
    expect((await getLibraryBaseline(db, other, 2026))?.games[0].playtimeForever).toBe(42_000)
  })

  test('года без отметки нет — читатель отдаёт null, а не выдумывает', async () => {
    const db = await freshDb()
    await saveLibrarySnapshot(db, ME, lib(100), MARCH_2026)
    expect(await getLibraryBaseline(db, ME, 2025)).toBeNull()
    expect(await getLibraryBaseline(db, 'никого', 2026)).toBeNull()
  })
})
