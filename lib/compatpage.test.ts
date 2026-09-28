import { createClient } from '@libsql/client'
import { describe, expect, test } from 'vitest'
import { loadCompat, loadCompatInvite } from './compatpage'
import { migrateDb, saveLibrarySnapshot, upsertGamesMeta, type Db } from './db'
import { hiddenLibrary, hiddenLibraryMetas } from './testing/hiddenlibrary'
import type { LibraryGame } from './types'

/**
 * Страница совместимости при скрытом в Steam времени (lib/playtime.ts).
 * Приглашение — публичная ссылка: превью в чате, герой и OG-карточка
 * говорили «0 часов» про человека, у которого просто стоит галочка.
 */

const NOW = 1_780_000_000
const HIDDEN = '76561198000000031'
const OPEN = '76561198000000032'

async function freshDb(): Promise<Db> {
  return migrateDb(createClient({ url: ':memory:' }))
}

/** Та же библиотека, но с часами — у второго из пары */
function withHours(games: LibraryGame[]): LibraryGame[] {
  return games.map((g, i) => ({ ...g, playtimeForever: (i + 1) * 120 }))
}

async function seed(db: Db): Promise<void> {
  await upsertGamesMeta(db, hiddenLibraryMetas(), NOW)
  await saveLibrarySnapshot(db, HIDDEN, hiddenLibrary(), NOW)
  await saveLibrarySnapshot(db, OPEN, withHours(hiddenLibrary(12)), NOW)
}

describe('совместимость при скрытом времени', () => {
  test('приглашение знает о скрытом времени, у открытой библиотеки признака нет', async () => {
    const db = await freshDb()
    await seed(db)
    expect(await loadCompatInvite(db, HIDDEN)).toMatchObject({ gamesCount: 20, playtimeHidden: true })
    expect(await loadCompatInvite(db, OPEN)).toMatchObject({ gamesCount: 12, playtimeHidden: false })
  })

  test('пара: часы скрытой стороны — null, признак у каждого свой', async () => {
    const db = await freshDb()
    await seed(db)
    const state = await loadCompat(db, { other: OPEN, me: HIDDEN, now: NOW })
    if (state.kind !== 'ok') throw new Error(state.kind)
    expect(state.data).toMatchObject({ myTimeHidden: true, otherTimeHidden: false, commonTotal: 12 })
    expect(state.data.commonGames.every((g) => g.hoursA === null && (g.hoursB ?? 0) > 0)).toBe(true)
    // «вместе» — только часы второго
    expect(state.data.commonHours).toBe(Math.round((12 * 13 * 120) / 2 / 60))
  })
})
