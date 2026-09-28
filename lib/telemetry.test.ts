import { describe, expect, test } from 'vitest'
import { createDb } from './db'
import { bumpTelemetry, hourOf, pruneTelemetry, telemetryCount, telemetryKey, TELEMETRY_TTL_SEC } from './telemetry'

const T0 = 1_760_000_000

describe('telemetry_hourly', () => {
  test('счётчик копится по часу, виду и ключу', async () => {
    const db = await createDb(':memory:')
    await bumpTelemetry(db, 'server-error', 'route:/api/recommend', T0)
    await bumpTelemetry(db, 'server-error', 'route:/api/recommend', T0 + 10)
    await bumpTelemetry(db, 'server-error', 'render:/game/[appid]', T0 + 20)
    await bumpTelemetry(db, 'csp', 'img-src', T0, 3)
    await bumpTelemetry(db, 'server-error', 'route:/api/recommend', T0 + 3600)
    const rows = (
      await db.execute('SELECT hour, kind, key, count FROM telemetry_hourly ORDER BY hour, kind, key')
    ).rows.map((r) => [Number(r.hour), r.kind, r.key, Number(r.count)])
    expect(rows).toEqual([
      [hourOf(T0), 'csp', 'img-src', 3],
      [hourOf(T0), 'server-error', 'render:/game/[appid]', 1],
      [hourOf(T0), 'server-error', 'route:/api/recommend', 2],
      [hourOf(T0 + 3600), 'server-error', 'route:/api/recommend', 1],
    ])
    expect(await telemetryCount(db, 'server-error', T0)).toBe(4)
    expect(await telemetryCount(db, 'server-error', T0 + 3600)).toBe(1)
    expect(await telemetryCount(db, 'csp', T0)).toBe(3)
  })

  // Ключ — шаблон маршрута, вид, директива. Всё, что похоже на путь с
  // параметрами или просто длинно, в таблицу не попадает
  test('ключ из чужого алфавита — other', () => {
    expect(telemetryKey('route:/game/[appid]')).toBe('route:/game/[appid]')
    expect(telemetryKey('quiz_done:compat')).toBe('quiz_done:compat')
    expect(telemetryKey('/room/ABC234?join=76561197960287930 x')).toBe('other')
    expect(telemetryKey('x'.repeat(81))).toBe('other')
    expect(telemetryKey('')).toBe('other')
  })

  test('уборка стирает старше 90 дней и не трогает свежее', async () => {
    const db = await createDb(':memory:')
    await bumpTelemetry(db, 'event', 'quiz_done:direct', T0 - TELEMETRY_TTL_SEC - 3600)
    await bumpTelemetry(db, 'event', 'quiz_done:direct', T0 - TELEMETRY_TTL_SEC + 3600)
    await bumpTelemetry(db, 'event', 'quiz_done:direct', T0)
    expect(await pruneTelemetry(db, T0)).toBe(1)
    expect(await telemetryCount(db, 'event', 0)).toBe(2)
  })
})
