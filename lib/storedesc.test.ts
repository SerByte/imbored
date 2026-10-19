import { describe, expect, test, vi } from 'vitest'
import { englishDescription, parseAppDetails, parseStoreItems, storeDescription } from './catalog'
import { createDb, decodeStoredDescriptions, getCatalogMeta, getGameMeta, migrateDb, upsertGameMeta, type Db } from './db'
import type { GameMeta } from './types'

/**
 * Описание магазина — текстом, а не HTML.
 *
 * appdetails отдаёт short_description с сущностями (замер 19.10.2026: DUSK —
 * «possessed militants &amp; even darker forces», Library Of Ruina —
 * «&quot;May you find your book in this place.&quot;»), а страница выводит
 * описание текстом, и React экранирует его ещё раз. На проде /en-хабы
 * показывали буквально «find items &amp; build a base» (Muck), «Blade &amp;
 * Sorcery», «&amp;quot;». Новые записи расшифровывает разбор
 * (storeDescription), уже лежащие — разовый шаг миграции.
 */

const NOW = 1_700_000_000

const DUSK_RAW =
  'Battle through an onslaught of mystical backwater cultists, possessed militants &amp; even darker forces.'
const DUSK = 'Battle through an onslaught of mystical backwater cultists, possessed militants & even darker forces.'

function meta(appid: number, over: Partial<GameMeta> = {}): GameMeta {
  return { appid, name: `Game ${appid}`, tags: { Action: 100 }, genres: [], categories: [], ...over }
}

describe('разбор ответов магазина', () => {
  test('appdetails: описание расшифровано', () => {
    const json = {
      519860: { success: true, data: { type: 'game', name: 'DUSK', short_description: DUSK_RAW } },
    }
    expect(parseAppDetails(json, 519860)?.shortDescription).toBe(DUSK)
  })

  test('GetItems: то же правило, хоть он и отдаёт текст расшифрованным', () => {
    const json = {
      response: {
        store_items: [
          { appid: 1256670, visible: true, name: 'Library Of Ruina', basic_info: { short_description: '&quot;May you find your book.&quot;' } },
        ],
      },
    }
    expect(parseStoreItems(json, new Map())[0]?.shortDescription).toBe('"May you find your book."')
  })

  test('английский слот — расшифрованным, откуда бы описание ни пришло', () => {
    expect(englishDescription(DUSK_RAW)).toBe(DUSK)
    expect(englishDescription('Blade &amp; Sorcery is a VR sandbox.')).toBe('Blade & Sorcery is a VR sandbox.')
  })

  test('обычный текст не меняется: амперсанд без сущности и русские кавычки', () => {
    expect(storeDescription('R&D; rock & roll')).toBe('R&D; rock & roll')
    expect(storeDescription('«Игра» — про всё')).toBe('«Игра» — про всё')
  })
})

describe('decodeStoredDescriptions: то, что уже лежит', () => {
  async function seeded(): Promise<Db> {
    const db = await createDb(':memory:')
    await upsertGameMeta(db, meta(519860, { shortDescription: DUSK_RAW }), NOW)
    await upsertGameMeta(db, meta(1256670, { shortDescriptionEn: '&quot;May you find your book.&quot;' }), NOW)
    await upsertGameMeta(db, meta(620, { shortDescription: 'Головоломка с порталами', shortDescriptionEn: 'Rock & roll; portals' }), NOW)
    // Миграция при создании базы уже прошла: флаг снят, как на проде до деплоя
    await db.execute("DELETE FROM catalog_meta WHERE key = 'decode_descriptions_v1'")
    return db
  }

  test('расшифровывает обе колонки и только строки с сущностями; updated_at не трогает', async () => {
    const db = await seeded()
    expect(await decodeStoredDescriptions(db, { dryRun: true })).toEqual([519860, 1256670])
    expect((await getGameMeta(db, 519860))?.shortDescription).toBe(DUSK_RAW)

    expect(await decodeStoredDescriptions(db)).toEqual([519860, 1256670])
    expect((await getGameMeta(db, 519860))?.shortDescription).toBe(DUSK)
    expect((await getGameMeta(db, 1256670))?.shortDescriptionEn).toBe('"May you find your book."')
    // «&» и «;» без сущности — не сущность: строка как была
    expect((await getGameMeta(db, 620))?.shortDescriptionEn).toBe('Rock & roll; portals')
    const stamps = await db.execute('SELECT DISTINCT updated_at FROM games')
    expect(stamps.rows.map((r) => Number(r.updated_at))).toEqual([NOW])
    // Второй проход чинить уже нечего
    expect(await decodeStoredDescriptions(db)).toEqual([])
  })

  test('миграция расшифровывает один раз и ставит флаг', async () => {
    const db = await seeded()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await migrateDb(db, { VERCEL_ENV: 'production' })
      expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
        event: 'migrate-repaired',
        step: 'description-entities',
        rows: 2,
      })
    } finally {
      warn.mockRestore()
    }
    expect(await getCatalogMeta(db, 'decode_descriptions_v1')).toBe('1')
    expect((await getGameMeta(db, 519860))?.shortDescription).toBe(DUSK)

    // Флаг стоит — следующий старт прохода по games не повторяет
    await db.execute({ sql: 'UPDATE games SET short_description = ? WHERE appid = 519860', args: [DUSK_RAW] })
    await migrateDb(db, { VERCEL_ENV: 'production' })
    expect((await getGameMeta(db, 519860))?.shortDescription).toBe(DUSK_RAW)
  })

  test('превью без своей базы не переписывает и флаг не пишет', async () => {
    // Это перезапись исходных данных, как у починки JSON-колонок: бэкап
    // владелец снимает перед деплоем прода, не перед пушем ветки
    const db = await seeded()
    await migrateDb(db, { VERCEL_ENV: 'preview' })
    expect(await getCatalogMeta(db, 'decode_descriptions_v1')).toBeNull()
    expect((await getGameMeta(db, 519860))?.shortDescription).toBe(DUSK_RAW)
  })
})
