import { describe, expect, test } from 'vitest'
import type { LibraryGame } from './types'
import { buildWarmPlan, LIBRARY_CAP, shouldRefreshSnapshot, SNAPSHOT_MAX_AGE_SEC } from './warm'

function played(appid: number, minutes: number): LibraryGame {
  return { appid, name: `game-${appid}`, playtimeForever: minutes, playtime2Weeks: 0 }
}

function untouched(appid: number): LibraryGame {
  return { appid, name: `game-${appid}`, playtimeForever: 0, playtime2Weeks: 0 }
}

/** 900 наигранных + 2100 незапущенных — типичная «дохуища игр» библиотека */
function bigLibrary(playedCount: number, untouchedCount: number): LibraryGame[] {
  return [
    ...Array.from({ length: playedCount }, (_, i) => played(i + 1, (i + 1) * 10)),
    ...Array.from({ length: untouchedCount }, (_, i) => untouched(10_000 + i)),
  ]
}

describe('buildWarmPlan', () => {
  test('незапущенные попадают в прогрев в библиотеке на 3000 игр', () => {
    const plan = buildWarmPlan(bigLibrary(900, 2100), [])
    const untouchedInPlan = plan.filter((id) => id >= 10_000).length
    expect(untouchedInPlan).toBeGreaterThan(0)
  })

  test('при 1500 наигранных незапущенные всё равно получают метаданные', () => {
    // Именно этот случай раньше означал полную блокировку: сортировка по часам
    // вниз забирала весь потолок под наигранные, и до нулевых очередь не доходила
    const plan = buildWarmPlan(bigLibrary(1500, 500), [])
    const untouchedInPlan = plan.filter((id) => id >= 10_000).length
    expect(untouchedInPlan).toBe(500)
  })

  test('порядок детерминирован: два вызова дают один и тот же список', () => {
    const lib = bigLibrary(50, 50)
    expect(buildWarmPlan(lib, [7, 8])).toEqual(buildWarmPlan(lib, [7, 8]))
  })

  test('пул «попробуй новое» не вытесняется большой библиотекой', () => {
    const pool = Array.from({ length: 60 }, (_, i) => 900_000 + i)
    const plan = buildWarmPlan(bigLibrary(2000, 2000), pool)
    for (const id of pool) expect(plan).toContain(id)
  })

  test('размер целевого набора не вырос — первый прогрев не стал длиннее', () => {
    expect(buildWarmPlan(bigLibrary(2000, 2000), []).length).toBe(LIBRARY_CAP)
  })

  test('наигранные идут по убыванию часов, как и раньше', () => {
    const plan = buildWarmPlan([played(1, 10), played(2, 900), played(3, 100)], [])
    expect(plan).toEqual([2, 3, 1])
  })

  test('маленькая библиотека прогревается целиком', () => {
    const lib = [played(1, 100), untouched(2), played(3, 50)]
    expect(buildWarmPlan(lib, []).sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  test('пустая библиотека не роняет', () => {
    expect(buildWarmPlan([], [])).toEqual([])
  })

  test('дубликаты между библиотекой и пулом не размножаются', () => {
    const plan = buildWarmPlan([played(1, 10)], [1, 2])
    expect(plan).toEqual([...new Set(plan)])
  })
})

describe('shouldRefreshSnapshot', () => {
  const NOW = 1_700_000_000
  const base = { isDemo: false, hasApiKey: true, nowSec: NOW }

  test('свежий снапшот не трогаем', () => {
    expect(shouldRefreshSnapshot({ ...base, takenAt: NOW - 60 })).toBe(false)
  })

  test('протухший — идём в Steam', () => {
    expect(shouldRefreshSnapshot({ ...base, takenAt: NOW - SNAPSHOT_MAX_AGE_SEC - 1 })).toBe(true)
  })

  test('снапшот с прошлого входа месяц назад обязан обновиться', () => {
    // сессия живёт 30 дней, и раньше всё это время часы были заморожены
    expect(shouldRefreshSnapshot({ ...base, takenAt: NOW - 30 * 86_400 })).toBe(true)
  })

  test('демо в Steam не ходит', () => {
    expect(shouldRefreshSnapshot({ ...base, isDemo: true, takenAt: 0 })).toBe(false)
  })

  test('без ключа Steam не ходим и не роняем прогрев', () => {
    expect(shouldRefreshSnapshot({ ...base, hasApiKey: false, takenAt: 0 })).toBe(false)
  })
})
