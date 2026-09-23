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

describe('публикация каталога: замеры не откатываются к старым', () => {
  const ЗАМЕРЫ = [
    'appid', 'name', 'price_final', 'price_initial', 'discount_percent', 'discount_ends_at',
    'price_at', 'ccu', 'ccu_at', 'updated_at',
  ] as const
  type Замер = {
    price_final: number | null
    discount_percent: number | null
    discount_ends_at: number | null
    price_at: number | null
    ccu: number | null
    ccu_at: number | null
  }
  const строка = (z: Замер) => [
    1, 'Игра', z.price_final, z.price_final, z.discount_percent, z.discount_ends_at,
    z.price_at, z.ccu, z.ccu_at, 0,
  ]

  async function заливаем(облако: Замер, локально: Замер) {
    const db = await createDb(':memory:')
    const cols = ЗАМЕРЫ.join(', ')
    const marks = ЗАМЕРЫ.map(() => '?').join(', ')
    await db.execute({ sql: `INSERT INTO games (${cols}) VALUES (${marks})`, args: строка(облако) })
    await db.execute({
      sql: `INSERT INTO games (${cols}) VALUES (${marks})
            ON CONFLICT(appid) DO UPDATE SET ${buildSetList(ЗАМЕРЫ)}`,
      args: строка(локально),
    })
    const r = await db.execute(
      'SELECT price_final, discount_percent, discount_ends_at, price_at, ccu, ccu_at FROM games',
    )
    return r.rows[0] as unknown as Замер
  }

  // Облако перемерило цену вчера: распродажа кончилась. Локальный снимок —
  // с промоута месячной давности, когда скидка ещё шла.
  const ВЧЕРА = 1_790_000_000
  const МЕСЯЦ_НАЗАД = ВЧЕРА - 30 * 86_400
  const облако: Замер = {
    price_final: 1999, discount_percent: 0, discount_ends_at: null, price_at: ВЧЕРА,
    ccu: 900, ccu_at: ВЧЕРА,
  }
  const старое: Замер = {
    price_final: 599, discount_percent: 70, discount_ends_at: МЕСЯЦ_НАЗАД + 86_400,
    price_at: МЕСЯЦ_НАЗАД, ccu: 5000, ccu_at: МЕСЯЦ_НАЗАД,
  }

  test('старая цена со скидкой не ложится поверх свежей — кончившаяся акция не воскресает', async () => {
    const r = await заливаем(облако, старое)
    expect(r.price_final).toBe(1999)
    expect(r.discount_percent).toBe(0)
    expect(r.discount_ends_at).toBeNull()
    expect(r.price_at).toBe(ВЧЕРА)
  })

  test('старый онлайн не ложится поверх свежего', async () => {
    const r = await заливаем(облако, старое)
    expect(r.ccu).toBe(900)
    expect(r.ccu_at).toBe(ВЧЕРА)
  })

  test('замер без отметки старше любого датированного', async () => {
    const r = await заливаем(облако, { ...старое, price_at: null, ccu_at: null })
    expect(r.price_final).toBe(1999)
    expect(r.ccu).toBe(900)
  })

  test('свежий локальный замер едет целиком, включая погашенную скидку', async () => {
    const свежее: Замер = {
      price_final: 2499, discount_percent: 0, discount_ends_at: null, price_at: ВЧЕРА + 3600,
      ccu: 1200, ccu_at: ВЧЕРА + 3600,
    }
    expect(await заливаем({ ...облако, discount_percent: 50, discount_ends_at: ВЧЕРА + 86_400 }, свежее)).toEqual(свежее)
  })

  test('в облаке замера не было — едет любой локальный, как раньше', async () => {
    const пусто: Замер = {
      price_final: null, discount_percent: null, discount_ends_at: null, price_at: null,
      ccu: null, ccu_at: null,
    }
    expect(await заливаем(пусто, старое)).toEqual(старое)
  })

  test('отзывы, сверенные кроном, заливка не откатывает к числам посева', async () => {
    // reviews_at в заливку не входит: у локального каталога его нет вовсе
    const cols = ['appid', 'name', 'reviews_total', 'reviews_percent', 'updated_at'] as const
    const db = await createDb(':memory:')
    await db.execute(`INSERT INTO games (appid, name, reviews_total, reviews_percent, reviews_at, updated_at)
                      VALUES (1, 'Сверенная', 2620088, 85, ${ВЧЕРА}, 0),
                             (2, 'Несверенная', 100, 50, NULL, 0)`)
    for (const [appid, total, percent] of [[1, 2593099, 86], [2, 120, 55]]) {
      await db.execute({
        sql: `INSERT INTO games (${cols.join(', ')}) VALUES (?, 'x', ?, ?, 1)
              ON CONFLICT(appid) DO UPDATE SET ${buildSetList(cols)}`,
        args: [appid, total, percent],
      })
    }
    const r = await db.execute('SELECT appid, reviews_total, reviews_percent FROM games ORDER BY appid')
    expect(r.rows.map((x) => [x.appid, x.reviews_total, x.reviews_percent])).toEqual([
      [1, 2620088, 85],
      [2, 120, 55],
    ])
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
