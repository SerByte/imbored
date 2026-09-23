import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { createDb, repairGameJson, upsertGameMeta } from '../lib/db'
import { buildSetList, publishRefusal } from './publishsql'

const COLS = ['appid', 'name', 'short_description', 'screenshots_json', 'updated_at'] as const

/**
 * Проверяем не строку SQL, а ПОВЕДЕНИЕ: собранный setList прогоняется через
 * настоящий upsert в настоящей базе. Сравнение с эталонным текстом сломалось бы
 * от любой перестановки пробелов и при этом ничего бы не гарантировало.
 */
async function публикуем(
  было: { short_description: string | null; screenshots_json: string | null },
  едет: { short_description: string | null; screenshots_json: string | null },
) {
  // Настоящая схема приложения, а не своя: createDb её уже накатывает, и
  // подменять games значило бы проверять upsert по таблице, которой нет.
  const db = await createDb(':memory:')
  await db.execute({
    sql: `INSERT INTO games (${COLS.join(', ')}) VALUES (?,?,?,?,?)`,
    args: [1, 'Игра', было.short_description, было.screenshots_json, 0],
  })
  await db.execute({
    sql: `INSERT INTO games (${COLS.join(', ')}) VALUES (?,?,?,?,?)
          ON CONFLICT(appid) DO UPDATE SET ${buildSetList(COLS)}`,
    args: [1, 'Игра', едет.short_description, едет.screenshots_json, 1],
  })
  const r = await db.execute('SELECT short_description AS d, screenshots_json AS s FROM games')
  return r.rows[0] as unknown as { d: string | null; s: string | null }
}

const РУС = 'Более двух десятилетий Counter-Strike служит примером'
const АНГ = 'For over two decades, Counter-Strike has offered'

describe('публикация каталога: что имеет право затирать что', () => {
  test('английское описание НЕ затирает русское — иначе доливка исчезает молча', async () => {
    const r = await публикуем(
      { short_description: РУС, screenshots_json: null },
      { short_description: АНГ, screenshots_json: null },
    )
    expect(r.d).toBe(РУС)
  })

  test('пустое и NULL русское тоже не трогают', async () => {
    expect((await публикуем({ short_description: РУС, screenshots_json: null }, { short_description: '', screenshots_json: null })).d).toBe(РУС)
    expect((await публикуем({ short_description: РУС, screenshots_json: null }, { short_description: null, screenshots_json: null })).d).toBe(РУС)
  })

  test('русское русским едет — переводы в Steam правят', async () => {
    const новое = 'Более двух десятилетий, обновлённый текст'
    expect((await публикуем({ short_description: РУС, screenshots_json: null }, { short_description: новое, screenshots_json: null })).d).toBe(новое)
  })

  test('английское английским и английское русским едут как прежде', async () => {
    expect((await публикуем({ short_description: АНГ, screenshots_json: null }, { short_description: 'Another English text', screenshots_json: null })).d).toBe('Another English text')
    expect((await публикуем({ short_description: АНГ, screenshots_json: null }, { short_description: РУС, screenshots_json: null })).d).toBe(РУС)
  })

  test('поля обогащения по-прежнему защищены от пустого локального', async () => {
    const r = await публикуем(
      { short_description: АНГ, screenshots_json: '["a.jpg"]' },
      { short_description: АНГ, screenshots_json: '[]' },
    )
    expect(r.s).toBe('["a.jpg"]')
  })
})

describe('публикация каталога: битые JSON-колонки не едут', () => {
  test('дважды закодированные теги в локальной базе — отказ с командой починки', async () => {
    // createDb прогоняет миграцию, и она сама чинит то, что лежало до неё;
    // поэтому ломаем строку уже после — как ломал бы её скрипт наполнения
    const db = await createDb(':memory:')
    const tags = { MOBA: 1019 }
    await upsertGameMeta(db, { appid: 570, name: 'Dota 2', tags, genres: [], categories: [1] }, 0)
    expect(publishRefusal(await repairGameJson(db, { dryRun: true }))).toBeNull()

    await db.execute({
      sql: 'UPDATE games SET tags_json = ? WHERE appid = 570',
      args: [JSON.stringify(JSON.stringify(tags))],
    })
    const refusal = publishRefusal(await repairGameJson(db, { dryRun: true }))
    expect(refusal).toContain('1 строка с битыми')
    expect(refusal).toContain('570  Dota 2')
    expect(refusal).toContain('npm run catalog:repair-tags')
  })

  test('длинный список обрезается, но число битых называется целиком', () => {
    const broken = Array.from({ length: 12 }, (_, i) => ({ appid: i + 1, name: `Игра ${i + 1}`, tags: 0 }))
    const refusal = publishRefusal(broken, 10)!
    expect(refusal).toContain('12 строк')
    expect(refusal).toContain('10  Игра 10')
    expect(refusal).not.toContain('11  Игра 11')
    expect(refusal).toContain('… и ещё 2')
  })

  test('проверка стоит до подключения к облаку и не пишет в локальную базу', () => {
    const src = readFileSync('scripts/publish-catalog.ts', 'utf8')
    const main = src.slice(src.indexOf('async function main'))
    const guard = main.indexOf('repairGameJson(local, { dryRun: true })')
    expect(guard, 'publish-catalog больше не проверяет форму JSON').toBeGreaterThan(-1)
    expect(guard).toBeLessThan(main.indexOf('await openRemote()'))
  })
})
