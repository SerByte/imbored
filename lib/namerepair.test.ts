import { beforeEach, describe, expect, test } from 'vitest'
import { repairRussianNames, resetTagDictCache } from './catalog'
import { createDb, russianNamedGames, upsertGameMeta, type Db } from './db'
import type { GameMeta } from './types'

/**
 * Русское название в games.name — английской записью сразу, а не «когда-нибудь
 * прогревом».
 *
 * Апсерт уводит русское название во второе (name_ru), только когда приходит
 * английское (nameSql в lib/db), а прогрев переписывает игру, лишь когда она
 * протухла в чьей-то библиотеке. На проде 19.10.2026 так стояли 80 игр из 5921
 * — «Ведьмак 3: Дикая Охота — Обновлённое издание», «Одни из нас™: Часть I», —
 * и /en отдавал «Is Ведьмак 3… worth playing?» в <title>, а поиск по «witcher 3»
 * её не находил. repairRussianNames — та же английская запись по списку.
 */

const NOW = 1_700_000_000

beforeEach(() => {
  resetTagDictCache()
})

function meta(appid: number, name: string, over: Partial<GameMeta> = {}): GameMeta {
  return { appid, name, tags: { RPG: 100 }, genres: ['RPG'], categories: [2], reviewsTotal: 1000 - appid / 1000, ...over }
}

/** Стаб магазина: словарь тегов и ответ GetItems по-английски; помнит язык запросов */
function storeStub(items: unknown[], seen: string[] = []): typeof fetch {
  return (async (url: string) => {
    if (String(url).includes('populartags')) {
      return new Response(JSON.stringify([{ tagid: 122, name: 'RPG' }]), { status: 200 })
    }
    const input = JSON.parse(new URL(String(url)).searchParams.get('input_json') ?? '{}')
    seen.push(input.context?.language)
    const asked = new Set((input.ids ?? []).map((i: { appid: number }) => i.appid))
    return new Response(
      JSON.stringify({ response: { store_items: items.filter((it) => asked.has((it as { appid: number }).appid)) } }),
      { status: 200 },
    )
  }) as unknown as typeof fetch
}

const item = (appid: number, name: string) => ({ appid, id: appid, name, visible: true, tags: [{ tagid: 122, weight: 100 }] })

async function names(db: Db, appid: number): Promise<{ name: string; nameRu: string | null }> {
  const res = await db.execute({ sql: 'SELECT name, name_ru FROM games WHERE appid = ?', args: [appid] })
  const row = res.rows[0] as unknown as { name: string; name_ru: string | null }
  return { name: row.name, nameRu: row.name_ru }
}

async function seeded(): Promise<Db> {
  const db = await createDb(':memory:')
  // Русское в name без второго — строка до раскладки названий по колонкам
  await upsertGameMeta(db, meta(292030, 'Ведьмак 3: Дикая Охота — Обновлённое издание', { shortDescription: 'Русское описание' }), NOW - 86_400)
  // У игры нет английского названия вовсе — данные, а не порча
  await upsertGameMeta(db, meta(873190, 'ЕСТЬ ДВА СТУЛА'), NOW - 86_400)
  // Снята с продажи: GetItems о ней молчит
  await upsertGameMeta(db, meta(2322010, 'God of War Рагнарёк'), NOW - 86_400)
  // Уже здорова: английское в name, русское вторым
  await upsertGameMeta(db, meta(990080, 'Hogwarts Legacy'), NOW - 86_400)
  await upsertGameMeta(db, meta(990080, 'Хогвартс. Наследие'), NOW - 86_400)
  return db
}

describe('russianNamedGames', () => {
  test('только русское в name без второго названия; здоровые и пул других магазинов — мимо', async () => {
    const db = await seeded()
    await upsertGameMeta(db, meta(-3, 'Смута'), NOW)
    expect((await russianNamedGames(db)).map((r) => r.appid).sort()).toEqual([292030, 873190, 2322010].sort())
  })
})

describe('repairRussianNames', () => {
  const STORE = [item(292030, 'The Witcher 3: Wild Hunt'), item(873190, 'ЕСТЬ ДВА СТУЛА')]

  test('английское название — в name, русское — вторым; данные и молчание магазина не трогает', async () => {
    const db = await seeded()
    const seen: string[] = []
    const report = await repairRussianNames(db, { fetchFn: storeStub(STORE, seen), nowSec: NOW })
    // Магазин спрошен по-английски — это и есть «английская запись»
    expect(seen).toEqual(['english'])
    expect(report.fixed).toEqual([{ appid: 292030, from: 'Ведьмак 3: Дикая Охота — Обновлённое издание', to: 'The Witcher 3: Wild Hunt' }])
    expect(report.kept).toEqual([{ appid: 873190, from: 'ЕСТЬ ДВА СТУЛА', to: 'ЕСТЬ ДВА СТУЛА' }])
    expect(report.missing).toEqual([2322010])

    expect(await names(db, 292030)).toEqual({ name: 'The Witcher 3: Wild Hunt', nameRu: 'Ведьмак 3: Дикая Охота — Обновлённое издание' })
    expect(await names(db, 873190)).toEqual({ name: 'ЕСТЬ ДВА СТУЛА', nameRu: null })
    expect(await names(db, 2322010)).toEqual({ name: 'God of War Рагнарёк', nameRu: null })
    // Запись — как у прогрева (mergeMeta): русское описание карточки бережётся
    const desc = await db.execute('SELECT short_description FROM games WHERE appid = 292030')
    expect(desc.rows[0]?.short_description).toBe('Русское описание')

    // Второй проход: чинить нечего, остались только данные и молчащая
    const again = await repairRussianNames(db, { fetchFn: storeStub(STORE), nowSec: NOW })
    expect(again.fixed).toEqual([])
  })

  test('dryRun ходит в магазин и считает, но не пишет', async () => {
    const db = await seeded()
    const report = await repairRussianNames(db, { fetchFn: storeStub(STORE), dryRun: true, nowSec: NOW })
    expect(report.fixed.map((r) => r.appid)).toEqual([292030])
    expect(await names(db, 292030)).toEqual({ name: 'Ведьмак 3: Дикая Охота — Обновлённое издание', nameRu: null })
  })

  test('чинить нечего — в магазин не ходит', async () => {
    const db = await createDb(':memory:')
    const seen: string[] = []
    expect(await repairRussianNames(db, { fetchFn: storeStub(STORE, seen) })).toEqual({ fixed: [], kept: [], missing: [] })
    expect(seen).toEqual([])
  })
})
