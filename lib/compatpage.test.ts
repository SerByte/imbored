import { createClient } from '@libsql/client'
import { describe, expect, test } from 'vitest'
import { loadCompat, loadCompatInvite, loadInviteHead } from './compatpage'
import { migrateDb, saveLibrarySnapshot, updateGamePrices, upsertGamesMeta, type Db } from './db'
import { hiddenLibrary, hiddenLibraryMetas } from './testing/hiddenlibrary'
import { roundsOf } from './testing/rounds'
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

/**
 * Бесплатная, но не в магазине региона: Warzone бесплатна в US, а российский
 * Steam отвечает на неё visible:false. Полка несёт оба признака — что сказать,
 * решает PriceTag, и «не продаётся» у него первым. Раньше бесплатность гасила
 * признак ещё здесь, и страница обещала «бесплатно» то, чего в магазине нет.
 */
describe('совместимость: бесплатная, но не продаётся в регионе', () => {
  test('у пика и isFree, и unsold', async () => {
    const db = await freshDb()
    const WARZONE = 1962663
    await upsertGamesMeta(
      db,
      [{ appid: WARZONE, name: 'Call of Duty: Warzone', tags: { 'Co-op': 100 }, genres: [], categories: [1], isFree: true }],
      NOW,
    )
    // регион по умолчанию: и замер, и чтение — в одном
    await updateGamePrices(db, [{ appid: WARZONE, hidden: true }], NOW)
    const game: LibraryGame = { appid: WARZONE, name: 'Call of Duty: Warzone', playtimeForever: 600, playtime2Weeks: 0 }
    await saveLibrarySnapshot(db, HIDDEN, [game], NOW)
    await saveLibrarySnapshot(db, OPEN, [game], NOW)
    const state = await loadCompat(db, { other: OPEN, me: HIDDEN, now: NOW })
    if (state.kind !== 'ok') throw new Error(state.kind)
    expect(state.data.playNow.find((p) => p.appid === WARZONE)).toMatchObject({ isFree: true, unsold: true })
  })
})

/**
 * Задержка страницы совместимости — длина лесенки запросов, а не их число.
 *
 * Каждое чтение ждало предыдущего: снапшот другого, обложки приглашения, его
 * ник, свой снапшот, свой ник, метаданные обеих библиотек, статистика тегов,
 * пул каталога — восемь кругов к Turso (~35 мс каждый, lib/candidates.ts) до
 * первого расчёта, за loading.tsx. Зависят друг от друга только три ступени:
 * люди → метаданные их библиотек → каталожный пул по профилю пары.
 */
describe('совместимость: круги к базе', () => {
  test('посчитанная пара — три круга, а не лесенка', async () => {
    const base = await freshDb()
    await seed(base)
    const { db, depth, log } = roundsOf(base)
    const state = await loadCompat(db, { other: OPEN, me: HIDDEN, now: NOW })
    expect(state.kind).toBe('ok')
    expect(depth(), JSON.stringify(log, null, 1)).toBe(3)
  })

  test('без общих игр герой — топ другого, и за обложками отдельно не ходим', async () => {
    // Раньше обложки героя брались из приглашения — отдельным запросом за
    // пятью играми, хотя метаданные всей библиотеки другого уже прочитаны
    const base = await freshDb()
    await seed(base)
    await upsertGamesMeta(
      base,
      hiddenLibraryMetas().map((m) => ({ ...m, headerImage: `https://cdn.example/${m.appid}.jpg` })),
      NOW,
    )
    const STRANGER = '76561198000000033'
    const own = hiddenLibrary(3).map((g) => ({ ...g, appid: g.appid + 500, name: `Своя ${g.appid}` }))
    await saveLibrarySnapshot(base, STRANGER, own, NOW)
    const { db, log } = roundsOf(base)
    const state = await loadCompat(db, { other: OPEN, me: STRANGER, now: NOW })
    if (state.kind !== 'ok') throw new Error(state.kind)
    expect(state.data.commonTotal).toBe(0)
    // Самые наигранные у OPEN — последние: часы растут с номером игры. Ровно
    // те же карточки, что в приглашении, — с обложками
    expect(state.data.heroGames.map((g) => g.appid)).toEqual([1011, 1010, 1009, 1008, 1007])
    expect(state.data.heroGames).toEqual((await loadCompatInvite(base, OPEN))?.topGames)
    expect(state.data.heroGames[0]?.headerImage).toBe('https://cdn.example/1011.jpg')
    // Метаданные игр — одним чтением: объединение двух библиотек
    const metaReads = log.filter((e) => e.sql.startsWith('SELECT g.appid'))
    expect(metaReads, JSON.stringify(log, null, 1)).toHaveLength(1)
  })

  test('голова приглашения — то же приглашение без обложек, и за метаданными игр не ходит', async () => {
    // Её читает generateMetadata на каждом заходе, в том числе у вошедшего,
    // чей экран обложек приглашения не показывает вовсе
    const base = await freshDb()
    await seed(base)
    const { db, log } = roundsOf(base)
    const head = await loadInviteHead(db, OPEN)
    const { topGames, ...rest } = (await loadCompatInvite(base, OPEN))!
    expect(topGames).toHaveLength(5)
    expect(head).toEqual(rest)
    expect(log.filter((e) => e.sql.startsWith('SELECT g.appid')), JSON.stringify(log, null, 1)).toEqual([])
    expect(await loadInviteHead(db, '76561198000000034')).toBeNull()
  })

  test('гость и человек без библиотеки видят то же приглашение', async () => {
    const db = await freshDb()
    await seed(db)
    const LATE = '76561198000000034'
    const guest = await loadCompat(db, { other: OPEN, me: null, now: NOW })
    const noLibrary = await loadCompat(db, { other: OPEN, me: LATE, now: NOW })
    expect(guest).toEqual({ kind: 'noauth', invite: await loadCompatInvite(db, OPEN) })
    expect(noLibrary).toEqual({ kind: 'nolibrary', invite: await loadCompatInvite(db, OPEN) })
    expect(await loadCompat(db, { other: LATE, me: OPEN, now: NOW })).toEqual({ kind: 'noprofile', otherName: null })
  })
})
