import { describe, expect, test } from 'vitest'
import { isEmptyDelta, libraryDelta, minutesByApp, pickSnapshotDelta } from './libdelta'
import type { GameMeta, LibraryGame } from './types'

function g(appid: number, minutes: number, extra: Partial<LibraryGame> = {}): LibraryGame {
  return { appid, name: `g${appid}`, playtimeForever: minutes, playtime2Weeks: 0, ...extra }
}

const noMeta = (): GameMeta | undefined => undefined
const SINCE = 1_780_000_000

describe('libraryDelta', () => {
  test('прирост, новые целиком, минус не бывает', () => {
    const before = minutesByApp([g(1, 600), g(2, 100), g(3, 50)])
    const d = libraryDelta(before, [g(1, 660), g(2, 90), g(3, 50), g(4, 30)], SINCE, noMeta)
    // 60 прироста у первой, у второй Steam отдал меньше — ноль, новая — целиком
    expect(d.minutes).toBe(90)
    expect(d.played.map((p) => [p.game.appid, p.minutes])).toEqual([
      [1, 60],
      [4, 30],
    ])
    expect(d.added.map((a) => a.appid)).toEqual([4])
  })

  test('распаковано — было ноль, стало больше; новая и сыгранная — только «появилась»', () => {
    const before = minutesByApp([g(1, 0), g(2, 30), g(3, 0)])
    const d = libraryDelta(before, [g(1, 45), g(2, 60), g(3, 0), g(5, 120)], SINCE, noMeta)
    expect(d.unpacked.map((u) => [u.game.appid, u.minutes])).toEqual([[1, 45]])
    expect(d.added.map((a) => a.appid)).toEqual([5])
    expect(d.unpacked.some((u) => u.game.appid === 5)).toBe(false)
  })

  test('новая игра, которую последний раз запускали до отметки, — не новинка', () => {
    const before = minutesByApp([g(1, 10)])
    const d = libraryDelta(
      before,
      [
        g(1, 10),
        g(7, 900, { lastPlayed: SINCE - 86_400 }),
        g(8, 20, { lastPlayed: SINCE + 60 }),
        g(9, 0, { lastPlayed: 0 }),
      ],
      SINCE,
      noMeta,
    )
    expect(d.minutes).toBe(20)
    expect(d.added.map((a) => a.appid).sort()).toEqual([8, 9])
  })

  test('саундтрек не новинка и не распакован, но его минуты считаются', () => {
    const before = minutesByApp([g(1, 0, { name: 'Game Soundtrack' })])
    const d = libraryDelta(
      before,
      [g(1, 30, { name: 'Game Soundtrack' }), g(2, 5, { name: 'Some Dedicated Server' })],
      SINCE,
      noMeta,
    )
    expect(d.minutes).toBe(35)
    expect(d.unpacked).toEqual([])
    expect(d.added).toEqual([])
  })

  test('пропавшие только считаются, их часы не вычитаются', () => {
    const d = libraryDelta(minutesByApp([g(1, 100), g(2, 500)]), [g(1, 130)], SINCE, noMeta)
    expect(d.removedCount).toBe(1)
    expect(d.minutes).toBe(30)
  })

  test('порядок при равных минутах — по appid; пустая разница — пустая', () => {
    const d = libraryDelta(minutesByApp([g(9, 0), g(3, 0)]), [g(9, 30), g(3, 30)], SINCE, noMeta)
    expect(d.played.map((p) => p.game.appid)).toEqual([3, 9])
    expect(isEmptyDelta(libraryDelta(minutesByApp([g(1, 5)]), [g(1, 5)], SINCE, noMeta))).toBe(true)
    // без Map и Set — уезжает в кэш JSON-ом
    expect(JSON.parse(JSON.stringify(d))).toEqual(d)
  })
})

describe('pickSnapshotDelta', () => {
  const latest = { takenAt: SINCE + 3000, games: [g(1, 200), g(2, 0)] }

  test('свежий снимок без разницы пропускается, берётся старше', () => {
    const got = pickSnapshotDelta(
      [
        { takenAt: SINCE + 2000, minutes: minutesByApp([g(1, 200), g(2, 0)]) },
        { takenAt: SINCE, minutes: minutesByApp([g(1, 140), g(2, 0)]) },
      ],
      latest,
      noMeta,
    )
    expect(got?.fromAt).toBe(SINCE)
    expect(got?.delta.minutes).toBe(60)
  })

  test('сказать нечего, снимков нет или они не старше последнего — null', () => {
    const same = [{ takenAt: SINCE, minutes: minutesByApp(latest.games) }]
    expect(pickSnapshotDelta(same, latest, noMeta)).toBeNull()
    expect(pickSnapshotDelta([], latest, noMeta)).toBeNull()
    expect(
      pickSnapshotDelta([{ takenAt: latest.takenAt, minutes: minutesByApp([g(1, 1)]) }], latest, noMeta),
    ).toBeNull()
  })

  test('пустой прежний снимок — не точка отсчёта: «новым» было бы всё', () => {
    expect(pickSnapshotDelta([{ takenAt: SINCE, minutes: new Map() }], latest, noMeta)).toBeNull()
  })
})
