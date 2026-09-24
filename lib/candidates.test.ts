import { createClient } from '@libsql/client'
import { describe, expect, test } from 'vitest'
import { buildCandidates } from './candidates'
import { logFeedback, migrateDb, saveLibrarySnapshot, upsertGamesMeta, type Db } from './db'
import { NEUTRAL_MOOD } from './mood'
import type { GameMeta, LibraryGame } from './types'

/**
 * Конвейер кандидатов — один на /play и «Игру дня». Здесь то, что раньше
 * разъехалось между двумя копиями, и то, чем маршруты его настраивают.
 */

const NOW = 1_780_000_000
const ME = '76561197960287930'

async function freshDb(): Promise<Db> {
  return migrateDb(createClient({ url: ':memory:' }))
}

function meta(appid: number, tags: Record<string, number>): GameMeta {
  return { appid, name: `Игра ${appid}`, tags, genres: [], categories: [2] }
}

function game(appid: number, hours: number): LibraryGame {
  return { appid, name: `Игра ${appid}`, playtimeForever: hours * 60, playtime2Weeks: 0 }
}

/** Два наигранных якоря вкуса и шесть нетронутых */
async function seed(db: Db): Promise<void> {
  const own = [1, 2, 10, 11, 12, 13, 14, 15]
  await upsertGamesMeta(
    db,
    [...own.map((id) => meta(id, { Puzzle: 100, Casual: 60 })), meta(99, { Automation: 100 })],
    NOW,
  )
  await saveLibrarySnapshot(
    db,
    ME,
    [game(1, 40), game(2, 25), ...own.slice(2).map((id) => game(id, 0))],
    NOW,
  )
}

describe('buildCandidates', () => {
  test('без снапшота — nolibrary: код отказа пишет маршрут', async () => {
    const db = await freshDb()
    expect(await buildCandidates(db, ME, NEUTRAL_MOOD, 'all', { nowSec: NOW })).toBe('nolibrary')
  })

  test('всё забанено — nocandidates', async () => {
    const db = await freshDb()
    await seed(db)
    // 99 — каталог: пул открытий добирает его вне тегов профиля
    for (const appid of [1, 2, 10, 11, 12, 13, 14, 15, 99]) {
      await logFeedback(db, { steamid: ME, appid, action: 'banned' }, NOW - 60)
    }
    expect(await buildCandidates(db, ME, NEUTRAL_MOOD, 'all', { nowSec: NOW })).toBe('nocandidates')
  })

  /*
   * Дрейф, ради которого конвейер и вынесен: «Игра дня» читала метаданные
   * только библиотеки, и «Зашло» у игры не из неё её вкус не двигало.
   */
  test('оценка игры не из библиотеки двигает вкус и у «Игры дня»', async () => {
    const db = await freshDb()
    await seed(db)
    await logFeedback(db, { steamid: ME, appid: 99, action: 'liked' }, NOW - 60)
    const set = await buildCandidates(db, ME, NEUTRAL_MOOD, 'all', {
      nowSec: NOW,
      cooldownKinds: ['tired'],
    })
    if (typeof set === 'string') throw new Error(set)
    expect(set.profile.Automation).toBeGreaterThan(0)
  })

  test('«Игре дня» — только «надоела»: «не сейчас» на /play её игру не прячет', async () => {
    const db = await freshDb()
    await seed(db)
    await logFeedback(db, { steamid: ME, appid: 10, action: 'skipped', reason: 'notnow' }, NOW - 60)
    const play = await buildCandidates(db, ME, NEUTRAL_MOOD, 'all', { nowSec: NOW })
    const daily = await buildCandidates(db, ME, NEUTRAL_MOOD, 'all', {
      nowSec: NOW,
      cooldownKinds: ['tired'],
    })
    if (typeof play === 'string' || typeof daily === 'string') throw new Error('нет кандидатов')
    expect(play.candidates.map((c) => c.appid)).not.toContain(10)
    expect(daily.candidates.map((c) => c.appid)).toContain(10)
  })

  test('фокус «нераспакованное» сужает своё, scope решает, пускать ли каталог в пул героя', async () => {
    const db = await freshDb()
    await seed(db)
    const focused = await buildCandidates(db, ME, NEUTRAL_MOOD, 'library', {
      nowSec: NOW,
      focus: 'untouched',
    })
    if (typeof focused === 'string') throw new Error(focused)
    expect(focused.own.length).toBeGreaterThan(0)
    expect(focused.own.every((c) => c.source === 'untouched')).toBe(true)
    expect(focused.heroPool).toEqual(focused.own)
  })
})
